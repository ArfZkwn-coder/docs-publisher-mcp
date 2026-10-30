// Rebuilds and publishes the docs website from a local clone of the site repo.
import { spawn } from "node:child_process";

const TIMEOUT_MS = 10 * 60 * 1000;
const LOG_LINES = 30;

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
const tail = (s, n = LOG_LINES) => stripAnsi(s).trimEnd().split(/\r?\n/).slice(-n).join("\n");

/** Run a shell command; resolves with its combined output, rejects with the output's tail. */
export function runCommand(command, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`\`${command}\` failed (exit ${code ?? "killed"}):\n${tail(out)}`));
    });
  });
}

export class SiteDeployer {
  #running = false;
  #pending = false;

  constructor({ dir, branch, repo, command = "npm run deploy", secrets = [], exec = runCommand }) {
    if (!/^[\w./-]+$/.test(branch)) throw new Error(`Invalid branch name: "${branch}"`);
    this.dir = dir;
    this.branch = branch;
    this.command = command;
    this.exec = exec;
    this.secrets = secrets.filter(Boolean);
    // Docusaurus's `deploy` pushes over HTTPS as GIT_USER; default it to the repo owner.
    this.env = { ...process.env, GIT_USER: process.env.GIT_USER || repo.split("/")[0] };
  }

  /** Hide secrets (such as the GitHub token) in output that goes back to Claude. */
  #redact(s) {
    return this.secrets.reduce((out, secret) => out.replaceAll(secret, "***"), s);
  }

  /** Pull the latest tutorials into the site clone, then build and publish it. */
  async deploy() {
    if (this.#running) throw new Error("A deploy is already running; try again when it finishes");
    this.#running = true;
    try {
      const opts = { cwd: this.dir, env: this.env };
      await this.exec(`git pull --ff-only origin ${this.branch}`, opts);
      return { log: this.#redact(tail(await this.exec(this.command, opts))) };
    } catch (e) {
      throw new Error(this.#redact(e.message));
    } finally {
      this.#running = false;
    }
  }

  /**
   * Deploy in the background (after a direct publish). Requests that arrive while a deploy
   * runs are folded into one more deploy afterwards, so the last change always goes live.
   */
  deploySoon() {
    if (this.#running) {
      this.#pending = true;
      return;
    }
    this.deploy()
      .then(() => console.log("auto-deploy finished"))
      .catch((e) => console.error("auto-deploy failed:", e.message))
      .finally(() => {
        if (this.#pending) {
          this.#pending = false;
          this.deploySoon();
        }
      });
  }
}
