/**
 * Bundle the backend into a single JS file for Electron distribution.
 *
 * Uses esbuild to compile all backend code + dependencies into one file.
 * The bundle runs on Electron's built-in Node.js — no bun/external runtime needed.
 *
 * Output: packages/desktop/resources/backend-bundle.js
 *
 * Usage: node scripts/bundle-backend.js
 */

const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const backendRoot = path.resolve(__dirname, "..", "..", "backend");
const monorepoRoot = path.resolve(__dirname, "..", "..", "..");
const outFile = path.resolve(__dirname, "..", "resources", "backend-bundle.js");

async function bundle() {
  console.log("[bundle-backend] Entry:", path.join(backendRoot, "server.ts"));
  console.log("[bundle-backend] Output:", outFile);

  // Ensure output dir exists
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  try {
    const result = await esbuild.build({
      entryPoints: [path.join(backendRoot, "server.ts")],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "cjs",
      outfile: outFile,
      sourcemap: false,
      minify: false,
      treeShaking: true,

      // Resolve modules: esbuild resolves from entryPoint's directory
      // Bun uses junctions in node_modules pointing to root/.bun/ cache
      nodePaths: [
        path.join(backendRoot, "node_modules"),
        path.join(monorepoRoot, "node_modules"),
      ],

      // Resolve workspace packages
      alias: {
        "@ping/collaboration": path.resolve(monorepoRoot, "packages", "collaboration", "src", "index.ts"),
        "@ping/workspace": path.resolve(monorepoRoot, "packages", "workspace", "src", "index.ts"),
        "@ping/knowledge": path.resolve(monorepoRoot, "packages", "knowledge", "src", "index.ts"),
        "@ping/agent-manager": path.resolve(monorepoRoot, "packages", "agent-manager", "src", "index.ts"),
      },

      // Resolve everything from the backend's perspective
      resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      absWorkingDir: backendRoot,

      // CRITICAL: bun uses junctions in node_modules — esbuild must follow them
      preserveSymlinks: false,

      // Mark ALL npm packages as external — they'll be resolved from
      // a vendored node_modules at runtime.
      // Only bundle workspace code (@ping/* packages + backend source).
      packages: "external",

      // Loader for non-JS files
      loader: {
        ".yaml": "text",
        ".yml": "text",
        ".md": "text",
        ".txt": "text",
        ".node": "file",
      },

      define: {
        "process.env.NODE_ENV": '"production"',
      },

      logLevel: "warning",
    });

    const stats = fs.statSync(outFile);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`[bundle-backend] Done: ${sizeMB} MB`);

    if (result.warnings.length > 0) {
      console.warn(`[bundle-backend] ${result.warnings.length} warnings`);
    }
  } catch (err) {
    console.error("[bundle-backend] Build failed:", err);
    process.exit(1);
  }
}

bundle();
