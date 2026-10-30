# docs-publisher-mcp

An MCP connector that lets Claude create, edit and delete tutorials, and add images to them, on a Git-based documentation site (Docusaurus, MkDocs, VitePress, Docsify, GitBook Git-sync, …). It commits straight to your docs GitHub repo, and with `SITE_DIR` set it rebuilds and publishes the site after every change, so whatever Claude writes is live a minute or two later.

## Tools

| Tool | What it does |
| --- | --- |
| `list_tutorials` | List all `.md`/`.mdx` files under the docs folder |
| `read_tutorial` | Read a tutorial's current Markdown |
| `publish_tutorial` | Create or fully replace a tutorial (adds front matter if missing) |
| `edit_tutorial` | Replace one exact piece of text in a tutorial |
| `delete_tutorial` | Remove a tutorial |
| `upload_image` | Download an image from a public `https` URL into `static/img/` and return the Markdown that shows it |
| `deploy_site` | Pull the docs branch into `SITE_DIR` and run `DEPLOY_COMMAND`, so committed tutorials go live |

Every write commits straight to the docs branch; there are no pull requests. With `AUTO_DEPLOY` on (the default) and `SITE_DIR` set, each write also deploys the site in the background, so `deploy_site` is only needed to redeploy by hand. Changes that arrive while a deploy is running are folded into one more deploy afterwards.

`upload_image` keeps pictures in your own repo instead of linking to other websites, which can break or block hotlinking. It accepts only JPEG, PNG, GIF and WebP files up to 5 MB, checks the file's actual bytes rather than its name, and refuses `http://` URLs and any address on a private network (localhost, `192.168.x.x`, the Docker bridge, Tailscale), so it can't be used to read things on the server's own network. Images are saved under `static/img/<name>.<ext>` and shown in a tutorial as `/img/<name>.<ext>`. Claude is told to use only images it may reuse and to credit their authors when the license asks for it.

## Setup

1. Create a GitHub **fine-grained personal access token** limited to your docs repo with **Contents: Read and write**.
2. Install dependencies (already done if you ran it here): `npm install`
3. Register the server with Claude Code (run from any folder):

   ```bash
   claude mcp add docs-publisher -e GITHUB_TOKEN=ghp_xxx -e DOCS_REPO=owner/repo -e DOCS_BRANCH=main -e DOCS_DIR=docs -- node C:/Users/User/Downloads/MiniProj/src/index.js
   ```

   For Claude Desktop, add this to `claude_desktop_config.json` under `mcpServers`:

   ```json
   "docs-publisher": {
     "command": "node",
     "args": ["C:/Users/User/Downloads/MiniProj/src/index.js"],
     "env": {
       "GITHUB_TOKEN": "ghp_xxx",
       "DOCS_REPO": "owner/repo",
       "DOCS_BRANCH": "main",
       "DOCS_DIR": "docs"
     }
   }
   ```

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | yes | – | GitHub token with write access to the docs repo |
| `DOCS_REPO` | yes | – | `owner/name` of the docs repo |
| `DOCS_BRANCH` | no | `main` | Branch the site is built from |
| `DOCS_DIR` | no | `docs` | Folder holding tutorials (`""` for repo root) |
| `SITE_DIR` | no | – | Local clone of the site repo; enables `deploy_site` |
| `DEPLOY_COMMAND` | no | `npm run deploy` | Shell command run in `SITE_DIR` to build and publish the site |
| `AUTO_DEPLOY` | no | `true` | Deploy the site in the background after every change (needs `SITE_DIR`); `false` leaves it to `deploy_site` |

### Deploying from Claude

`deploy_site` runs on the machine hosting the connector: it runs `git pull --ff-only` in `SITE_DIR`, then `DEPLOY_COMMAND`. That machine needs the site's dependencies installed (`npm install` in `SITE_DIR`) and Git credentials that can push to the repo. The default command suits Docusaurus's `docusaurus deploy`, which pushes the build to `gh-pages`; `GIT_USER` defaults to the owner in `DOCS_REPO`. For other generators, set `DEPLOY_COMMAND` (for example `mkdocs gh-deploy`). You don't need `deploy_site` if a CI workflow already deploys on every push.

