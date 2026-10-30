#!/usr/bin/env node
// Hosted connector: serves MCP over HTTP for claude.ai custom connectors (see README).
import { createAdminServer } from "./admin-server.js";
import { loadConfig } from "./config.js";
import { createHttpServer } from "./http-server.js";

const { docs, site, keys, options } = loadConfig();
const port = Number(process.env.PORT || 8787);

createHttpServer({ docs, site, options, keys, secret: process.env.MCP_SECRET }).listen(port, () => {
  console.log(
    `docs-publisher listening on port ${port} (deploy ${site ? (options.autoDeploy ? "automatic" : "on request") : "disabled"}, ` +
      `personal keys ${keys ? "enabled" : "disabled"})`,
  );
});

// Optional admin API for automation (e.g. n8n). Keep its port private.
if (process.env.ADMIN_TOKEN) {
  const adminPort = Number(process.env.ADMIN_PORT || 8788);
  createAdminServer({ keys, token: process.env.ADMIN_TOKEN, publicUrl: process.env.PUBLIC_URL }).listen(
    adminPort,
    () => console.log(`admin API listening on port ${adminPort}`),
  );
}
