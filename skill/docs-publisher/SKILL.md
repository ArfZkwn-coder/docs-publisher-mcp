---
name: docs-publisher
description: Write, edit, delete and illustrate tutorials on a Git-based documentation site through the docs-publisher MCP connector. Use when the user asks to publish, update, fix, remove or add a picture to a tutorial or docs page, or to see which pages exist.
---

# Docs publisher

Use the tools of the **docs-publisher** MCP connector to change a documentation site. Every change is committed straight to the docs repo, and the site redeploys by itself a minute or two later. If the connector isn't available, tell the user to add it first (see https://github.com/ArfZkwn-coder/docs-publisher-mcp) instead of guessing.

## Tools

| Tool | Use it to |
| --- | --- |
| `list_tutorials` | See which pages exist |
| `read_tutorial` | Read a page before changing it |
| `publish_tutorial` | Create a page, or replace one completely |
| `edit_tutorial` | Change one exact piece of text |
| `delete_tutorial` | Remove a page |
| `upload_image` | Save a picture from a public https link into the site |
| `deploy_site` | Rebuild the site by hand (rarely needed) |

## Page paths

`list_tutorials` returns repo paths such as `docs/guides/webhooks.md`. The other tools want the path **inside the docs folder, without the extension**: `guides/webhooks`. Drop the leading `docs/` and the `.md`, or the page won't be found.

## How to work

1. **Look first.** Call `list_tutorials` before creating a page, so you don't overwrite an existing one or duplicate a topic. Call `read_tutorial` before editing or replacing a page.
2. **Create a new page** with `publish_tutorial`. Give it a clear `title`, and a `path` such as `guides/webhooks` (the folder becomes a sidebar section). Write the body in Markdown with headings, short steps and code blocks. Front matter is added for you.
3. **Fix part of a page** with `edit_tutorial`. Copy the old text exactly, and include enough surrounding text to make it unique. If it matches more than once or not at all, read the page again and adjust. Use `publish_tutorial` only when rewriting the whole page.
4. **Delete only when asked**, and confirm the page path with the user first. Deleting can be undone by reverting the commit, but the live site loses the page.
5. **Add pictures** with `upload_image`, giving it an `https` link to the image file itself (JPEG, PNG, GIF or WebP, up to 5 MB), a `name` such as `webhooks/diagram`, and an `alt` description. Put the Markdown it returns into the page with `edit_tutorial`.

## Rules

- **Use pictures the user may reuse**: their own, or ones with a free license. When the license asks for it, credit the author in the page.
- **Never invent facts, screenshots or sources.** If you lack the details for a tutorial, ask the user for notes or steps.
- **Tell the user what changed**: the page path, and that the site will be live in a minute or two. Don't call `deploy_site` after a write; the connector already deploys.
- **Don't expose secrets.** Never paste tokens, keys or connector URLs into a tutorial or into chat.
- **Keep to the user's request.** Don't edit or delete other pages unless asked.
- If a tool fails, report the error message as it is and stop; don't retry with a different path to get around it.
