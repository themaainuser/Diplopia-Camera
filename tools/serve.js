// Zero-dependency static file server for local development.
// It serves only what the app is made of, so the port can be tunnelled without exposing the rest of the folder.
//
// `npm start` answers this computer only, over plain HTTP.
// `npm run start:phone` answers the local network over HTTPS, because phone browsers only allow the
// camera on a secure address. Its certificate is made on this computer and trusted by nothing, so a
// phone warns once before opening the page.
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CERT_DIR = path.join(ROOT, ".certs"); // a dot-folder, so this server never serves it

export function serverOptions(argv, env) {
  const phone = argv.includes("--phone");
  return {
    https: phone,
    host: phone ? "0.0.0.0" : "127.0.0.1",
    port: Number(env.PORT) || (phone ? 8080 : 8443),
  };
}

// The IPv4 addresses other devices on the network can use to reach this computer.
export function lanAddresses(interfaces) {
  return Object.values(interfaces)
    .flat()
    .filter((entry) => (entry.family === "IPv4" || entry.family === 4) && !entry.internal)
    .map((entry) => entry.address);
}

// Only these kinds of file are served; anything else answers 404.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const isInside = (root, file) => file === root || file.startsWith(root + path.sep);
const hasDotPart = (relative) => relative.split(path.sep).some((part) => part.startsWith("."));

// Decides what a request gets: { status: 200, file, type }, or just a status.
export async function locate(root, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.split("?")[0]);
  } catch {
    return { status: 400 };
  }
  if (pathname.includes("\0")) return { status: 400 };
  if (pathname.endsWith("/")) pathname += "index.html";

  const requested = path.resolve(root, "." + pathname);
  if (!isInside(root, requested)) return { status: 403 };
  const type = TYPES[path.extname(requested).toLowerCase()];
  if (!type) return { status: 404 };

  // Check where the path really leads. A different spelling of a folder name (other letter case,
  // a Windows short name such as GIT~1, a link) must not reach a dot-folder or leave the root.
  let file;
  let realRoot;
  try {
    [file, realRoot] = await Promise.all([realpath(requested), realpath(root)]);
  } catch {
    return { status: 404 };
  }
  if (!isInside(realRoot, file) || hasDotPart(path.relative(realRoot, file))) return { status: 404 };
  return { status: 200, file, type };
}

const MESSAGES = { 400: "Bad request", 403: "Forbidden", 404: "Not found" };

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function handle(req, res) {
  const found = await locate(ROOT, req.url);
  if (found.status !== 200) return send(res, found.status, MESSAGES[found.status]);
  try {
    send(res, 200, await readFile(found.file), found.type);
  } catch {
    send(res, 404, MESSAGES[404]);
  }
}

// Makes the certificate the first time phone mode runs. Git for Windows ships openssl but does not
// always put it on the PATH, so its usual locations are tried too; mkcert works as well.
function loadCertificate(addresses) {
  const keyFile = path.join(CERT_DIR, "key.pem");
  const certFile = path.join(CERT_DIR, "cert.pem");
  if (!existsSync(keyFile) || !existsSync(certFile)) {
    mkdirSync(CERT_DIR, { recursive: true });
    const names = ["localhost", "127.0.0.1", ...addresses];
    const san = names.map((name) => (/^[\d.]+$/.test(name) ? "IP:" : "DNS:") + name).join(",");
    const opensslArgs = [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "825",
      "-subj",
      "/CN=Diplopia Camera on this computer",
      "-addext",
      "subjectAltName=" + san,
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ];
    const attempts = [
      ["openssl", opensslArgs],
      ["C:\\Program Files\\Git\\usr\\bin\\openssl.exe", opensslArgs],
      ["C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe", opensslArgs],
      ["mkcert", ["-cert-file", certFile, "-key-file", keyFile, ...names]],
    ];
    const made = attempts.some(([program, args]) => {
      try {
        execFileSync(program, args, { stdio: "ignore" });
        return existsSync(keyFile) && existsSync(certFile);
      } catch {
        return false;
      }
    });
    if (!made)
      throw new Error(
        "Could not make a certificate: install Git for Windows (it includes openssl) or mkcert.",
      );
  }
  return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
}

// Start listening only when run directly, so tests can import the helpers.
const runDirectly =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (runDirectly) {
  const options = serverOptions(process.argv.slice(2), process.env);
  if (options.https) {
    const addresses = lanAddresses(os.networkInterfaces());
    https.createServer(loadCertificate(addresses), handle).listen(options.port, options.host, () => {
      console.log(`Serving ${ROOT} over HTTPS on your local network.`);
      console.log("On a phone on the same network, open one of:");
      for (const address of addresses) console.log(`  https://${address}:${options.port}`);
      console.log(
        "The phone will say the connection is not private, because the certificate was made on this",
      );
      console.log("computer. Choose to continue (Advanced, then Proceed), then allow the camera.");
    });
  } else {
    http.createServer(handle).listen(options.port, options.host, () => {
      console.log(`Serving ${ROOT} at http://localhost:${options.port}`);
    });
  }
}
