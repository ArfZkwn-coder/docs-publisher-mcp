// End-to-end smoke test: real MCP client <-> server over an in-memory transport,
// with a fake GitHub API and a fake shell behind it. No network or token needed.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SiteDeployer } from "../src/deploy.js";
import { createAdminServer } from "../src/admin-server.js";
import { GitHubDocs } from "../src/github.js";
import { createHttpServer } from "../src/http-server.js";
import { isPrivateAddress } from "../src/images.js";
import { KeyStore } from "../src/keys.js";
import { buildServer } from "../src/server.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const files = new Map(); // "branch:path" -> content
const branches = new Set(); // starts as an empty repo, like a freshly created one
const messages = []; // commit messages, newest last
const large = new Set(); // "branch:path" of files over 1 MB, which the contents API sends without content
let shaCounter = 0;

const json = (status, data) => ({
  status,
  ok: status < 400,
  text: async () => JSON.stringify(data),
});

async function fakeFetch(url, { method, body }) {
  const u = new URL(url);
  const path = u.pathname.replace("/repos/me/site", "");
  const b = body ? JSON.parse(body) : {};
  let m;
  if ((m = path.match(/^\/contents\/(.+)$/))) {
    const p = decodeURIComponent(m[1]);
    if (method === "GET") {
      const branch = u.searchParams.get("ref");
      const c = files.get(`${branch}:${p}`);
      if (c === undefined) return json(404, { message: "Not Found" });
      if (large.has(`${branch}:${p}`)) return json(200, { type: "file", sha: "s" + shaCounter, encoding: "none", content: "" });
      return json(200, { type: "file", sha: "s" + shaCounter, content: Buffer.from(c).toString("base64") });
    }
    if (method === "PUT") {
      if (b.branch && !branches.has(b.branch)) return json(404, { message: `Branch ${b.branch} not found` });
      const branch = b.branch ?? "main";
      branches.add(branch);
      messages.push(b.message);
      files.set(`${branch}:${p}`, Buffer.from(b.content, "base64").toString());
      return json(200, { content: { html_url: `https://github.com/me/site/blob/${branch}/${p}` }, commit: { sha: "c" + ++shaCounter } });
    }
    if (method === "DELETE") {
      files.delete(`${b.branch}:${p}`);
      return json(200, { commit: { sha: "c" + ++shaCounter } });
    }
  }
  if (branches.size === 0 && path.startsWith("/git/")) {
    return json(409, { message: "Git Repository is empty." });
  }
  if (path.startsWith("/git/trees/")) {
    const branch = decodeURIComponent(path.split("/").pop());
    const tree = [...files.keys()]
      .filter((k) => k.startsWith(branch + ":"))
      .map((k) => ({ type: "blob", path: k.slice(branch.length + 1) }));
    return json(200, { tree });
  }
  if ((m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
    return branches.has(decodeURIComponent(m[1])) ? json(200, { object: { sha: "base" } }) : json(404, {});
  }
  throw new Error(`Unexpected request ${method} ${path}`);
}

const docs = new GitHubDocs({ token: "t", repo: "me/site", branch: "main", dir: "docs", fetchImpl: fakeFetch });
const [ct, st] = InMemoryTransport.createLinkedPair();
const commands = []; // shell commands the deployer ran
let failDeploy = false;
async function fakeExec(command, { cwd, env }) {
  commands.push({ command, cwd, gitUser: env.GIT_USER });
  if (failDeploy && command === "npm run deploy") {
    throw new Error("`npm run deploy` failed (exit 1):\nboom at https://x:sekret-token@github.com/me/site");
  }
  return "\x1b[32m[SUCCESS]\x1b[39m Website is live\npushed with sekret-token\n";
}
const site = new SiteDeployer({ dir: "/site", branch: "main", repo: "me/site", secrets: ["sekret-token"], exec: fakeExec });

await buildServer(docs, site).connect(st);
const client = new Client({ name: "test", version: "1" });
await client.connect(ct);

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { err: !!r.isError, text: r.content[0].text };
};

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, [
  "delete_tutorial",
  "deploy_site",
  "edit_tutorial",
  "list_tutorials",
  "publish_tutorial",
  "read_tutorial",
  "upload_image",
]);

let r = await call("list_tutorials", {});
assert.equal(r.text, "No tutorials found.");

