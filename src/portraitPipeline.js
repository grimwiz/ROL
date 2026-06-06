const fs = require('fs');
const path = require('path');

const {
  effectiveComfyuiUrl,
  effectiveComfyuiEditModel,
  freeOllama
} = require('./scenarioInfo');

const QWEN_IMAGE_MODELS = {
  textEncoder: process.env.COMFYUI_QWEN_TEXT_ENCODER || 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: process.env.COMFYUI_QWEN_VAE || 'qwen_image_vae.safetensors'
};

const PORTRAIT_NEGATIVE_PROMPT = '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲';
const PORTRAIT_COMPOSITION = 'serious expression, three-quarters view, head-and-shoulders portrait, full head and hair fully visible with only a little space above the hair, the figure comfortably filling the frame, clear face, clear eyes';
const DEFAULT_PORTRAIT_STYLE = 'Art Nouveau portrait styling with a restrained Art Deco frame around the portrait, clean elegant linework, muted earthy palette with antique gold accents, painterly illustration, not photorealistic, not modern snapshot';

const PORTRAIT_RESTYLE_WORKFLOW_TEMPLATE = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype: 'default' } },
  '2': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.1 } },
  '3': { class_type: 'CLIPLoader', inputs: { clip_name: QWEN_IMAGE_MODELS.textEncoder, type: 'qwen_image', device: 'default' } },
  '6': { class_type: 'VAELoader', inputs: { vae_name: QWEN_IMAGE_MODELS.vae } },
  '11': { class_type: 'LoadImage', inputs: { image: 'ROL_source.png' } },
  '4': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['3', 0], vae: ['6', 0], image1: ['11', 0], prompt: '' } },
  '5': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['3', 0], vae: ['6', 0], image1: ['11', 0], prompt: PORTRAIT_NEGATIVE_PROMPT } },
  '12': { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['6', 0] } },
  '8': { class_type: 'KSampler', inputs: {
    model: ['2', 0], seed: 42, steps: 30, cfg: 3.5,
    sampler_name: 'euler', scheduler: 'simple',
    positive: ['4', 0], negative: ['5', 0], latent_image: ['12', 0], denoise: 1.0
  } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['6', 0] } },
  '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'ROL_restyle' } }
};

const EXT_TO_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp']
]);

let comfyModelCache = { expiresAt: 0, folders: null };

function makeError(message, statusCode) {
  const e = new Error(message);
  if (statusCode) e.statusCode = statusCode;
  return e;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRestyleInstruction(style, opts = {}) {
  const styleText = (typeof style === 'string' && style.trim()) ? style.trim() : DEFAULT_PORTRAIT_STYLE;
  const subjectText = String((opts && opts.subject) || '').trim();
  const backgroundText = String((opts && opts.background) || '').trim();
  const subject = subjectText ? ` The subject is ${subjectText}.` : '';
  // A background is ALWAYS requested now — the source crops sit on blank fields,
  // and without this the model just keeps that emptiness (the "halo"/"floats in
  // cream" complaint). A character-specific setting is preferred; otherwise a
  // fitting one in-palette.
  const background = backgroundText
    ? ` Set the subject against ${backgroundText}, rendered in the same palette and style, softly out of focus so the face stays dominant — never an empty, flat or single-colour backdrop.`
    : ' Give the portrait a fitting, softly-rendered background in the same palette — never an empty, flat or single-colour backdrop.';
  return `Redraw this photograph in the following art style: ${styleText}.${subject} Preserve the person's identity, facial likeness, apparent age and build, but fully restyle the colours, palette, linework and rendering to match. ${PORTRAIT_COMPOSITION}.${background} No text, no watermark.`;
}

function decodeImageDataUrl(value) {
  const s = String(value || '').trim();
  const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(s);
  if (!m) throw makeError('A portrait image data URL is required', 400);
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) {
    throw makeError('Portrait image is empty or too large (max 12 MB)', 400);
  }
  return { buffer, ext };
}

function dataUrlFromBuffer(buffer, contentType) {
  return `data:${contentType || 'image/png'};base64,${Buffer.from(buffer).toString('base64')}`;
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!m) throw makeError('A generated image data URL is required', 400);
  return { contentType: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
}