## Usage

Ask Claude things like:

- "Write a tutorial on setting up webhooks and publish it as `guides/webhooks`."
- "In the install tutorial, change the Node requirement to 20+."
- "Add a freely licensed photo of nasi lemak to the nasi lemak tutorial, with a credit to its author."

## Sharing it: hosting for claude.ai

To let friends or staff use the connector from claude.ai (web, desktop or mobile) without installing anything, run it as a web server and add it as a **custom connector**. `src/http.js` serves MCP over HTTP at `/mcp/<key>`; the key in the path is the password, since claude.ai can't send custom headers. Your own key is `MCP_SECRET`; everyone else gets a personal key (see [Personal keys](#personal-keys)). Anyone with a connector URL publishes straight to the site, so only give URLs to people you trust.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_SECRET` | – | The owner's key: random string of 24+ characters (this or `KEYS_FILE` is required) |
| `KEYS_FILE` | – (`/data/keys.json` in Docker) | JSON file of personal keys, managed with `src/keys-cli.js` |
| `PUBLIC_URL` | – | Public address, used to print personal connector URLs |
| `PORT` | `8787` | Port the HTTP server listens on |

### On ZimaOS (or any Docker host)

1. **Copy the files** of this repo to the server (download it as a ZIP from GitHub, or `git clone` it there), for example into `/DATA/AppData/docs-publisher/` using the ZimaOS Files app, and unzip them. You only need `src/`, `package.json`, `package-lock.json`, `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, `run.sh` and `.env.example`.
2. **Create `.env`** next to `docker-compose.yml` from `.env.example`: paste your GitHub token, and set `MCP_SECRET` (on the server, `openssl rand -hex 24` makes one).
3. **Start it** from a root terminal on the server (ZimaOS: the web terminal at `http://<zima-ip>:7681`, then `sudo -i`). With `docker compose`:

   ```bash
   cd /DATA/AppData/docs-publisher && docker compose up -d --build
   ```

   ZimaOS has no `docker compose`, so use the included script instead, which builds the image and starts the container with the same settings:

   ```bash
   cd /DATA/AppData/docs-publisher && sh run.sh
   ```

   The first start clones the docs site into `./data/site` and installs its dependencies, which takes a few minutes. `docker logs -f docs-publisher` shows progress; it's ready when it prints `docs-publisher listening on port 8787`.
