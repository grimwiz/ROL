// Reusable letterhead library for the letter-handout composer.
//
// A "company" (sender) carries a name, a multi-line address and a logo image;
// a "signatory" carries a name, a title and a signature image. Both are GLOBAL
// — created once and reused across cases — so they live in their own DB tables
// (see db.js) with the images stored as PNGs under data/letterhead/<kind>/<id>/.
// The letter itself is composed in the Excalidraw editor (the structured bits
// here just seed the scene); see the compose helper in public/js/app.js.

const fs = require('fs');
const path = require('path');
const db = require('./db');

const LETTERHEAD_ROOT = path.join(__dirname, '..', 'data', 'letterhead');

function imageDir(kind, id) {
  return path.join(LETTERHEAD_ROOT, kind, String(id));
}

// Decode a data URL or bare base64 PNG into bytes. Returns null on anything we
// can't read so callers can answer 400 rather than write garbage.
function decodePng(png) {
  const b64 = String(png || '').replace(/^data:image\/png;base64,/, '').trim();
  if (!b64) return null;
  try {
    const bytes = Buffer.from(b64, 'base64');
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

// ── Companies ────────────────────────────────────────────────────────────────

function companyView(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, address: row.address || '', has_logo: !!row.logo_path,
    logo_prompt: row.logo_prompt || '', ai_hint: row.ai_hint || ''
  };
}

function listCompanies() {
  return db.prepare('SELECT id, name, address, logo_path, logo_prompt, ai_hint FROM letter_companies ORDER BY name COLLATE NOCASE')
    .all().map(companyView);
}

function getCompanyRow(id) {
  return db.prepare('SELECT id, name, address, logo_path, logo_prompt, ai_hint FROM letter_companies WHERE id = ?').get(id) || null;
}

function createCompany({ name, address, logo_prompt, ai_hint } = {}) {
  const nm = String(name || '').trim();
  if (!nm) { const e = new Error('A company name is required'); e.statusCode = 400; throw e; }
  const addr = String(address || '').trim() || null;
  const lp = String(logo_prompt || '').trim() || null;
  const hint = String(ai_hint || '').trim() || null;
  const info = db.prepare('INSERT INTO letter_companies (name, address, logo_prompt, ai_hint) VALUES (?, ?, ?, ?)')
    .run(nm, addr, lp, hint);
  return companyView(getCompanyRow(info.lastInsertRowid));
}

function updateCompany(id, { name, address, logo_prompt, ai_hint } = {}) {
  const row = getCompanyRow(id);
  if (!row) { const e = new Error('Company not found'); e.statusCode = 404; throw e; }
  const nm = name === undefined ? row.name : (String(name || '').trim() || row.name);
  const addr = address === undefined ? row.address : (String(address || '').trim() || null);
  const lp = logo_prompt === undefined ? row.logo_prompt : (String(logo_prompt || '').trim() || null);
  const hint = ai_hint === undefined ? row.ai_hint : (String(ai_hint || '').trim() || null);
  db.prepare('UPDATE letter_companies SET name = ?, address = ?, logo_prompt = ?, ai_hint = ? WHERE id = ?')
    .run(nm, addr, lp, hint, id);
  return companyView(getCompanyRow(id));
}

function deleteCompany(id) {
  const row = getCompanyRow(id);
  if (!row) { const e = new Error('Company not found'); e.statusCode = 404; throw e; }
  db.prepare('DELETE FROM letter_companies WHERE id = ?').run(id);
  try { fs.rmSync(imageDir('companies', id), { recursive: true, force: true }); } catch { /* non-fatal */ }
  return { deleted: true };
}

// Store/replace a company's logo PNG (from an upload or a kept ComfyUI render).
function saveCompanyLogo(id, png) {
  const row = getCompanyRow(id);
  if (!row) { const e = new Error('Company not found'); e.statusCode = 404; throw e; }
  const bytes = decodePng(png);
  if (!bytes) { const e = new Error('Logo image could not be decoded'); e.statusCode = 400; throw e; }
  const dir = imageDir('companies', id);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, 'logo.png');
  fs.writeFileSync(abs, bytes);
  const rel = path.relative(path.join(__dirname, '..'), abs).split(path.sep).join('/');
  db.prepare('UPDATE letter_companies SET logo_path = ? WHERE id = ?').run(rel, id);
  return companyView(getCompanyRow(id));
}