function imageFileToDataUrl(filePath) {
  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) throw makeError(`Image file not found: ${full}`, 404);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw makeError(`Image path is not a file: ${full}`, 400);
  if (stat.size > 12 * 1024 * 1024) throw makeError('Portrait image is too large (max 12 MB)', 400);
  const ext = path.extname(full).toLowerCase();
  const contentType = EXT_TO_MIME.get(ext);
  if (!contentType) throw makeError(`Unsupported image extension: ${ext || '(none)'}`, 400);
  return dataUrlFromBuffer(fs.readFileSync(full), contentType);
}

async function uploadImageToComfy(buffer, ext) {
  const filename = `ROL_source_${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`;
  const form = new FormData();
  form.append('image', new Blob([buffer]), filename);
  form.append('overwrite', 'true');
  const up = await fetch(`${effectiveComfyuiUrl()}/upload/image`, { method: 'POST', body: form });
  if (!up.ok) throw makeError(`ComfyUI rejected the image upload (HTTP ${up.status})`, 502);
  const j = await up.json().catch(() => ({}));
  const name = j && j.name ? j.name : filename;
  return j && j.subfolder ? `${j.subfolder}/${name}` : name;
}

async function fetchComfyModelNames(folder, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && comfyModelCache.folders && comfyModelCache.expiresAt > now && comfyModelCache.folders[folder]) {
    return comfyModelCache.folders[folder];
  }
  const upstream = await fetch(`${effectiveComfyuiUrl()}/models/${encodeURIComponent(folder)}`);
  if (!upstream.ok) throw makeError(`Could not query ComfyUI model folder ${folder} (HTTP ${upstream.status}).`, 502);
  const payload = await upstream.json();
  const rawNames = Array.isArray(payload) ? payload : Array.isArray(payload.models) ? payload.models : [];
  const names = rawNames
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') return String(entry.name || entry.filename || entry.model_name || '').trim();
      return '';
    })
    .filter(Boolean);
  comfyModelCache = {
    expiresAt: now + 60 * 1000,
    folders: { ...(comfyModelCache.folders || {}), [folder]: names }
  };
  return names;
}

async function ensureQwenPortraitAssets(diffusionModel) {
  const wanted = diffusionModel || effectiveComfyuiEditModel();
  const [diffusionModels, textEncoders, vaes] = await Promise.all([
    fetchComfyModelNames('diffusion_models'),
    fetchComfyModelNames('text_encoders'),
    fetchComfyModelNames('vae')
  ]);
  const missing = [];
  if (!diffusionModels.includes(wanted)) missing.push(`diffusion model ${wanted}`);
  if (!textEncoders.includes(QWEN_IMAGE_MODELS.textEncoder)) missing.push(`text encoder ${QWEN_IMAGE_MODELS.textEncoder}`);
  if (!vaes.includes(QWEN_IMAGE_MODELS.vae)) missing.push(`vae ${QWEN_IMAGE_MODELS.vae}`);
  return missing;
}

async function prepareGpuForImage(logger = () => {}) {
  try {
    const r = await freeOllama();
    logger('gpu.handoff', { to: 'image', ollama_freed: !!(r && r.freed) });
  } catch (e) {
    logger('gpu.handoff_error', { to: 'image', error: String((e && e.message) || e) });
  }
}

function parseNodeErrorSummary(nodeErrors) {
  return Object.entries(nodeErrors || {}).map(([nodeId, info]) => {
    const errs = (info && info.errors) || [];
    const msg = errs.map((e) => `${e.type || ''}: ${e.message || ''} ${e.details ? '(' + e.details + ')' : ''}`.trim()).join('; ');
    const cls = (info && info.class_type) ? ` [${info.class_type}]` : '';
    return `node ${nodeId}${cls} - ${msg || 'unknown error'}`;
  }).join(' | ');
}

function normaliseDenoise(value) {
  let denoise = parseFloat(value);
  if (!Number.isFinite(denoise)) denoise = 1.0;
  return Math.min(1, Math.max(0.6, denoise));
}

