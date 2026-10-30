// Downloads images for the upload_image tool. Only public https URLs that serve a real
// JPEG, PNG, GIF or WebP are accepted, so the connector can't be used to reach the
// server's own network (the router, n8n, the admin API) or to store other kinds of files.
import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;
const USER_AGENT = "docs-publisher-mcp/1.0 (image upload for a documentation site)";

// Loopback, private, link-local, carrier-grade NAT (Tailscale), multicast and reserved ranges.
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
]) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) {
  blocked.addSubnet(net, bits, "ipv6");
}

/** True for addresses on the local machine or a private network. */
export function isPrivateAddress(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateAddress(mapped[1]);
  const family = isIP(address);
  if (!family) return true;
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** DNS lookup that refuses private addresses, so a public name can't point at the home network. */
function publicLookup(hostname, options, callback) {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const all = Array.isArray(address) ? address : [{ address, family }];
    if (all.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error(`${hostname} points to a private address; only public images can be uploaded`));
    }
    callback(null, address, family);
  });
}

/** The file type from the image's first bytes (never trusting the URL or Content-Type). */
function sniff(data) {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (/^GIF8[79]a/.test(data.subarray(0, 6).toString("latin1"))) return "gif";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") {
    return "webp";
  }
  return null;
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { "User-Agent": USER_AGENT, Accept: "image/*" }, lookup: publicLookup });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("The image took too long to download")));
    req.on("error", reject);
    req.on("response", (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url).href });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`The image URL answered HTTP ${res.statusCode}`));
      }
      if (Number(res.headers["content-length"]) > MAX_BYTES) {
        res.destroy();
        return reject(new Error("The image is larger than 5 MB"));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) return res.destroy(new Error("The image is larger than 5 MB"));
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ data: Buffer.concat(chunks) }));
    });
    req.end();
  });
}

/** Download an image; resolves with { data: Buffer, ext: "jpg" | "png" | "gif" | "webp" }. */
export async function downloadImage(url) {
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Not a valid URL: ${url}`);
    }
    if (parsed.protocol !== "https:") throw new Error("Only https:// image URLs can be uploaded");
    if (parsed.username || parsed.password) throw new Error("Image URLs can't contain a username or password");
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isPrivateAddress(host)) {
      throw new Error("Only public images can be uploaded, not ones on a private network");
    }

    const res = await get(parsed.href);
    if (res.redirect) {
      url = res.redirect;
      continue;
    }
    const ext = sniff(res.data);
    if (!ext) throw new Error("The URL didn't return a JPEG, PNG, GIF or WebP image");
    return { data: res.data, ext };
  }
  throw new Error("The image URL redirected too many times");
}
