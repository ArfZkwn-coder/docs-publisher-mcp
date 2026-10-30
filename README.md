# docs-publisher-mcp

Let Claude write your documentation. This is an [MCP](https://modelcontextprotocol.io) connector that gives Claude tools to publish, edit and delete tutorials on a Git-based docs site (Docusaurus, MkDocs, VitePress and others), and to add pictures to them. Everything goes straight to your GitHub repo, and the site redeploys by itself, so a tutorial is live a minute or two after Claude writes it.

**See it working:** [docsXAi](https://arfzkwn-coder.github.io/docsXAi/) is a docs site built with it ([source](https://github.com/ArfZkwn-coder/docsXAi)). Its [setup guide](https://arfzkwn-coder.github.io/docsXAi/docs/set-up-in-claude) has a one-minute demo video.

```text
You chat with Claude  →  this connector  →  GitHub repo  →  live docs site
```

## What Claude can do

| Tool | What it does |
| --- | --- |
| `list_tutorials` | List the pages on the site |
| `read_tutorial` | Read a page |
| `publish_tutorial` | Create a page, or replace one |
| `edit_tutorial` | Change one exact piece of text in a page |
| `delete_tutorial` | Remove a page |
| `upload_image` | Save a picture from a public `https` link into the repo and return the Markdown to show it |
| `deploy_site` | Rebuild the site by hand (normally not needed) |

Ask in plain words, for example: *"Write a tutorial on webhooks and publish it as `guides/webhooks`."*

`upload_image` accepts only JPEG, PNG, GIF and WebP files up to 5 MB. It checks the file itself rather than its name, and refuses `http://` links and private network addresses, so it can't be used to reach things on your own network.

## Quick start

You need a **GitHub token**: create a *fine-grained personal access token* for your docs repo only, with **Contents: Read and write**.

### Option A: on your own computer (just you)

Needs Node.js 18 or later. No server and no public address.

```bash
git clone https://github.com/ArfZkwn-coder/docs-publisher-mcp
cd docs-publisher-mcp
npm install
claude mcp add docs-publisher -e GITHUB_TOKEN=<your-token> -e DOCS_REPO=<owner>/<repo> -- node "$(pwd)/src/index.js"
```

For Claude Desktop, add this under `mcpServers` in `claude_desktop_config.json` (use the full path to `src/index.js`):

```json
"docs-publisher": {
  "command": "node",
  "args": ["/full/path/to/docs-publisher-mcp/src/index.js"],
  "env": { "GITHUB_TOKEN": "<your-token>", "DOCS_REPO": "<owner>/<repo>" }
}
```

### Option B: on a server, for a team using claude.ai

Anyone you give a personal URL can use it from claude.ai (web, desktop or phone) without installing anything.

1. **Get the code on the server** and create your settings file:

   ```bash
   git clone https://github.com/ArfZkwn-coder/docs-publisher-mcp
   cd docs-publisher-mcp
   cp .env.example .env
   ```

   Edit `.env`: set `GITHUB_TOKEN`, `DOCS_REPO`, a long random `MCP_SECRET` (`openssl rand -hex 24` makes one), and `PUBLIC_URL` (step 3).
2. **Start it** with Docker:

   ```bash
   docker compose up -d --build
   ```

   On ZimaOS, which has no `docker compose`, run `sh run.sh` instead. The first start clones your docs site and installs it, which takes a few minutes. `docker logs -f docs-publisher` shows progress; it's ready at `listening on port 8787`.
3. **Give it a public https address**, because claude.ai connects from the internet. Don't open a port on your router; use a tunnel:
   - **Tailscale Funnel:** `tailscale funnel --bg 8787` gives you `https://<machine>.<tailnet>.ts.net`.
   - **Cloudflare Tunnel:** point a hostname at `http://localhost:8787`.

   Check `https://<your-address>/health`: it should say `{"ok":true}`. Put that address in `PUBLIC_URL`, then restart with `docker compose up -d`.
4. **Add it in claude.ai:** **Customize → Connectors → Add custom connector**, name `docs-publisher`, URL `https://<your-address>/mcp/<MCP_SECRET>`.

Hosting it elsewhere works too: any Linux server, VPS, NAS or Raspberry Pi that runs Docker will do. It needs a small persistent folder (`./data`, mounted at `/data`) for the keys and the site clone.

## Give other people access

Give each person their own key, so you can remove one without affecting anyone else, and every commit says who asked for it, for example `docs: publish "FAQ" (by alice)`.

```bash
docker exec docs-publisher node src/keys-cli.js add alice      # prints alice's connector URL
docker exec docs-publisher node src/keys-cli.js list           # names only
docker exec docs-publisher node src/keys-cli.js remove alice   # her URL stops working at once
```

Send each URL privately. Each person adds it in their own claude.ai as in step 4 above. Keys live in `data/keys.json` and take effect immediately, with no restart.

**A connector URL is a password.** Anyone who has it can publish, edit and delete pages on your live site, so only give it to people you trust.

### Optional: let people request access on Telegram

The `n8n/` folder has ready-made [n8n](https://n8n.io) workflows that do the key handling for you:

- `docs-access-bot.json`: a Telegram bot. Someone sends `/access`, you reply `/approve <chat_id> <name>`, and the bot sends them their URL. You can also send `/revoke <name>`, `/list` and `/myid`. Set `OWNER_CHAT_ID` in the **Route** node to your own chat ID so that only you can approve.
- `docs-access.json`: two n8n forms to give and revoke access without Telegram.

They talk to a small **admin API** that turns on when you set `ADMIN_TOKEN` (24+ random characters). It listens on port `8788` and needs the header `Authorization: Bearer <ADMIN_TOKEN>`:

| Request | What it does |
| --- | --- |
| `GET /keys` | List names |
| `POST /keys` with `{"name": "alice"}` | Create or replace a key and return the URL |
| `DELETE /keys/alice` | Remove a key |

Keep port 8788 private: `docker-compose.yml` and `run.sh` publish it only on the Docker bridge address (`172.17.0.1`, Linux). Never expose it through a tunnel. The Telegram bot needs Telegram to reach n8n's `/webhook` path over https; expose only that path, never the n8n editor.

## Settings

Set these in `.env`.

| Variable | Needed | Default | Meaning |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | yes | – | Token with write access to the docs repo |
| `DOCS_REPO` | yes | – | `owner/name` of the docs repo |
| `DOCS_BRANCH` | no | `main` | Branch the site is built from |
| `DOCS_DIR` | no | `docs` | Folder with the tutorials |
| `MCP_SECRET` | server | – | Your own key (24+ random characters). Needed unless you use only personal keys |
| `PUBLIC_URL` | server | – | Public address, used to print personal URLs |
| `KEYS_FILE` | server | `/data/keys.json` in Docker | File that holds personal keys |
| `PORT` | no | `8787` | Port the server listens on |
| `SITE_DIR` | no | – | Local clone of the site repo. Turns on deploying from the connector (Docker sets it for you) |
| `AUTO_DEPLOY` | no | `true` | Redeploy after every change. `false` leaves it to `deploy_site` |
| `DEPLOY_COMMAND` | no | `npm run deploy` | Command that builds and publishes the site, run in `SITE_DIR` (use `mkdocs gh-deploy` for MkDocs) |
| `ADMIN_TOKEN` | no | – | Turns on the admin API |

**Deploying:** with `SITE_DIR` set, the connector pulls the repo and runs `DEPLOY_COMMAND` after every change; changes that arrive during a deploy are folded into one more. The default suits Docusaurus (`docusaurus deploy` pushes to `gh-pages`) and needs Git credentials that can push. If a CI workflow already deploys on every push, skip all this: leave `SITE_DIR` unset.

## Good to know

- After changing `.env`, recreate the container with `docker compose up -d` (or `sh run.sh`). `docker restart` keeps the old settings.
- GitHub shows your token's owner as the author of every commit. The `(by <name>)` in the message shows who asked. To undo a change, revert that commit and redeploy.
- Don't require pull requests on `main` with branch protection: the connector commits to it directly.
- To update the server, pull the new code and run `docker compose up -d --build` (or `sh run.sh`) again.

## Tests

```bash
npm test
```

An end-to-end check using a fake GitHub and shell. It needs no token or network.

## License

[MIT](LICENSE)