r = await call("publish_tutorial", { title: "Install Guide", content: "# Hi\n\nStep one.", description: "How to install", sidebar_position: 2 });
assert.ok(!r.err && r.text.startsWith("Created docs/install-guide.md"), r.text);
assert.match(files.get("main:docs/install-guide.md"), /^---\ntitle: "Install Guide"\ndescription: "How to install"\nsidebar_position: 2\n---\n\n# Hi/);

r = await call("edit_tutorial", { path: "install-guide", old_text: "Step one.", new_text: "Step 1: run `npm i`." });
assert.ok(!r.err && r.text.startsWith("Edited"), r.text);
assert.match(files.get("main:docs/install-guide.md"), /Step 1: run `npm i`\./);

r = await call("edit_tutorial", { path: "install-guide", old_text: "nope", new_text: "x" });
assert.ok(r.err && /not found/.test(r.text), r.text);

r = await call("read_tutorial", { path: "install-guide" });
assert.match(r.text, /Step 1/);

r = await call("list_tutorials", {});
assert.equal(r.text, "docs/install-guide.md");

files.set("main:docs/guides/page.mdx", "# An MDX page");
r = await call("read_tutorial", { path: "guides/page" });
assert.equal(r.text, "# An MDX page", "a bare slug finds an existing .mdx page");
r = await call("read_tutorial", { path: "docs/guides/page.mdx" });
assert.equal(r.text, "# An MDX page", "the path list_tutorials returns works");
r = await call("publish_tutorial", { title: "Page", path: "guides/page", content: "# New MDX" });
assert.ok(r.text.startsWith("Updated docs/guides/page.mdx") && !files.has("main:docs/guides/page.md"), r.text);
files.delete("main:docs/guides/page.mdx");
files.set("main:docs/guides/Upper.MDX", "# Upper");
r = await call("read_tutorial", { path: "docs/guides/Upper.MDX" });
assert.equal(r.text, "# Upper", "the extension keeps its case");
files.delete("main:docs/guides/Upper.MDX");

// Files over 1 MB come back without content: reading one fails, replacing or deleting one works.
files.set("main:docs/big.md", "x");
large.add("main:docs/big.md");
r = await call("read_tutorial", { path: "big" });
assert.ok(r.err && /too large/.test(r.text), r.text);
r = await call("edit_tutorial", { path: "big", old_text: "x", new_text: "y" });
assert.ok(r.err && /too large/.test(r.text), r.text);
r = await call("publish_tutorial", { title: "Big", content: "Smaller now" });
assert.ok(!r.err && r.text.startsWith("Updated docs/big.md"), r.text);
r = await call("delete_tutorial", { path: "big" });
assert.ok(!r.err && !files.has("main:docs/big.md"), r.text);
files.set("main:static/img/photo.png", "x");
large.add("main:static/img/photo.png");
assert.equal((await docs.putFile({ path: "static/img/photo.png", content: Buffer.from("png"), message: "m" })).created, false);
files.delete("main:static/img/photo.png");
large.clear();

assert.ok(isPrivateAddress("64:ff9b::7f00:1"), "NAT64 well-known prefix");
assert.ok(isPrivateAddress("64:ff9b:1::7f00:1"), "NAT64 local-use prefix");
assert.ok(isPrivateAddress("2002:7f00:1::"), "6to4");
assert.ok(!isPrivateAddress("8.8.8.8"));

r = await call("read_tutorial", { path: "../secrets" });
assert.ok(r.err && /Invalid/.test(r.text), r.text);

r = await call("delete_tutorial", { path: "install-guide" });
assert.ok(!r.err && !files.has("main:docs/install-guide.md"), r.text);

r = await call("deploy_site", {});
assert.ok(!r.err && /Deployed the site from main/.test(r.text) && /\[SUCCESS\] Website is live/.test(r.text), r.text);
assert.deepEqual(
  commands.map((c) => c.command),
  ["git pull --ff-only origin main", "npm run deploy"],
);
assert.ok(commands.every((c) => c.cwd === "/site" && c.gitUser), "deploy runs in SITE_DIR with GIT_USER set");

assert.ok(!r.text.includes("sekret-token"), "deploy output must not leak the token");

failDeploy = true;
r = await call("deploy_site", {});
assert.ok(r.err && /boom/.test(r.text) && !r.text.includes("sekret-token"), r.text);
failDeploy = false;
r = await call("deploy_site", {});
assert.ok(!r.err, "a failed deploy must not leave the deployer locked");

const [ct2, st2] = InMemoryTransport.createLinkedPair();
await buildServer(docs).connect(st2);
const bare = new Client({ name: "test", version: "1" });
await bare.connect(ct2);
const unconfigured = await bare.callTool({ name: "deploy_site", arguments: {} });
assert.ok(unconfigured.isError && /SITE_DIR/.test(unconfigured.content[0].text));

// Hosted mode: MCP over HTTP behind a secret URL; every change goes live by itself.
assert.throws(() => createHttpServer({ docs, site, options: {}, secret: "short" }), /MCP_SECRET/);
assert.throws(() => createHttpServer({ docs, site, options: {} }), /MCP_SECRET or KEYS_FILE/);
const secret = "k".repeat(32);
const keys = new KeyStore(join(mkdtempSync(join(tmpdir(), "docs-publisher-")), "keys.json"));
const http = createHttpServer({ docs, site, options: { autoDeploy: true }, secret, keys });
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${http.address().port}`;

assert.equal((await fetch(`${base}/health`)).status, 200);
assert.equal((await fetch(`${base}/mcp/wrong-key`, { method: "POST" })).status, 404);
assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 404);
assert.equal((await fetch(`${base}/mcp/${secret}`)).status, 405);

const remote = new Client({ name: "test", version: "1" });
await remote.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${secret}`)));
assert.equal((await remote.listTools()).tools.length, 7);
commands.length = 0;
const hosted = await remote.callTool({ name: "publish_tutorial", arguments: { title: "From a friend", content: "Hi" } });
assert.ok(!hosted.isError && /being deployed/.test(hosted.content[0].text), hosted.content[0].text);
assert.ok(files.has("main:docs/from-a-friend.md"), "changes land on main");
assert.match(messages.at(-1), /\(by owner\)$/, "the owner key is recorded as owner");
await remote.close();
await new Promise((resolve) => setTimeout(resolve, 50)); // let the background deploy run
assert.deepEqual(commands.map((c) => c.command), ["git pull --ff-only origin main", "npm run deploy"]);

