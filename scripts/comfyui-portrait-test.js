#!/usr/bin/env node
// Local sanity test for ComfyUI portrait img2img stylisation.
//
// Usage:
//   node scripts/comfyui-portrait-test.js <input-image> [occupation] [skill]
//
// Example:
//   node scripts/comfyui-portrait-test.js me.jpg "police officer attached to an occult unit" "Sense Vestigia"
//
// Requires Node 18+ (for built-in fetch/FormData/Blob).
//
// Environment:
//   COMFYUI_URL       - base URL, default https://comfyui.gledhow.dragonscale.net
//   COMFYUI_WORKFLOW  - path to API-format workflow JSON, default ./scripts/comfyui-portrait-workflow.json
//
// Output is written to ./comfyui-output.png in the current working directory.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COMFYUI_URL = (process.env.COMFYUI_URL || 'https://comfyui.gledhow.dragonscale.net').replace(/\/+$/, '');
const WORKFLOW_PATH = process.env.COMFYUI_WORKFLOW || path.join(__dirname, 'comfyui-portrait-workflow.json');

const inputPath = process.argv[2];
const occupation = process.argv[3] || 'police officer attached to an occult unit';
const topSkill   = process.argv[4] || 'Sense Vestigia — attuned to magical residue';

if (!inputPath) {
  console.error('Usage: node scripts/comfyui-portrait-test.js <input-image> [occupation] [skill]');
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`Input image not found: ${inputPath}`);
  process.exit(1);
}
if (!fs.existsSync(WORKFLOW_PATH)) {
  console.error(`Workflow file not found: ${WORKFLOW_PATH}`);
  process.exit(1);
}

// --------------------------------------------------------------------- prompt

const PROMPT_TEMPLATE = (occ, skill) =>
  `head-and-shoulders portrait of a man, ${occ}, known for ${skill}, ` +
  `contemporary London setting, Alphonse Mucha art nouveau style, painterly linework, ` +
  `decorative halo and floral border motifs, muted earthy palette with a single accent colour, ` +
  `soft flat lighting, serious expression, three-quarters view, illustration, no text, no watermark`;

// --------------------------------------------------------------------- helpers

const clientId = crypto.randomUUID();

async function uploadImage(localPath) {
  const data = fs.readFileSync(localPath);
  const form = new FormData();
  form.set('image', new Blob([data]), path.basename(localPath));
  form.set('overwrite', 'true');

  const res = await fetch(`${COMFYUI_URL}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Upload failed: HTTP ${res.status} ${txt}`);
  }
  const json = await res.json();
  // { name, subfolder, type } — we want the name that ComfyUI stored it under.
  return json.name;
}

async function queuePrompt(workflow) {
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`/prompt failed: HTTP ${res.status} ${txt}`);
  }
  const json = await res.json();
  if (!json.prompt_id) throw new Error(`No prompt_id in response: ${JSON.stringify(json)}`);
  return json.prompt_id;
}

async function waitForHistory(promptId, { timeoutMs = 10 * 60 * 1000, pollMs = 2000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${COMFYUI_URL}/history/${promptId}`);
    if (res.ok) {
      const json = await res.json();
      const entry = json[promptId];
      if (entry && entry.status && entry.status.completed) return entry;
      if (entry && entry.status && entry.status.status_str === 'error') {
        throw new Error(`ComfyUI error: ${JSON.stringify(entry.status, null, 2)}`);
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
    process.stdout.write('.');
  }
  throw new Error('Timed out waiting for ComfyUI to finish.');
}

async function fetchOutputImage({ filename, subfolder, type }) {
  const url = new URL(`${COMFYUI_URL}/view`);
  url.searchParams.set('filename', filename);
  if (subfolder) url.searchParams.set('subfolder', subfolder);
  url.searchParams.set('type', type || 'output');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`/view failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// --------------------------------------------------------------------- main

(async () => {
  console.log(`ComfyUI: ${COMFYUI_URL}`);
  console.log(`Workflow: ${WORKFLOW_PATH}`);

  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

  // 1. Upload input photo
  console.log(`→ uploading ${inputPath}`);
  const uploadedName = await uploadImage(inputPath);
  console.log(`  stored as: ${uploadedName}`);

  // 2. Substitute inputs into the workflow
  // Node 2 = LoadImage, node 4 = positive text, node 6 = KSampler (seed)
  if (workflow['2'] && workflow['2'].inputs) workflow['2'].inputs.image = uploadedName;
  if (workflow['4'] && workflow['4'].inputs) workflow['4'].inputs.text = PROMPT_TEMPLATE(occupation, topSkill);
  if (workflow['6'] && workflow['6'].inputs) workflow['6'].inputs.seed = Math.floor(Math.random() * 2 ** 31);

  console.log(`Prompt: ${workflow['4'].inputs.text.slice(0, 120)}...`);

  // 3. Queue
  const promptId = await queuePrompt(workflow);
  console.log(`Queued: ${promptId}`);
  process.stdout.write('Waiting');

  // 4. Poll for completion
  const entry = await waitForHistory(promptId);
  console.log('\nDone.');

  // 5. Locate the saved image in the history outputs
  const outputs = entry.outputs || {};
  const saveNode = outputs['8'] || Object.values(outputs).find((o) => o && o.images);
  if (!saveNode || !saveNode.images || !saveNode.images.length) {
    console.error('No image in outputs. Full entry:');
    console.error(JSON.stringify(entry, null, 2));
    process.exit(2);
  }
  const img = saveNode.images[0];

  // 6. Download it
  const buf = await fetchOutputImage(img);
  const outPath = path.resolve('comfyui-output.png');
  fs.writeFileSync(outPath, buf);
  console.log(`\nSaved ${outPath} (${buf.length} bytes).`);
  console.log(`ComfyUI history: ${COMFYUI_URL}/history/${promptId}`);
})().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(3);
});