function companyLogoFile(id) {
  const row = getCompanyRow(id);
  if (!row || !row.logo_path) return null;
  const abs = path.join(__dirname, '..', row.logo_path);
  return fs.existsSync(abs) ? abs : null;
}

// ── Signatories ──────────────────────────────────────────────────────────────

function signatoryView(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, title: row.title || '',
    has_signature: !!row.signature_path, persona_slug: row.persona_slug || '',
    signature_prompt: row.signature_prompt || '', signoff: row.signoff || ''
  };
}

function listSignatories() {
  return db.prepare('SELECT id, name, title, signature_path, persona_slug, signature_prompt, signoff FROM letter_signatories ORDER BY name COLLATE NOCASE')
    .all().map(signatoryView);
}

function getSignatoryRow(id) {
  return db.prepare('SELECT id, name, title, signature_path, persona_slug, signature_prompt, signoff FROM letter_signatories WHERE id = ?').get(id) || null;
}

function createSignatory({ name, title, persona_slug, signature_prompt, signoff } = {}) {
  const nm = String(name || '').trim();
  if (!nm) { const e = new Error('A signatory name is required'); e.statusCode = 400; throw e; }
  const ttl = String(title || '').trim() || null;
  const slug = String(persona_slug || '').trim() || null;
  const sp = String(signature_prompt || '').trim() || null;
  const so = String(signoff || '').trim() || null;
  const info = db.prepare('INSERT INTO letter_signatories (name, title, persona_slug, signature_prompt, signoff) VALUES (?, ?, ?, ?, ?)')
    .run(nm, ttl, slug, sp, so);
  return signatoryView(getSignatoryRow(info.lastInsertRowid));
}

function updateSignatory(id, { name, title, persona_slug, signature_prompt, signoff } = {}) {
  const row = getSignatoryRow(id);
  if (!row) { const e = new Error('Signatory not found'); e.statusCode = 404; throw e; }
  const nm = name === undefined ? row.name : (String(name || '').trim() || row.name);
  const ttl = title === undefined ? row.title : (String(title || '').trim() || null);
  const slug = persona_slug === undefined ? row.persona_slug : (String(persona_slug || '').trim() || null);
  const sp = signature_prompt === undefined ? row.signature_prompt : (String(signature_prompt || '').trim() || null);
  const so = signoff === undefined ? row.signoff : (String(signoff || '').trim() || null);
  db.prepare('UPDATE letter_signatories SET name = ?, title = ?, persona_slug = ?, signature_prompt = ?, signoff = ? WHERE id = ?')
    .run(nm, ttl, slug, sp, so, id);
  return signatoryView(getSignatoryRow(id));
}

function deleteSignatory(id) {
  const row = getSignatoryRow(id);
  if (!row) { const e = new Error('Signatory not found'); e.statusCode = 404; throw e; }
  db.prepare('DELETE FROM letter_signatories WHERE id = ?').run(id);
  try { fs.rmSync(imageDir('signatories', id), { recursive: true, force: true }); } catch { /* non-fatal */ }
  return { deleted: true };
}

function saveSignatureImage(id, png) {
  const row = getSignatoryRow(id);
  if (!row) { const e = new Error('Signatory not found'); e.statusCode = 404; throw e; }
  const bytes = decodePng(png);
  if (!bytes) { const e = new Error('Signature image could not be decoded'); e.statusCode = 400; throw e; }
  const dir = imageDir('signatories', id);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, 'signature.png');
  fs.writeFileSync(abs, bytes);
  const rel = path.relative(path.join(__dirname, '..'), abs).split(path.sep).join('/');
  db.prepare('UPDATE letter_signatories SET signature_path = ? WHERE id = ?').run(rel, id);
  return signatoryView(getSignatoryRow(id));
}

function signatureFile(id) {
  const row = getSignatoryRow(id);
  if (!row || !row.signature_path) return null;
  const abs = path.join(__dirname, '..', row.signature_path);
  return fs.existsSync(abs) ? abs : null;
}

module.exports = {
  listCompanies, createCompany, updateCompany, deleteCompany, saveCompanyLogo, companyLogoFile,
  listSignatories, createSignatory, updateSignatory, deleteSignatory, saveSignatureImage, signatureFile,
};