// Personal keys: added while the server runs, recorded on each commit, revoked at once.
assert.throws(() => keys.add("bad name!"), /Names may use/);
const aliceKey = keys.add("alice");
assert.deepEqual(keys.names(), ["alice"]);
const alice = new Client({ name: "test", version: "1" });
await alice.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${aliceKey}`)));
const fromAlice = await alice.callTool({ name: "publish_tutorial", arguments: { title: "Alice FAQ", content: "Q&A" } });
assert.ok(!fromAlice.isError && files.has("main:docs/alice-faq.md"), fromAlice.content[0].text);
assert.equal(messages.at(-1), 'docs: publish "Alice FAQ" (by alice)');
await alice.close();
assert.ok(keys.remove("alice") && !keys.remove("alice"));
assert.equal((await fetch(`${base}/mcp/${aliceKey}`, { method: "POST" })).status, 404, "removed keys stop working");

// The keys file still records a trusted flag (kept for the admin API); it changes nothing.
const carolKey = keys.add("carol", { trusted: true });
assert.deepEqual(keys.list(), [{ name: "carol", trusted: true }]);
assert.ok(keys.setTrusted("carol", false) && !keys.setTrusted("nobody", true));
assert.deepEqual(keys.lookup(carolKey), { name: "carol", trusted: false });
keys.remove("carol");

// Admin API: what n8n uses to create and revoke keys.
const adminToken = "a".repeat(32);
assert.throws(() => createAdminServer({ keys, token: "short" }), /ADMIN_TOKEN/);
const admin = createAdminServer({ keys, token: adminToken, publicUrl: "https://docs.example.ts.net/" });
await new Promise((resolve) => admin.listen(0, "127.0.0.1", resolve));
const adminBase = `http://127.0.0.1:${admin.address().port}`;
const api = (method, path, body, token = adminToken) =>
  fetch(`${adminBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

assert.equal((await api("GET", "/keys", null, "wrong-token")).status, 401);
assert.equal((await fetch(`${adminBase}/keys`)).status, 401, "no token, no access");
const created = await api("POST", "/keys", { name: "bob" });
assert.equal(created.status, 201);
assert.match(created.json.url, /^https:\/\/docs\.example\.ts\.net\/mcp\/[0-9a-f]{48}$/);
const bobKey = created.json.url.split("/").pop();
assert.equal((await fetch(`${base}/mcp/${bobKey}`)).status, 405, "a key made by the admin API works on the MCP endpoint");
assert.deepEqual((await api("GET", "/keys")).json, { names: ["bob"], people: [{ name: "bob", trusted: false }] });
assert.equal((await api("POST", "/keys", { name: "bad name!" })).status, 400);
assert.deepEqual((await api("PATCH", "/keys/bob", { trusted: true })).json, { name: "bob", trusted: true, updated: true });
assert.equal((await api("PATCH", "/keys/bob", { trusted: "yes" })).status, 400);
assert.equal((await api("PATCH", "/keys/nobody", { trusted: true })).status, 404);
assert.deepEqual(keys.lookup(bobKey), { name: "bob", trusted: true });
assert.equal((await api("DELETE", "/keys/bob")).status, 200);
assert.equal((await api("DELETE", "/keys/bob")).status, 404);
assert.equal((await fetch(`${base}/mcp/${bobKey}`, { method: "POST" })).status, 404);
admin.close();
http.close();

console.log("All smoke tests passed");
process.exit(0);
