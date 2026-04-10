/**
 * Copy the Vite-built frontend into packages/desktop/frontend/
 * so Electron can load it in production mode.
 *
 * Run: node scripts/copy-frontend.js
 * Called automatically via prebuild in package.json
 */

const fs = require("fs");
const path = require("path");

const srcDir = path.resolve(__dirname, "..", "..", "frontend", "dist");
const destDir = path.resolve(__dirname, "..", "frontend");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`Frontend build not found at ${src}`);
    console.warn("Run 'bun run build:frontend' first.");
    process.exit(1);
  }

  // Clean destination
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }
  fs.mkdirSync(dest, { recursive: true });

  // Copy recursively
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log(`Copying frontend build from ${srcDir} to ${destDir}...`);
copyDir(srcDir, destDir);
console.log("Frontend copied successfully.");
