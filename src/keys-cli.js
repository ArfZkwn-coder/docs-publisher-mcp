#!/usr/bin/env node
// Manage per-person connector keys. On the Docker host:
//   docker exec docs-publisher node src/keys-cli.js add alice [--trusted]
//   docker exec docs-publisher node src/keys-cli.js trust alice | untrust alice
//   docker exec docs-publisher node src/keys-cli.js list
//   docker exec docs-publisher node src/keys-cli.js remove alice
// Trusted people's changes go straight to the docs branch (and deploy, with AUTO_DEPLOY)
// instead of waiting in a pull request.
import { KeyStore } from "./keys.js";

const file = process.env.KEYS_FILE;
const base = (process.env.PUBLIC_URL || "https://<your-address>").replace(/\/+$/, "");
const [command, name, ...flags] = process.argv.slice(2);

if (!file) {
  console.error("KEYS_FILE is not set");
  process.exit(1);
}
const store = new KeyStore(file);

try {
  if (command === "add" && name) {
    const trusted = flags.includes("--trusted");
    const key = store.add(name, { trusted });
    console.log(
      `Connector URL for ${name}${trusted ? " (trusted)" : ""} (send it to them privately):\n${base}/mcp/${key}`,
    );
  } else if ((command === "trust" || command === "untrust") && name) {
    const trusted = command === "trust";
    console.log(
      store.setTrusted(name, trusted)
        ? `${name} is now ${trusted ? "trusted: their changes publish directly" : "reviewed: their changes open pull requests"}.`
        : `No key for ${name}.`,
    );
  } else if (command === "remove" && name) {
    console.log(store.remove(name) ? `Removed ${name}; their URL stops working now.` : `No key for ${name}.`);
  } else if (command === "list") {
    const people = store.list();
    console.log(
      people.length ? people.map((p) => p.name + (p.trusted ? " (trusted)" : "")).join("\n") : "No personal keys yet.",
    );
  } else {
    console.log("Usage: keys-cli.js add <name> [--trusted] | trust <name> | untrust <name> | remove <name> | list");
    process.exit(command ? 1 : 0);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
