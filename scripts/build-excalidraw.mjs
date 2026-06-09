// Dev-time vendoring build: bundles the Excalidraw React editor + React itself
// into self-contained static assets under public/vendor/excalidraw/, which the
// build-less app then serves directly (no bundler at runtime, fully offline).
//
// Run after bumping the @excalidraw/excalidraw version:  npm run build:excalidraw
//
// Design notes:
// - format esm + splitting:true keeps Excalidraw's module Web Worker and its
//   ~60 lazy import() chunks intact (a single IIFE would break the worker).
// - React/ReactDOM are bundled IN (not externalised), so there is no import-map
//   and no CJS->ESM React interop to get wrong; one React instance throughout.
// - Fonts + locales are loaded at runtime from window.EXCALIDRAW_ASSET_PATH, so
//   they are copied verbatim and the host page points the asset path at them.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "public", "vendor", "excalidraw");
const exDist = join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "scripts", "excalidraw", "entry.jsx")],
  bundle: true,
  format: "esm",
  splitting: true,
  platform: "browser",
  // Excalidraw's package exports gate on a "production"/"development" condition
  // (its index.css subpath has no "default"), so select production explicitly.
  conditions: ["production", "module", "browser"],
  outdir,
  entryNames: "host",
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  minify: true,
  sourcemap: false,
  jsx: "automatic",
  metafile: false,
  loader: {
    ".woff2": "file",
    ".ttf": "file",
    ".png": "file",
    ".svg": "file",
    ".wasm": "file",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.IS_PREACT": '"false"',
  },
  logLevel: "info",
});

// Runtime assets Excalidraw fetches by URL (not via import) from the asset path.
// Trimmed for an English-only app: drop the heavy CJK handwriting font (Xiaolai,
// ~13MB of subset chunks — only used when CJK text is typed into a drawing,
// which falls back to a Western font here) and the non-English UI locales
// (missing locales fall back to the built-in English). To restore either,
// delete its trim step below and rebuild.
cpSync(join(exDist, "fonts"), join(outdir, "fonts"), { recursive: true });
rmSync(join(outdir, "fonts", "Xiaolai"), { recursive: true, force: true });

cpSync(join(exDist, "locales"), join(outdir, "locales"), { recursive: true });
for (const f of readdirSync(join(outdir, "locales"))) {
  if (!/^en[-.]/i.test(f)) rmSync(join(outdir, "locales", f), { force: true });
}

console.log("\nExcalidraw vendored to", outdir);
