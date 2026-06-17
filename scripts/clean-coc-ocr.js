#!/usr/bin/env node
//
// Turn raw Tesseract OCR (pdf-text/pNNN.txt) into readable verbatim markdown
// (pdf-text/pNNN.md) for the Call of Cthulhu 2e seed.
//
// This handles the MECHANICAL cleanup only — the tedium that is safe to
// automate: rejoining hard-wrapped lines into paragraphs, de-hyphenating words
// split across line breaks, stripping standalone running-page-number lines, and
// fixing a small dictionary of recurring OCR glyph errors (D10/D100 misread as
// DIO/DIOO, POWx5 as POWxS, etc.) and curly quotes. It does NOT fix semantic OCR
// errors or rebuild tables/stat blocks; those are corrected by hand against the
// page image (such pages carry `Status: verbatim` and are skipped here).
//
// Output is marked `Status: auto-clean` so the later PDF gate knows the prose
// still needs a visual spot-check, while the mechanically-critical pages
// (`Status: verbatim`) are already trustworthy.
//
// Usage: node scripts/clean-coc-ocr.js [--pages A-B] [--force]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEXT_DIR = path.join(ROOT, 'private', 'call-of-cthulhu-2e', 'extracted-source', 'pdf-text');

function argVal(name, def) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; }
const force = process.argv.includes('--force');
const pagesArg = argVal('--pages', null);

let [first, last] = [1, 999];
if (pagesArg) { const m = pagesArg.match(/^(\d+)(?:-(\d+))?$/); first = +m[1]; last = m[2] ? +m[2] : first; }

// Recurring OCR glyph fixes (word-boundary where it matters). Conservative.
const FIXES = [
  [/\bDIOO\b/g, 'D100'], [/\bD1OO\b/g, 'D100'], [/\bDIOQ\b/g, 'D100'],
  [/\bDIO\b/g, 'D10'], [/\bDLO\b/g, 'D10'], [/\bD1O\b/g, 'D10'],
  [/\bDJOO\b/g, 'D100'], [/\bDJ0O\b/g, 'D100'], [/\bDJO0O\b/g, 'D100'],
  [/\b([A-Z]{2,4})xS\b/g, '$1x5'],          // POWxS -> POWx5, INTxS -> INTx5
  [/\bPOWx5\b/g, 'POWx5'],
  [/([0-9])D6\.,/g, '$1D6.'],
];

function cleanPage(raw) {
  let lines = raw.replace(/\r\n/g, '\n').split('\n');
  // Drop standalone running page numbers like "- 15 -", "-18-", "238-3", "- y:".
  lines = lines.filter((l) => {
    const t = l.trim();
    if (/^[-=]{0,3}\s*\d{1,3}\s*[-=:]{0,3}$/.test(t)) return false;     // - 15 -
    if (/^\d{1,4}[-:]\d{1,3}$/.test(t)) return false;                    // 238-3
    if (/^-\s*[a-z]:?$/i.test(t)) return false;                          // - y:
    return true;
  });
  // Rejoin into paragraphs: blank line = break; else join, de-hyphenating.
  const paras = [];
  let cur = '';
  for (const line of lines) {
    const t = line.replace(/\s+$/, '');
    if (t.trim() === '') { if (cur.trim()) paras.push(cur.trim()); cur = ''; continue; }
    if (!cur) { cur = t.trim(); continue; }
    if (/[A-Za-z]-$/.test(cur)) cur = cur.replace(/-$/, '') + t.trim();   // dehyphenate
    else cur += ' ' + t.trim();
  }
  if (cur.trim()) paras.push(cur.trim());
  let out = paras.join('\n\n');
  // Normalise smart quotes/dashes, then apply glyph fixes.
  out = out.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/—/g, ' — ');
  for (const [re, to] of FIXES) out = out.replace(re, to);
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n');
  return out;
}

const files = fs.readdirSync(TEXT_DIR).filter((f) => /^p\d{3}\.txt$/.test(f)).sort();
let written = 0, skipped = 0;
for (const f of files) {
  const p = +f.slice(1, 4);
  if (p < first || p > last) continue;
  const mdPath = path.join(TEXT_DIR, `p${String(p).padStart(3, '0')}.md`);
  if (fs.existsSync(mdPath) && !force) {
    const head = fs.readFileSync(mdPath, 'utf8').slice(0, 200);
    if (/Status: verbatim/.test(head)) { skipped++; continue; }  // hand-corrected: never clobber
  }
  const raw = fs.readFileSync(path.join(TEXT_DIR, f), 'utf8');
  if (raw.trim().length < 20) { skipped++; continue; }            // blank/art page
  const body = cleanPage(raw);
  const header = `<!-- PDF p${p}. Status: auto-clean (OCR mechanically cleaned; prose not yet image-verified). -->\n\n`;
  fs.writeFileSync(mdPath, header + body + '\n');
  written++;
}
console.log(`clean-coc-ocr: wrote ${written}, skipped ${skipped} (hand-corrected or blank).`);
