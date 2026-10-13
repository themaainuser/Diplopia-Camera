// Zero-dependency static file server for local development.
// It serves only what the app is made of, so the port can be tunnelled without exposing the rest of the folder.
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const HOST = '127.0.0.1';

// Only these kinds of file are served; anything else answers 404.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const isInside = (root, file) => file === root || file.startsWith(root + path.sep);
const hasDotPart = (relative) => relative.split(path.sep).some((part) => part.startsWith('.'));

// Decides what a request gets: { status: 200, file, type }, or just a status.
export async function locate(root, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.split('?')[0]);
  } catch {
    return { status: 400 };
  }
  if (pathname.includes('\0')) return { status: 400 };
  if (pathname.endsWith('/')) pathname += 'index.html';

  const requested = path.resolve(root, '.' + pathname);
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

const MESSAGES = { 400: 'Bad request', 403: 'Forbidden', 404: 'Not found' };

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
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

// Start listening only when run directly, so tests can import `locate`.
const runDirectly =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (runDirectly) {
  http.createServer(handle).listen(PORT, HOST, () => {
    console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
  });
}
