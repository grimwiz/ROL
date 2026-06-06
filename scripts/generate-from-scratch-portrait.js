#!/usr/bin/env node

// Generate NPC portraits FROM SCRATCH (text-to-image) for characters with no
// Portrait-Pack source crop — Karnam (a pre-gen investigator) and the Spirit of
// Books (an invented entity). Uses the BASE Qwen-Image model (the t2i sibling of
// the edit model), so the result lands in the same Art-Nouveau house style as
// the restyled portraits.
//
//   node scripts/generate-from-scratch-portrait.js --only the-spirit-of-books-and-reading
//   node scripts/generate-from-scratch-portrait.js --write     # all, embed JPEG into JSON
//
// Review PNGs go to private/portrait-review/. --write also embeds a compressed
// JPEG into <slug>.json (creating Karnam's sheet if absent).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { effectiveComfyuiUrl, freeOllama } = require('../src/scenarioInfo');
const {
  DEFAULT_PORTRAIT_STYLE,
  waitForPromptImage,
  fetchGeneratedImageDataUrl,
  dataUrlToBuffer
} = require('../src/portraitPipeline');

const JSON_DIR = path.join(__dirname, '..', 'Rivers_of_London', 'globaldata', 'npcs');
const REVIEW_DIR = path.join(__dirname, '..', 'private', 'portrait-review');
const JPEG_QUALITY = '6';

const COMPOSITION = 'head-and-shoulders portrait, three-quarters view, the figure comfortably filling the frame, clear face, clear eyes';
const NEGATIVE = 'low quality, low resolution, deformed, extra fingers, bad anatomy, text, caption, watermark, signature, blurry, oversaturated';

const ENTRIES = {
  'the-spirit-of-books-and-reading': {
    createSheet: false,
    subject: 'an ethereal, newly-formed spirit in the shape of a young person, its form half-dissolving into drifting open book-pages and floating letters and words, luminous and uncanny, eyes alight with curiosity',
    background: 'towering shadowy library bookshelves receding into darkness'
  },
  'pc-karnam-singh': {
    // Karnam's authoritative sheet lives in the bookshop case, NOT globaldata —
    // writing a second copy to globaldata creates a duplicate that reimport then
    // overwrites (last file by name wins), wiping the portrait. Target the real one.
    jsonPath: 'Rivers_of_London/canonical/cases/bookshop/npcs/pc-karnam-singh.json',
    subject: 'a British Sikh man in his late twenties with a neatly tied dark turban (dastaar) and a trimmed black beard, calm and steady, in a smart shirt',
    background: 'a softly out-of-focus London police station interior'
  }
};

const T2I_WORKFLOW = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2512_fp8_e4m3fn.safetensors', weight_dtype: 'default' } },
  '2': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.1 } },
  '3': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default' } },
  '6': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
  '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: '' } },
  '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: NEGATIVE } },
  '7': { class_type: 'EmptySD3LatentImage', inputs: { width: 672, height: 768, batch_size: 1 } },
  '8': { class_type: 'KSampler', inputs: {
    model: ['2', 0], seed: 42, steps: 30, cfg: 3.5,
    sampler_name: 'euler', scheduler: 'simple',
    positive: ['4', 0], negative: ['5', 0], latent_image: ['7', 0], denoise: 1.0
  } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['6', 0] } },
  '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'ROL_t2i' } }
};

function buildPrompt(subject, background) {
  return `${DEFAULT_PORTRAIT_STYLE}. A portrait of ${subject}. ${COMPOSITION}. Set against ${background}, rendered softly out of focus in the same palette — never an empty or flat backdrop. No text, no watermark.`;
}

