// Serves the connector over MCP Streamable HTTP so it can be added as a claude.ai custom
// connector. claude.ai can't send custom headers, so the URL path carries a secret key:
// MCP_SECRET (the owner's) or a per-person key from the KeyStore.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";

const digest = (s) => createHash("sha256").update(s).digest();

/** Compare in constant time so the key can't be guessed one character at a time. */
const keyMatches = (given, expected) => timingSafeEqual(digest(given), digest(expected));

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

const rpcError = (message) => ({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

/**
 * Create (but don't start) the HTTP server. The MCP endpoint is `/mcp/<key>`;
 * `/health` answers without a key so uptime checks and Docker can probe it.
 * `keys` is an optional KeyStore of per-person keys.
 */
export function createHttpServer({ docs, site, options, secret, keys = null }) {
  if (secret && secret.length < 24) {
    throw new Error("MCP_SECRET must be a random string of at least 24 characters");
  }
  if (!secret && !keys) throw new Error("Set MCP_SECRET or KEYS_FILE so the connector has a key");

  /** Who a key belongs to, as { name } ("owner" for MCP_SECRET), or null. */
  function identify(key) {
    if (secret && keyMatches(key, secret)) return { name: "owner" };
    try {
      return keys?.lookup(key) ?? null;
    } catch (e) {
      console.error("Could not read the keys file:", e.message);
      return null;
    }
  }

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");

    if (pathname === "/health") return sendJson(res, 200, { ok: true });

    const match = pathname.match(/^\/mcp\/([^/]+)\/?$/);
    const who = match && identify(match[1]);
    if (!who) return sendJson(res, 404, { error: "Not found" });

    // Stateless mode: each POST gets a fresh server, so there are no sessions to resume.
    if (req.method !== "POST") return sendJson(res, 405, rpcError("Method not allowed"));

    const server = buildServer(docs, site, { ...options, actor: who.name });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error("MCP request failed:", e);
      if (!res.headersSent) sendJson(res, 500, rpcError("Internal server error"));
    }
  });
}
