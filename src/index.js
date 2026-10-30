#!/usr/bin/env node
// Local connector: Claude Code / Claude Desktop start this and talk to it over stdio.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const { docs, site, options } = loadConfig();

await buildServer(docs, site, options).connect(new StdioServerTransport());