function pngBufferToJpegDataUrl(pngBuffer) {
  const inTmp = path.join(os.tmpdir(), `rol_t2i_in_${process.pid}_${Math.random().toString(36).slice(2)}.png`);
  const outTmp = inTmp.replace(/\.png$/, '.jpg');
  try {
    fs.writeFileSync(inTmp, pngBuffer);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inTmp, '-q:v', JPEG_QUALITY, outTmp]);
    const buf = fs.readFileSync(outTmp);
    return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, bytes: buf.length };
  } finally {
    try { fs.unlinkSync(inTmp); } catch {}
    try { fs.unlinkSync(outTmp); } catch {}
  }
}

async function queueT2I(prompt) {
  const wf = JSON.parse(JSON.stringify(T2I_WORKFLOW));
  wf['4'].inputs.text = prompt;
  wf['8'].inputs.seed = Math.floor(Math.random() * 2 ** 31);
  try { await freeOllama(); } catch {}
  const res = await fetch(`${effectiveComfyuiUrl()}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: wf })
  });
  const text = await res.text();
  let payload = null; try { payload = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`ComfyUI queue failed (HTTP ${res.status}): ${text.slice(0, 400)}`);
  if (payload && payload.node_errors && Object.keys(payload.node_errors).length) {
    throw new Error(`ComfyUI validation failed: ${JSON.stringify(payload.node_errors).slice(0, 600)}`);
  }
  if (!payload || !payload.prompt_id) throw new Error(`No prompt_id: ${text.slice(0, 300)}`);
  return payload.prompt_id;
}

function parseArgs(argv) {
  const args = { only: null, write: false, embed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--embed') args.embed = true;
    else if (a === '--only') args.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function embedBufferIntoJson(slug, entry, buffer) {
  const jsonPath = entry.jsonPath
    ? path.join(__dirname, '..', entry.jsonPath)
    : path.join(JSON_DIR, `${slug}.json`);
  let obj;
  if (fs.existsSync(jsonPath)) {
    obj = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } else if (entry.createSheet) {
    obj = { name: entry.sheet.name, scope: [], role: '', status: '', location: '', summary: '', notes: '', sheet: { ...entry.sheet } };
    console.log(`  created new sheet ${path.basename(jsonPath)}`);
  } else {
    console.error(`  no JSON and createSheet=false: ${jsonPath}`); return;
  }
  if (!obj.sheet || typeof obj.sheet !== 'object') obj.sheet = {};
  const { dataUrl: jpeg, bytes } = pngBufferToJpegDataUrl(buffer);
  obj.sheet.portrait = jpeg;
  fs.writeFileSync(jsonPath, `${JSON.stringify(obj, null, 2)}\n`);
  console.log(`  embedded -> ${path.basename(jsonPath)} sheet.portrait (jpeg ${(bytes / 1024).toFixed(0)} KB)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slugs = (args.only || Object.keys(ENTRIES)).filter((s) => ENTRIES[s] || (console.warn(`skip ${s}: not in table`), false));
  fs.mkdirSync(REVIEW_DIR, { recursive: true });

  for (const slug of slugs) {
    const e = ENTRIES[slug];
    const reviewPath = path.join(REVIEW_DIR, `${slug}.png`);
    console.log(`\n=== ${slug} (text-to-image) ===`);

    let buffer;
    if (args.embed) {
      if (!fs.existsSync(reviewPath)) { console.error(`  no review PNG: ${reviewPath}`); continue; }
      buffer = fs.readFileSync(reviewPath);
    } else {
      const prompt = buildPrompt(e.subject, e.background);
      const promptId = await queueT2I(prompt);
      console.log(`  queued prompt_id=${promptId}`);
      const ref = await waitForPromptImage(promptId, { timeoutMs: 600000 });
      const dataUrl = await fetchGeneratedImageDataUrl(ref);
      buffer = dataUrlToBuffer(dataUrl).buffer;
      fs.writeFileSync(reviewPath, buffer);
      console.log(`  review -> ${reviewPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
    }

    if (args.write || args.embed) embedBufferIntoJson(slug, e, buffer);
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error(`error: ${e.message || e}`); process.exit(1); });
