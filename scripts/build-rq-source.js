#!/usr/bin/env node
//
// Build a clean OCR text seed for the RuneQuest 2nd Edition rulebook.
//
// The bundled scan (private/runequest-2e/CH4001 - Runequest - Rules 2nd edition.pdf)
// has NO text layer at all, so pdftotext yields nothing. This tool rasterises each
// page at a high DPI and runs a modern Tesseract pass, which is clean on the prose.
// The text it produces is a DRAFT: a human/Claude pass still has to correct tables,
// stat blocks, and the two-column layout against the page image before the result is
// trustworthy. The distilled, paraphrased rules corpus is built from that corrected
// text, the same way the CoC and RoL corpora were built.
//
// Output (all under gitignored private/, because the text is copyrighted):
//   extracted-source/pdf-text/pNNN.txt   - raw Tesseract OCR per page (high DPI)
//   extracted-source/pages/p-NNN.png     - persistent 200-DPI page image for the gate
//   extracted-source/ocr-manifest.json   - run metadata + per-page status
//
// Usage:
//   node scripts/build-rq-source.js [--pages A-B] [--dpi N] [--psm N] [--no-pages]
//   npm run extract:rq -- --pages 8-20

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'private', 'runequest-2e');
const SOURCE = path.join(BASE, 'CH4001 - Runequest - Rules 2nd edition.pdf');
const OUT_DIR = path.join(BASE, 'extracted-source');
const TEXT_DIR = path.join(OUT_DIR, 'pdf-text');
const PAGES_DIR = path.join(OUT_DIR, 'pages');
const MANIFEST_FILE = path.join(OUT_DIR, 'ocr-manifest.json');

function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const dpi = parseInt(argVal('--dpi', '300'), 10);
const psm = argVal('--psm', '3'); // 3 = full auto with layout/column analysis
const pagesArg = argVal('--pages', null);
const renderPages = !process.argv.includes('--no-pages');
const pagesDpi = parseInt(argVal('--pages-dpi', '200'), 10);

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
if (renderPages) fs.mkdirSync(PAGES_DIR, { recursive: true });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rq-ocr-'));

const pad = (n) => String(n).padStart(3, '0');
const results = [];
console.log(`OCR pages ${first}-${last} of ${pageCount} @ ${dpi}dpi (psm ${psm}); pages ${renderPages ? pagesDpi + 'dpi' : 'skipped'}`);

for (let p = first; p <= last; p++) {
  const stem = path.join(tmpDir, `p-${pad(p)}`);
  execFileSync('pdftoppm', ['-r', String(dpi), '-gray', '-png', '-f', String(p), '-l', String(p), SOURCE, stem], { stdio: 'pipe' });
  const png = fs.readdirSync(tmpDir).map((f) => path.join(tmpDir, f)).find((f) => f.startsWith(stem) && f.endsWith('.png'));
  if (!png) { console.error(`  p${pad(p)}: render failed`); results.push({ page: p, ok: false }); continue; }

  // Detect landscape/rotated pages via Tesseract OSD and rotate upright (via PIL).
  let rotated = 0;
  try {
    const osd = execFileSync('tesseract', [png, '-', '--psm', '0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = osd.match(/Rotate:\s+(\d+)/);
    rotated = m ? parseInt(m[1], 10) % 360 : 0;
  } catch { rotated = 0; }
  if (rotated) {
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

  // Persistent page image for the PDF gate (separate, lower DPI, colour-neutral).
  if (renderPages) {
    const pstem = path.join(PAGES_DIR, `p-${pad(p)}`);
    execFileSync('pdftoppm', ['-r', String(pagesDpi), '-png', '-f', String(p), '-l', String(p), SOURCE, pstem], { stdio: 'pipe' });
    const made = fs.readdirSync(PAGES_DIR).find((f) => f.startsWith(`p-${pad(p)}`) && f.endsWith('.png') && f !== `p-${pad(p)}.png`);
    if (made) fs.renameSync(path.join(PAGES_DIR, made), path.join(PAGES_DIR, `p-${pad(p)}.png`));
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
