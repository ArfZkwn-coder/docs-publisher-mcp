// Per-person access keys for the hosted connector, stored in a JSON file as
// { "name": "key" } for regular keys or { "name": { "key": "...", "trusted": true } } for
// trusted ones, whose changes skip review. The server re-reads the file when it changes,
// so keys work without a restart.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

const entry = (value) =>
  typeof value === "string" ? { key: value, trusted: false } : { key: value.key, trusted: !!value.trusted };
const stored = ({ key, trusted }) => (trusted ? { key, trusted: true } : key);

export class KeyStore {
  #cache = { mtimeMs: -1, byKey: new Map() };

  constructor(file) {
    this.file = file;
  }

  #read() {
    if (!existsSync(this.file)) return {};
    return JSON.parse(readFileSync(this.file, "utf8"));
  }

  #write(keys) {
    // Write then rename, so the server never reads a half-written file.
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** Who a key belongs to, as { name, trusted }, or null. */
  lookup(key) {
    const mtimeMs = existsSync(this.file) ? statSync(this.file).mtimeMs : 0;
    if (mtimeMs !== this.#cache.mtimeMs) {
      const byKey = new Map(
        Object.entries(this.#read()).map(([name, value]) => {
          const { key: k, trusted } = entry(value);
          return [k, { name, trusted }];
        }),
      );
      this.#cache = { mtimeMs, byKey };
    }
    return this.#cache.byKey.get(key) ?? null;
  }

  names() {
    return Object.keys(this.#read()).sort();
  }

  /** Everyone with a key, as [{ name, trusted }], sorted by name. */
  list() {
    return Object.entries(this.#read())
      .map(([name, value]) => ({ name, trusted: entry(value).trusted }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Create a key for `name` (replacing any existing one) and return it. */
  add(name, { trusted = false } = {}) {
    if (!NAME.test(name)) {
      throw new Error("Names may use letters, numbers, '.', '_' and '-' (up to 32 characters)");
    }
    const keys = this.#read();
    const key = randomBytes(24).toString("hex");
    keys[name] = stored({ key, trusted });
    this.#write(keys);
    return key;
  }

  /** Mark `name`'s existing key as trusted or not; returns false if they have no key. */
  setTrusted(name, trusted) {
    const keys = this.#read();
    if (!(name in keys)) return false;
    keys[name] = stored({ ...entry(keys[name]), trusted });
    this.#write(keys);
    return true;
  }

  /** Revoke `name`'s key; returns false if there was none. */
  remove(name) {
    const keys = this.#read();
    if (!(name in keys)) return false;
    delete keys[name];
    this.#write(keys);
    return true;
  }
}
