import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "dist");
const entries = ["assets", ".nojekyll", "index.html", "styles.css", "ar-app.js"];

if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const entry of entries) {
  cpSync(join(root, entry), join(dist, entry), { recursive: true });
}

console.log(`Built static bundle in ${dist}`);
