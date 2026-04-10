#!/usr/bin/env node
/**
 * fix-bun-links.js — Fix bun's broken module hoisting on Windows.
 *
 * Bun stores all packages under node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/
 * but on Windows it doesn't always create the top-level node_modules/<pkg> symlinks
 * that TypeScript and other tools expect.
 *
 * This script scans the .bun directory and creates directory junctions for any
 * package that's missing from the top-level node_modules.
 *
 * Usage: node scripts/fix-bun-links.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const nodeModules = path.join(root, "node_modules");
const bunDir = path.join(nodeModules, ".bun");

if (!fs.existsSync(bunDir)) {
  console.log("No .bun directory found — nothing to fix.");
  process.exit(0);
}

let created = 0;
let skipped = 0;

const entries = fs.readdirSync(bunDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;

  // Parse package name from directory: "@scope+name@version" or "name@version"
  const dirName = entry.name;
  let pkgName;

  if (dirName.startsWith("@")) {
    // Scoped: @scope+name@version -> @scope/name
    const plusIdx = dirName.indexOf("+");
    const atIdx = dirName.indexOf("@", plusIdx + 1);
    if (plusIdx === -1 || atIdx === -1) continue;
    const scope = dirName.substring(0, plusIdx);
    const name = dirName.substring(plusIdx + 1, atIdx);
    pkgName = `${scope}/${name}`;
  } else {
    // Unscoped: name@version -> name
    const atIdx = dirName.lastIndexOf("@");
    if (atIdx <= 0) continue;
    pkgName = dirName.substring(0, atIdx);
  }

  // Check if already exists in top-level node_modules
  const targetPath = path.join(nodeModules, pkgName);
  if (fs.existsSync(targetPath)) {
    skipped++;
    continue;
  }

  // Find the actual package directory inside .bun
  const srcPath = path.join(bunDir, dirName, "node_modules", pkgName);
  if (!fs.existsSync(srcPath)) continue;

  // Create parent scope directory if needed
  if (pkgName.includes("/")) {
    const scopeDir = path.join(nodeModules, pkgName.split("/")[0]);
    if (!fs.existsSync(scopeDir)) {
      fs.mkdirSync(scopeDir, { recursive: true });
    }
  }

  // Create directory junction (works without admin on Windows)
  try {
    execSync(`mklink /J "${targetPath}" "${srcPath}"`, { stdio: "ignore", shell: true });
    created++;
    console.log(`  + ${pkgName}`);
  } catch {
    // Fallback: try fs.symlinkSync
    try {
      fs.symlinkSync(srcPath, targetPath, "junction");
      created++;
      console.log(`  + ${pkgName} (symlink)`);
    } catch (e) {
      console.error(`  ! ${pkgName}: ${e.message}`);
    }
  }
}

console.log(`\nDone: ${created} links created, ${skipped} already existed.`);
