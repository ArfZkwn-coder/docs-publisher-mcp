// Shared settings for the stdio (src/index.js) and HTTP (src/http.js) entry points.
import { SiteDeployer } from "./deploy.js";
import { GitHubDocs } from "./github.js";
import { KeyStore } from "./keys.js";

/** Read settings (optionally from a .env next to package.json) and build the connector's parts. */
export function loadConfig() {
  try {
    process.loadEnvFile(new URL("../.env", import.meta.url));
  } catch {}

  const docs = new GitHubDocs({
    token: process.env.GITHUB_TOKEN,
    repo: process.env.DOCS_REPO,
    branch: process.env.DOCS_BRANCH || "main",
    dir: process.env.DOCS_DIR ?? "docs",
  });

  // Deploying is optional: it needs a local clone of the site repo to build from.
  const site = process.env.SITE_DIR
    ? new SiteDeployer({
        dir: process.env.SITE_DIR,
        branch: docs.branch,
        repo: docs.repo,
        command: process.env.DEPLOY_COMMAND || undefined,
        secrets: [process.env.GITHUB_TOKEN],
      })
    : null;

  // Every change goes live on its own unless AUTO_DEPLOY=false.
  const autoDeploy = /^(1|true|yes)$/i.test(process.env.AUTO_DEPLOY ?? "true");

  // Per-person keys for the hosted connector (see src/keys-cli.js).
  const keys = process.env.KEYS_FILE ? new KeyStore(process.env.KEYS_FILE) : null;

  return { docs, site, keys, options: { autoDeploy } };
}
