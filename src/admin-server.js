// Admin API for managing personal keys from automation such as n8n. It listens on its own
// port, which must stay private (never put it behind Tailscale Funnel or a public tunnel),
// and every request needs `Authorization: Bearer <ADMIN_TOKEN>`.
//   GET    /keys                    -> { names: [...], people: [{ name, trusted }] }
//   POST   /keys {name, trusted?}   -> { name, trusted, url }   (creates or replaces the key)
//   PATCH  /keys/<name> {trusted}   -> { name, trusted, updated }
//   DELETE /keys/<name>             -> { name, removed }
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const digest = (s) => createHash("sha256").update(s).digest();

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("Request body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

export function createAdminServer({ keys, token, publicUrl }) {
  if (!keys) throw new Error("The admin API needs KEYS_FILE");
  if (!token || token.length < 24) throw new Error("ADMIN_TOKEN must be at least 24 characters");
  const base = (publicUrl || "").replace(/\/+$/, "");

  const authorized = (req) => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") && timingSafeEqual(digest(header.slice(7)), digest(token));
  };

  return createServer(async (req, res) => {
    if (!authorized(req)) return sendJson(res, 401, { error: "Unauthorized" });
    const { pathname } = new URL(req.url, "http://localhost");
    try {
      if (pathname === "/keys" && req.method === "GET") {
        return sendJson(res, 200, { names: keys.names(), people: keys.list() });
      }
      if (pathname === "/keys" && req.method === "POST") {
        const { name, trusted = false } = await readJson(req);
        const key = keys.add(String(name ?? ""), { trusted: trusted === true });
        console.log(`admin: created ${trusted === true ? "trusted " : ""}key for ${name}`);
        return sendJson(res, 201, { name, trusted: trusted === true, url: `${base}/mcp/${key}` });
      }
      const match = pathname.match(/^\/keys\/([^/]+)$/);
      if (match && req.method === "PATCH") {
        const name = decodeURIComponent(match[1]);
        const { trusted } = await readJson(req);
        if (typeof trusted !== "boolean") throw new Error("Send { \"trusted\": true } or { \"trusted\": false }");
        const updated = keys.setTrusted(name, trusted);
        if (updated) console.log(`admin: ${name} is now ${trusted ? "trusted" : "reviewed"}`);
        return sendJson(res, updated ? 200 : 404, { name, trusted, updated });
      }
      if (match && req.method === "DELETE") {
        const name = decodeURIComponent(match[1]);
        const removed = keys.remove(name);
        if (removed) console.log(`admin: removed key for ${name}`);
        return sendJson(res, removed ? 200 : 404, { name, removed });
      }
      return sendJson(res, 404, { error: "Not found" });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });
}