async function queuePortraitRestyle({ image, style = '', strength, subject = '', background = '', logger = () => {} }) {
  const editModel = effectiveComfyuiEditModel();
  const missingAssets = await ensureQwenPortraitAssets(editModel);
  if (missingAssets.length) {
    throw makeError(`Qwen image-edit workflow is not fully installed in ComfyUI: missing ${missingAssets.join(', ')}.`, 503);
  }

  const { buffer, ext } = decodeImageDataUrl(image);
  const uploadedName = await uploadImageToComfy(buffer, ext);
  const instruction = buildRestyleInstruction(style, { subject, background });
  const seed = Math.floor(Math.random() * 2 ** 31);
  const denoise = normaliseDenoise(strength);
  const workflow = JSON.parse(JSON.stringify(PORTRAIT_RESTYLE_WORKFLOW_TEMPLATE));
  workflow['1'].inputs.unet_name = editModel;
  workflow['11'].inputs.image = uploadedName;
  workflow['4'].inputs.prompt = instruction;
  workflow['8'].inputs.seed = seed;
  workflow['8'].inputs.denoise = denoise;

  logger('portrait.restyle', { editModel, sourceImage: uploadedName, seed, denoise });
  await prepareGpuForImage(logger);
  const upstream = await fetch(`${effectiveComfyuiUrl()}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  });
  const text = await upstream.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  if (!upstream.ok) throw makeError(`ComfyUI queue failed (HTTP ${upstream.status}). ${text.slice(0, 300)}`, 502);
  if (payload && payload.node_errors && Object.keys(payload.node_errors).length) {
    throw makeError(`ComfyUI validation failed: ${parseNodeErrorSummary(payload.node_errors)}`, 502);
  }
  const promptId = payload && payload.prompt_id;
  if (!promptId) throw makeError(`ComfyUI returned no prompt_id: ${text.slice(0, 200)}`, 502);
  return { promptId, sourceImage: uploadedName, seed, denoise, instruction, editModel };
}

async function fetchComfyHistory(promptId) {
  const upstream = await fetch(`${effectiveComfyuiUrl()}/history/${encodeURIComponent(promptId)}`);
  if (!upstream.ok) throw makeError(`Could not query ComfyUI history (HTTP ${upstream.status})`, 502);
  return upstream.json();
}

function findPromptImageRef(entry) {
  const outputs = (entry && entry.outputs) || {};
  const saveNode = Object.values(outputs).find((o) => o && o.images && o.images.length) || outputs['10'];
  return saveNode && saveNode.images && saveNode.images[0] ? saveNode.images[0] : null;
}

async function waitForPromptImage(promptId, { timeoutMs = 10 * 60 * 1000, pollMs = 2000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(pollMs);
    const history = await fetchComfyHistory(promptId);
    const entry = history && history[promptId];
    if (entry && entry.status && entry.status.completed) {
      const image = findPromptImageRef(entry);
      if (!image) throw makeError('ComfyUI finished but returned no image.', 502);
      return image;
    }
    if (entry && entry.status && entry.status.status_str === 'error') {
      const execErr = (entry.status.messages || []).slice().reverse()
        .find((m) => Array.isArray(m) && m[0] === 'execution_error');
      if (execErr && execErr[1]) {
        const info = execErr[1];
        const where = info.node_type ? ` in ${info.node_type} (node ${info.node_id})` : '';
        throw makeError(`ComfyUI error${where}: ${info.exception_message || info.exception_type || 'unknown'}`, 502);
      }
      throw makeError('ComfyUI reported an error. Check the ComfyUI server log for details.', 502);
    }
  }
  throw makeError('Timed out waiting for ComfyUI.', 504);
}

async function fetchGeneratedImageDataUrl(ref) {
  const url = new URL(`${effectiveComfyuiUrl()}/view`);
  url.searchParams.set('filename', String(ref.filename));
  if (ref.subfolder) url.searchParams.set('subfolder', String(ref.subfolder));
  url.searchParams.set('type', String(ref.type || 'output'));
  const upstream = await fetch(url);
  if (!upstream.ok) throw makeError(`Could not fetch generated image from ComfyUI (HTTP ${upstream.status})`, 502);
  const contentType = String(upstream.headers.get('content-type') || 'image/png').split(';')[0].trim() || 'image/png';
  const buffer = Buffer.from(await upstream.arrayBuffer());
  return dataUrlFromBuffer(buffer, contentType);
}

async function restylePortraitImage({ image, style = '', strength, subject = '', background = '', timeoutMs, pollMs, logger } = {}) {
  const queued = await queuePortraitRestyle({ image, style, strength, subject, background, logger });
  const ref = await waitForPromptImage(queued.promptId, { timeoutMs, pollMs });
  const dataUrl = await fetchGeneratedImageDataUrl(ref);
  return { ...queued, image: ref, dataUrl };
}

module.exports = {
  DEFAULT_PORTRAIT_STYLE,
  buildRestyleInstruction,
  decodeImageDataUrl,
  dataUrlToBuffer,
  imageFileToDataUrl,
  queuePortraitRestyle,
  restylePortraitImage,
  waitForPromptImage,
  fetchGeneratedImageDataUrl
};
