import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { downloadImage } from "./images.js";

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] });

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A tutorial's text; the GitHub API leaves out the content of files over 1 MB. */
function textOf(file, path) {
  if (file.content === null) throw new Error(`${path} is too large (over 1 MB) to read through the GitHub API`);
  return file.content;
}

/** Prepend YAML front matter unless the content already has it. */
export function withFrontMatter(content, { title, description, sidebarPosition }) {
  if (/^---\r?\n/.test(content)) return content;
  const lines = ["---", `title: ${JSON.stringify(title)}`];
  if (description) lines.push(`description: ${JSON.stringify(description)}`);
  if (sidebarPosition !== undefined) lines.push(`sidebar_position: ${sidebarPosition}`);
  lines.push("---", "", "");
  return lines.join("\n") + content.replace(/^\s+/, "");
}

/**
 * `site` is an optional SiteDeployer; without one, deploy_site explains how to enable it.
 * Every write commits straight to the docs branch: anyone holding a connector key may publish.
 * `actor` names who is connected (from their personal key) and is recorded on every change.
 * With `autoDeploy`, each write deploys the site in the background. `fetchImage` downloads
 * images for upload_image (replaceable in tests).
 */
export function buildServer(
  docs,
  site = null,
  { actor = null, autoDeploy = false, fetchImage = downloadImage } = {},
) {
  const server = new McpServer({ name: "docs-publisher", version: "1.0.0" });

  // All commits go through one token, so record who asked in the message.
  const by = (message) => (actor ? `${message} (by ${actor})` : message);

  /** Start a background deploy after a write; returns the note to add to the tool's reply. */
  function deployAfterWrite() {
    if (!autoDeploy || !site) return "";
    site.deploySoon();
    return "\nThe site is being deployed and will be live in a minute or two.";
  }

  server.tool(
    "list_tutorials",
    "List all tutorial Markdown files in the documentation repo.",
    {},
    async () => {
      try {
        const files = await docs.listFiles();
        return text(files.length ? files.join("\n") : "No tutorials found.");
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "read_tutorial",
    "Read the current Markdown source of a tutorial.",
    { path: z.string().describe("Tutorial path relative to the docs folder, e.g. 'getting-started/install'") },
    async ({ path }) => {
      try {
        const found = await docs.findTutorial(path);
        return found.file ? text(textOf(found.file, found.path)) : fail(new Error(`Tutorial "${path}" not found`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "publish_tutorial",
    "Create a new tutorial or fully replace an existing one. Front matter (title, description, sidebar_position) is added automatically if the content has none. An existing .mdx page is replaced in place; MDX reads `<` and `{` as code, so escape them in plain text there.",
    {
      title: z.string().describe("Tutorial title"),
      content: z.string().describe("Full Markdown body of the tutorial"),
      path: z
        .string()
        .optional()
        .describe("Path relative to the docs folder, e.g. 'guides/install'. Defaults to a slug of the title."),
      description: z.string().optional().describe("Short summary used in front matter"),
      sidebar_position: z.number().int().optional().describe("Order in the sidebar"),
      commit_message: z.string().optional(),
    },
    async (a) => {
      try {
        const { path, file } = await docs.findTutorial(a.path ?? slugify(a.title));
        const body = withFrontMatter(a.content, {
          title: a.title,
          description: a.description,
          sidebarPosition: a.sidebar_position,
        });
        const message = by(a.commit_message ?? `docs: publish "${a.title}"`);
        const result = await docs.putFile({ path, content: body, message, existing: file });
        const verb = result.created ? "Created" : "Updated";
        return text(`${verb} ${path} on branch ${docs.branch}.` + deployAfterWrite());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "edit_tutorial",
    "Make a targeted edit to an existing tutorial by replacing an exact piece of text. The old text must appear exactly once.",
    {
      path: z.string().describe("Tutorial path relative to the docs folder"),
      old_text: z.string().describe("Exact text to replace (must be unique in the file)"),
      new_text: z.string().describe("Replacement text"),
      commit_message: z.string().optional(),
    },
    async (a) => {
      try {
        const { path, file } = await docs.findTutorial(a.path);
        if (!file) throw new Error(`Tutorial "${a.path}" not found`);
        const content = textOf(file, path);
        const count = content.split(a.old_text).length - 1;
        if (count !== 1) {
          throw new Error(
            count === 0
              ? "old_text was not found in the tutorial"
              : `old_text matches ${count} places; include more surrounding text to make it unique`,
          );
        }
        const updated = content.replace(a.old_text, () => a.new_text);
        const message = by(a.commit_message ?? `docs: edit ${path}`);
        await docs.putFile({ path, content: updated, message, existing: file });
        return text(`Edited ${path} on branch ${docs.branch}.` + deployAfterWrite());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "delete_tutorial",
    "Delete a tutorial from the documentation repo. Confirm with the user before calling.",
    {
      path: z.string().describe("Tutorial path relative to the docs folder"),
      commit_message: z.string().optional(),
    },
    async (a) => {
      try {
        const { path, file } = await docs.findTutorial(a.path);
        const message = by(a.commit_message ?? `docs: delete ${path}`);
        await docs.deleteFile({ path, message, existing: file });
        return text(`Deleted ${path} on branch ${docs.branch}.` + deployAfterWrite());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "upload_image",
    "Download an image from a public https URL and save it in the docs site, so a tutorial can show it without linking to another website. Returns the Markdown to put in the tutorial. Only use images you may reuse (for example under a free license), and credit the author in the tutorial when the license asks for it.",
    {
      url: z.string().describe("Public https URL of a JPEG, PNG, GIF or WebP image, at most 5 MB"),
      name: z
        .string()
        .describe("Where to save it in the site's image folder, without an extension, e.g. 'nasi-lemak/basic-plate'"),
      alt: z.string().optional().describe("Alt text describing the image, used in the returned Markdown"),
      commit_message: z.string().optional(),
    },
    async (a) => {
      try {
        const image = await fetchImage(a.url);
        const { path, src } = docs.imagePathFor(a.name, image.ext);
        const message = by(a.commit_message ?? `docs: add image ${path}`);
        const result = await docs.putFile({ path, content: image.data, message });
        const size = Math.ceil(image.data.length / 1024);
        return text(
          `${result.created ? "Added" : "Replaced"} ${path} (${size} KB) on branch ${docs.branch}.\n` +
            `Show it in a tutorial with:\n![${(a.alt ?? "").replace(/[\[\]]/g, "")}](${src})` +
            deployAfterWrite(),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "deploy_site",
    autoDeploy && site
      ? "Rebuild and publish the documentation website now. Not needed after a write: every publish, edit, delete or image upload already deploys the site by itself. Takes a minute or two."
      : "Rebuild the documentation website and publish it, so tutorials on the docs branch go live. Call it after publishing, editing or deleting tutorials. Takes a minute or two.",
    {},
    async () => {
      try {
        if (!site) {
          throw new Error("Deploying is not configured: set SITE_DIR to a local clone of the docs site repo");
        }
        const { log } = await site.deploy();
        return text(`Deployed the site from ${site.branch}.\n\n${log}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
