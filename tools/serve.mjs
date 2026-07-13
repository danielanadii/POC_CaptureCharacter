import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const port = Number(process.env.PORT || process.argv[2] || 4173);
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(join(root, normalized));
  if (!filePath.startsWith(root)) filePath = join(root, "index.html");
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  return existsSync(filePath) ? filePath : join(root, "index.html");
}

createServer((request, response) => {
  const filePath = resolveRequestPath(request.url || "/");
  response.setHeader("Content-Type", mimeTypes[extname(filePath)] || "application/octet-stream");
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Serving AR Capture POC at http://${host}:${port}`);
});