4. **Give it a public HTTPS address.** claude.ai connects from the internet, so `http://<zima-ip>:8787` on your home network isn't enough. Don't open a port on your router; use a tunnel:
   - **Tailscale Funnel** (no domain needed): install Tailscale on the server (it's in the ZimaOS App Store), allow Funnel for the machine in the Tailscale admin console, then run `tailscale funnel --bg 8787`. Your address is `https://<machine-name>.<tailnet>.ts.net`.
   - **Cloudflare Tunnel** (if your domain is on Cloudflare): create a tunnel in the Zero Trust dashboard, run its `cloudflared` container on the server, and point a hostname such as `docs-mcp.example.com` at `http://<zima-ip>:8787`.

   Check it: `https://<your-address>/health` should return `{"ok":true}`.
5. **Add the connector in claude.ai.** Go to **Settings → Connectors → Add custom connector**, name it `docs-publisher`, and use the URL `https://<your-address>/mcp/<MCP_SECRET>`. Give everyone else a personal key instead (next section).

### Personal keys

Give each friend or staff member their own key, so you can revoke one person without touching anyone else, and every commit says who asked for it ("docs: publish "FAQ" (by alice)"). On the server:

```bash
docker exec docs-publisher node src/keys-cli.js add alice     # prints alice's connector URL
docker exec docs-publisher node src/keys-cli.js list          # names only
docker exec docs-publisher node src/keys-cli.js remove alice  # alice's URL stops working at once
```

Send each URL privately; each person adds it in their own claude.ai under **Settings → Connectors → Add custom connector**. Keys live in `data/keys.json` and take effect immediately, with no restart. Running `add` for an existing name replaces their key.

Every key, yours included, publishes directly. The keys file, `keys-cli.js` (`--trusted`, `trust`, `untrust`) and the admin API still record a "trusted" flag from when untrusted keys had to go through pull requests; it no longer changes anything.

### Admin API (for n8n and other automation)

Set `ADMIN_TOKEN` (24+ random characters) and the connector also serves a small admin API on port `8788` (`ADMIN_PORT`), authenticated with `Authorization: Bearer <ADMIN_TOKEN>`:

| Request | Result |
| --- | --- |
| `GET /keys` | `{ "names": [...], "people": [{ "name": "alice", "trusted": false }] }` |
| `POST /keys` with `{ "name": "alice", "trusted": false }` | `{ "name": "alice", "trusted": false, "url": "https://.../mcp/..." }` (creates or replaces the key) |
| `PATCH /keys/alice` with `{ "trusted": true }` | `{ "name": "alice", "trusted": true, "updated": true }` |
| `DELETE /keys/alice` | `{ "name": "alice", "removed": true }` |

Keep this port private. `run.sh` and `docker-compose.yml` publish it only on the Docker bridge address (`172.17.0.1`), so other containers on the host, such as n8n, can call `http://172.17.0.1:8788` while your network and the internet can't. Never route it through Tailscale Funnel.

### n8n workflows (Telegram)

Two ready-made n8n workflows use the admin API. Both need a **Telegram API** credential (your bot's token from @BotFather) and a **Header Auth** credential with Name `Authorization` and Value `Bearer <ADMIN_TOKEN>` (plain text: in n8n, keep the field on **Fixed**, not Expression).

- `n8n/docs-access.json`: two n8n forms, **Give docs access** (name + Telegram chat ID; the bot sends the person their URL) and **Revoke docs access**. Forms are opened from your own network, so nothing extra is exposed.
- `n8n/docs-access-bot.json`: a Telegram bot. Anyone can send `/access`; you get a message with a ready-made `/approve <chat_id> <name>` to send back, and the bot then sends them their URL. Owner commands: `/approve`, `/revoke <name>`, `/list`, `/myid`. Set `OWNER_CHAT_ID` in the **Route** node to your chat ID (send `/myid` to find it); only that chat can approve, revoke or list.

The bot needs Telegram to reach n8n's webhooks over public HTTPS. Expose **only** the `/webhook` path, never the n8n editor, and tell n8n its public address:

```bash
docker exec tailscale tailscale funnel --bg --https=8443 --set-path=/webhook http://127.0.0.1:5678/webhook
```

Then set the n8n container's `WEBHOOK_URL` to `https://<your-host>.ts.net:8443/` (on ZimaOS: the n8n app → Manage → Environment variables) and activate the workflow.

### Running it safely

- A connector URL is a password: anyone who has it can publish, edit and delete pages on the live site. Revoke a personal key with `keys-cli.js remove`; to replace your own key, change `MCP_SECRET` in `.env` and recreate the container.
- After any change to `.env` (a new GitHub token, a new `MCP_SECRET`), recreate the container with `sh run.sh` (or `docker compose up -d`). `docker restart` keeps the settings the container was created with.
- Every commit is made with your GitHub token, so GitHub shows you as the author; the `(by <name>)` at the end of the commit message shows who asked. To undo someone's change, revert their commit (`git revert`) and redeploy.
- Don't turn on branch protection that requires pull requests for `main`: the connector commits to it directly.
- To update the server after changing the connector, copy the new files over and run `sh run.sh` (or `docker compose up -d --build`) again.

## Testing

`npm test` runs an end-to-end check (real MCP client and server over both in-memory and HTTP transports, fake GitHub API and shell); no token or network needed.
