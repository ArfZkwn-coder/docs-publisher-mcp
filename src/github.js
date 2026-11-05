// Thin GitHub REST client used to read and write Markdown files and images in the docs repo.

const API = "https://api.github.com";

/** Validate a slash-separated path inside the repo (no "..", only safe characters). */
function cleanPath(slug, kind) {
  const clean = slug.replace(/\\/g, "/");
  if (!clean || clean.split("/").some((p) => p === ".." || p === "." || p === "")) {
    throw new Error(`Invalid ${kind} path: "${slug}"`);
  }
  if (!/^[A-Za-z0-9._\-/]+$/.test(clean)) {
    throw new Error(`${kind[0].toUpperCase() + kind.slice(1)} path may only contain letters, numbers, '-', '_', '.', and '/'`);
  }
  return clean;
}

export class GitHubDocs {
  /** `imageDir` is the site's static image folder; Docusaurus serves `static/img/x` as `/img/x`. */
  constructor({ token, repo, branch, dir, imageDir = "static/img", fetchImpl = fetch }) {
    if (!token) throw new Error("GITHUB_TOKEN is not set");
    if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      throw new Error("DOCS_REPO must look like 'owner/name'");
    }
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.dir = dir.replace(/^\/+|\/+$/g, "");
    this.imageDir = imageDir.replace(/^\/+|\/+$/g, "");
    this.fetch = fetchImpl;
  }

  async #request(method, path, body) {
    const res = await this.fetch(`${API}/repos/${this.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "docs-publisher-mcp",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${path} failed (${res.status}): ${data.message ?? text}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** GitHub answers 409 for git-data calls on a repo with no commits yet. */
  static #isEmptyRepo(e) {
    return e.status === 409;
  }

  /**
   * Turn a tutorial slug/path into a repo path inside the docs directory. Also accepts the
   * repo paths list_tutorials returns ("docs/guides/x.md"), so they can be passed straight back.
   */
  pathFor(slug) {
    const ext = slug.match(/\.(mdx?)$/i)?.[1] ?? "md";
    let rel = slug.replace(/\\/g, "/").replace(/\.mdx?$/i, "");
    if (this.dir && rel.startsWith(this.dir + "/")) rel = rel.slice(this.dir.length + 1);
    const clean = cleanPath(rel, "tutorial");
    return `${this.dir ? this.dir + "/" : ""}${clean}.${ext}`;
  }

  /**
   * Find a tutorial: its repo path (as pathFor gives it) and the file there, or null if there is
   * none yet. A bare slug with no ".md" page falls back to an existing ".mdx" page.
   */
  async findTutorial(slug) {
    const path = this.pathFor(slug);
    const file = await this.getFile(path);
    if (file || /\.mdx?$/i.test(slug)) return { path, file };
    const mdx = path + "x";
    const mdxFile = await this.getFile(mdx);
    return mdxFile ? { path: mdx, file: mdxFile } : { path, file: null };
  }

  /** Repo path for an image, and the `src` a tutorial uses to show it. */
  imagePathFor(name, ext) {
    const clean = cleanPath(name.replace(/\.(jpe?g|png|gif|webp)$/i, ""), "image");
    const webDir = this.imageDir.replace(/^static(\/|$)/, "");
    return {
      path: `${this.imageDir}/${clean}.${ext}`,
      src: `${webDir ? "/" + webDir : ""}/${clean}.${ext}`,
    };
  }

  /** `content` is null for files over 1 MB: the contents API sends only their sha. */
  async getFile(path, ref = this.branch) {
    const data = await this.#request("GET", `/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
    if (!data) return null;
    if (Array.isArray(data) || data.type !== "file") throw new Error(`${path} is not a file`);
    if (data.encoding === "none") return { sha: data.sha, content: null };
    return { sha: data.sha, content: Buffer.from(data.content, "base64").toString("utf8") };
  }

  async listFiles() {
    let tree;
    try {
      tree = await this.#request("GET", `/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
    } catch (e) {
      if (GitHubDocs.#isEmptyRepo(e)) return [];
      throw e;
    }
    if (!tree) throw new Error(`Branch "${this.branch}" not found in ${this.repo}`);
    const prefix = this.dir ? this.dir + "/" : "";
    return tree.tree
      .filter((e) => e.type === "blob" && e.path.startsWith(prefix) && /\.mdx?$/i.test(e.path))
      .map((e) => e.path);
  }

  async branchSha(branch) {
    try {
      const ref = await this.#request("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
      return ref?.object.sha ?? null;
    } catch (e) {
      if (GitHubDocs.#isEmptyRepo(e)) return null;
      throw e;
    }
  }

  /**
   * `content` is text, or a Buffer for binary files such as images. Pass `existing` (the file as
   * last read, or null) to skip fetching it again; GitHub then refuses the write if it changed since.
   */
  async putFile({ path, content, message, branch = this.branch, existing }) {
    if (existing === undefined) existing = await this.getFile(path, branch);
    // In an empty repo the branch doesn't exist yet; omitting it lets GitHub create
    // the first commit on the default branch.
    const branchExists = existing || (await this.branchSha(branch));
    const result = await this.#request("PUT", `/contents/${encodeURI(path)}`, {
      message,
      content: (Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")).toString("base64"),
      ...(branchExists ? { branch } : {}),
      ...(existing ? { sha: existing.sha } : {}),
    });
    return { created: !existing, commit: result.commit.sha };
  }

  async deleteFile({ path, message, branch = this.branch, existing }) {
    if (existing === undefined) existing = await this.getFile(path, branch);
    if (!existing) throw new Error(`${path} does not exist on ${branch}`);
    const result = await this.#request("DELETE", `/contents/${encodeURI(path)}`, {
      message,
      sha: existing.sha,
      branch,
    });
    return { commit: result.commit.sha };
  }
}
