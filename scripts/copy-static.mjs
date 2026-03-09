import { mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");

await mkdir(distDir, { recursive: true });

for (const filename of ["index.html", "styles.css"]) {
  await copyFile(path.join(srcDir, filename), path.join(distDir, filename));
}

const sourceEntries = await readdir(srcDir, { withFileTypes: true });
for (const entry of sourceEntries) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) {
    continue;
  }
  await copyFile(path.join(srcDir, entry.name), path.join(distDir, entry.name));
}
