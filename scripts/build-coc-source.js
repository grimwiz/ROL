#!/usr/bin/env node
//
// Build a clean OCR text seed for the Call of Cthulhu 2e box set.
//
// The bundled scan (private/call-of-cthulhu-2e/CoC 2nd Edition Box Set.pdf) ships
// a 2008-era Adobe Paper-Capture OCR layer that is unusable garbage. This tool
// re-rasterises each page at a high DPI and runs a modern Tesseract pass, which
// is near-perfect on the prose. The text it produces is a DRAFT: a human/Claude
// pass still has to correct tables, stat blocks, and multi-column layout against
// the page image before the result is trustworthy as a verbatim source. The
// distilled, paraphrased rules corpus is built from that corrected verbatim text,
// the same way the RoL corpus was built from a clean digital source.
//
// Output (all under gitignored private/, because the text is copyrighted):
//   extracted-source/pdf-text/pNNN.txt   - raw Tesseract OCR per page
//   extracted-source/ocr-manifest.json   - run metadata + per-page status
//
// 200-DPI page PNGs for visual review already live in extracted-source/pages/
// (produced separately by pdftoppm); this script renders its own transient
// high-DPI image per page for OCR and removes it unless --keep-images is set.
//
// Usage:
//   node scripts/build-coc-source.js [--pages A-B] [--dpi N] [--psm N] [--keep-images]
//   npm run extract:coc -- --pages 46-149

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'private', 'call-of-cthulhu-2e');
const SOURCE = path.join(BASE, 'CoC 2nd Edition Box Set.pdf');
const OUT_DIR = path.join(BASE, 'extracted-source');
const TEXT_DIR = path.join(OUT_DIR, 'pdf-text');
const MANIFEST_FILE = path.join(OUT_DIR, 'ocr-manifest.json');

function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const keepImages = process.argv.includes('--keep-images');
const dpi = parseInt(argVal('--dpi', '300'), 10);
const psm = argVal('--psm', '3'); // 3 = full auto with layout/column analysis
const pagesArg = argVal('--pages', null);

function which(bin) {
  try { execFileSync('which', [bin], { stdio: 'pipe' }); return true; }
  catch { return false; }
}
for (const bin of ['pdfinfo', 'pdftoppm', 'tesseract']) {
  if (!which(bin)) { console.error(`Missing required tool: ${bin}`); process.exit(1); }
}
if (!fs.existsSync(SOURCE)) { console.error(`Source PDF not found: ${SOURCE}`); process.exit(1); }

const pageCount = (() => {
  const out = execFileSync('pdfinfo', [SOURCE], { encoding: 'utf8' });
  const m = out.match(/Pages:\s+(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
})();

let [first, last] = [1, pageCount];
if (pagesArg) {
  const m = pagesArg.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) { console.error(`Bad --pages value: ${pagesArg}`); process.exit(1); }
  first = parseInt(m[1], 10);
  last = m[2] ? parseInt(m[2], 10) : first;
}

fs.mkdirSync(TEXT_DIR, { recursive: true });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ocr-'));

const pad = (n) => String(n).padStart(3, '0');
const results = [];
console.log(`OCR pages ${first}-${last} of ${pageCount} @ ${dpi}dpi (psm ${psm})`);

for (let p = first; p <= last; p++) {
  const stem = path.join(tmpDir, `p-${pad(p)}`);
  execFileSync('pdftoppm', ['-r', String(dpi), '-gray', '-png', '-f', String(p), '-l', String(p), SOURCE, stem], { stdio: 'pipe' });
  // pdftoppm appends a zero-padded page number sized to the document.
  const png = fs.readdirSync(tmpDir).map((f) => path.join(tmpDir, f)).find((f) => f.startsWith(stem) && f.endsWith('.png'));
  if (!png) { console.error(`  p${pad(p)}: render failed`); results.push({ page: p, ok: false }); continue; }

  // Some pages (e.g. the sideways Timeline table) are printed in landscape, so the
  // upright OCR returns garbage. Detect orientation with Tesseract's OSD and rotate
  // the render upright (via PIL) before the real OCR pass.
  let rotated = 0;
  try {
    const osd = execFileSync('tesseract', [png, '-', '--psm', '0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = osd.match(/Rotate:\s+(\d+)/);
    rotated = m ? parseInt(m[1], 10) % 360 : 0;
  } catch { rotated = 0; }
  if (rotated) {
    // OSD "Rotate: N" = clockwise degrees needed to make upright; PIL rotates CCW.
    execFileSync('python3', ['-c',
      `from PIL import Image;im=Image.open(${JSON.stringify(png)});im.rotate(${-rotated},expand=True).save(${JSON.stringify(png)})`],
      { stdio: 'pipe' });
  }

  const txtPath = path.join(TEXT_DIR, `p${pad(p)}.txt`);
  const text = execFileSync('tesseract', [png, '-', '--psm', psm, '-l', 'eng'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(txtPath, text);
  if (rotated) process.stdout.write(`  p${pad(p)}: auto-rotated ${rotated}°\n`);
  const chars = text.trim().length;
  results.push({ page: p, ok: true, chars, file: path.relative(ROOT, txtPath) });
  process.stdout.write(`  p${pad(p)}: ${chars} chars\n`);

  if (keepImages) {
    const keepDir = path.join(OUT_DIR, `pages-${dpi}dpi`);
    fs.mkdirSync(keepDir, { recursive: true });
    fs.copyFileSync(png, path.join(keepDir, `p-${pad(p)}.png`));
  }
  fs.unlinkSync(png);
}

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.writeFileSync(MANIFEST_FILE, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: path.relative(ROOT, SOURCE),
  tool: 'tesseract',
  dpi, psm, pageCount, range: [first, last],
  note: 'Raw OCR draft. Tables/stat blocks/columns need a Claude+image correction pass before use.',
  pages: results,
}, null, 2));
console.log(`Wrote ${results.filter((r) => r.ok).length} page text files to ${path.relative(ROOT, TEXT_DIR)}`);
console.log(`Manifest: ${path.relative(ROOT, MANIFEST_FILE)}`);
