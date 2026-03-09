import { mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");
const iconsDir = path.join(root, "icons");
const distIconsDir = path.join(distDir, "assets", "icons");
const buildDir = path.join(root, "build");

await mkdir(distDir, { recursive: true });
await mkdir(distIconsDir, { recursive: true });
await mkdir(buildDir, { recursive: true });

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

const iconEntries = await readdir(iconsDir, { withFileTypes: true });
for (const entry of iconEntries) {
  if (!entry.isFile()) {
    continue;
  }
  await copyFile(path.join(iconsDir, entry.name), path.join(distIconsDir, entry.name));
}

for (const [sourceName, outputName] of [
  ["coview.icns", "icon.icns"],
  ["coview_1024.png", "icon.png"],
  ["coview.ico", "icon.ico"],
]) {
  await copyFile(path.join(iconsDir, sourceName), path.join(buildDir, outputName));
}
