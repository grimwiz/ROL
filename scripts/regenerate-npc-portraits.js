#!/usr/bin/env node

// Regenerate selected NPC portraits through the improved ComfyUI restyle
// pipeline, from the original Portrait-Pack source crops in
// private/rulebook-source/npc-portraits/<slug>.png.
//
// The key fix: we DO NOT feed the RPG "occupation" (Master Practitioner, Night
// Witch, Genius Loci...) to the image model — those produce nonsense. Each
// entry below carries a hand-written, plain-language SUBJECT (sex, apparent
// age, ethnicity, hair, attire) and a real, mundane BACKGROUND, drawn from the
// character's book/persona appearance. denoise 1.0 lets the Qwen-edit model
// actually restyle (low denoise just freezes the source).
//
//   node scripts/regenerate-npc-portraits.js                 # generate all -> review PNGs only
//   node scripts/regenerate-npc-portraits.js --only <slug>   # one
//   node scripts/regenerate-npc-portraits.js --write         # generate AND embed JPEG into JSON
//   node scripts/regenerate-npc-portraits.js --embed         # embed existing review PNGs into JSON (no GPU)
//
// Review PNGs land in private/portrait-review/. Embedding compresses to JPEG
// (~672x768) and writes data:image/jpeg into <slug>.json at sheet.portrait —
// the field reimport reads.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  imageFileToDataUrl,
  restylePortraitImage,
  dataUrlToBuffer
} = require('../src/portraitPipeline');

const SRC_DIR = path.join(__dirname, '..', 'private', 'rulebook-source', 'npc-portraits');
const JSON_DIR = path.join(__dirname, '..', 'Rivers_of_London', 'globaldata', 'npcs');
const REVIEW_DIR = path.join(__dirname, '..', 'private', 'portrait-review');
const JPEG_QUALITY = '6'; // ffmpeg -q:v (2=best .. 31=worst); ~120-160 KB at 672x768

// Hand-curated visual descriptors — NEVER the RPG occupation label.
const PORTRAITS = {
  'beverley-brook': {
    subject: 'a warm, confident young Black woman in her early twenties, dark braided hair, an easy half-smile',
    background: 'a soft, out-of-focus suggestion of river water, reeds and a green riverbank'
  },
  'dc-peter-grant': {
    subject: 'a mixed-heritage Black British man in his late twenties, short dark hair, in ordinary smart-casual clothes',
    background: 'a softly out-of-focus London street of Georgian brick terraces'
  },
  'dci-thomas-nightingale': {
    // The flagship character — keep close to the source crop: auburn hair swept
    // back, lean intelligent face. (Source has reddish-brown, not dark, hair.)
    subject: 'a distinguished white Englishman who appears in his mid-forties, with reddish-brown auburn hair swept back from the forehead, a lean intelligent clean-shaven face, in an immaculate old-fashioned tailored three-piece suit',
    background: 'a panelled Edwardian study lined with bookshelves, dimly and warmly lit'
  },
  'di-miriam-stephanopoulos': {
    subject: 'a solidly built middle-aged white woman with a very short, severe, cropped masculine hairstyle, in a plain dark trouser suit; unmistakably a woman',
    background: 'a police incident room, softly out of focus'
  },
  'varvara-sidorovna-tamonina': {
    subject: 'a striking, worn middle-aged Russian woman with hard pale eyes and faded fair hair',
    background: 'a dim, old-world panelled interior'
  },
  'dr-abdul-haqq-walid': {
    subject: 'a spry white Scottish man in his fifties with a high forehead and a receding ginger hairline, in a shirt and tie',
    background: 'a hint of a clean clinical hospital mortuary in stainless steel, softly out of focus'
  },
  'father-thames': {
    subject: 'a weathered, rangy older white countryman with sly bleak-grey eyes, in a slightly shabby suit',
    background: 'a misty green upper-river riverbank and countryside'
  },
  'harold-postmartin': {
    subject: 'an elderly, stooped white academic with white hair and a donnish air, in a tweed suit and tie',
    background: 'the stacks of an old library full of leather-bound books, softly out of focus'
  },
  'abigail-kamara': {
    subject: 'a sharp, confident Black British teenage girl of about seventeen, hair in braids, in casual streetwear',
    background: 'a softly out-of-focus north London estate with a railway line behind'
  },
  'asterid-bivalacqua': {
    subject: 'an elegant, slender Black woman in her late seventies, short relaxed white hair, chunky jewellery and big earrings',
    background: 'a lush greenhouse full of plants, softly out of focus'
  },
  'ds-sahra-guleed': {
    subject: 'a Somali British woman in her late twenties wearing a neat hijab, calm and sharp, in a smart jacket',
    background: 'a police station interview room, softly out of focus'
  },
  'dr-jennifer-vaughan': {
    subject: 'a small, sharp-eyed white woman in her early thirties with practical short hair, in a shirt',
    background: 'a clean clinical hospital mortuary in stainless steel, softly out of focus'
  },
  'frank-caffrey': {
    subject: 'a tough, solid middle-aged white man with a broken nose, close-cropped hair and mild eyes, in plain dark practical clothing',
    background: 'a softly out-of-focus utilitarian urban backdrop'
  },
  'special-agent-kimberley-reynolds': {
    subject: 'a poised American woman in her thirties, neat formal hair, in a smart dark trouser-suit and blouse',
    background: 'a softly out-of-focus federal office interior'
  },
  'michael-cheung': {
    subject: 'a confident Anglo-Chinese man in his mid-twenties, short black hair, broad-shouldered, in good tailoring',
    background: 'a softly out-of-focus London Chinatown street with red lanterns'
  },
  'lady-cecelia-tyburn-thames': {
    subject: 'a poised, handsome Black woman in her late forties, immaculately turned out and coolly elegant, in sharp business attire',
    background: 'a smart, panelled Westminster establishment interior, softly out of focus'
  },
  'mama-thames': {
    subject: 'a handsome, generous-figured middle-aged Black woman with flawless skin and a regal, commanding presence, richly and colourfully dressed with gold jewellery',
    background: 'a warm, opulent interior with a soft suggestion of the wide tidal river beyond, out of focus'
  },
  'molly': {
    subject: 'a pale, slender Victorian-looking housekeeper in a high-necked long black dress, dark hair severely pinned up, unnervingly still and composed',
    background: 'a dim panelled Edwardian interior, softly out of focus'
  },
  'foxglove': {
    subject: 'an ethereal, otherworldly pale young woman with an uncanny fae stillness and large watchful eyes',
    background: 'a softly-lit artist studio with canvases, out of focus'
  },
  'zachary-palmer': {
    subject: 'a wiry, streetwise white London man in his thirties, a little shifty and charming, in a casual jacket',
    background: 'a softly out-of-focus London street market'
  },
  'saffron-jackson': {
    subject: 'a brisk, capable white woman of about thirty-six with a practical hairstyle, in smart-casual clothes',
    background: 'the interior of a busy bookshop lined with shelves, softly out of focus'
  },
  'warwick-anderson': {
    subject: 'a nervous, rattled young white man of about twenty-nine with an anxious expression, in casual clothes',
    background: 'the interior of a bookshop at night, softly out of focus'
  },
  'toby': {
    subject: 'a small scruffy brown-and-white terrier dog, alert and bright-eyed',
    background: 'the softly out-of-focus interior of an old building'
  },
  'ernie': {
    subject: 'a small scruffy terrier dog with a single-minded expression',
    background: 'a softly out-of-focus domestic interior'
  }
};

function parseArgs(argv) {
  const args = { only: null, write: false, embed: false, strength: 1.0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--embed') args.embed = true;
    else if (a === '--only') args.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--strength') args.strength = parseFloat(argv[++i]);
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function logEvent(event, detail) {
  const bits = Object.entries(detail || {}).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(bits ? `  ${event}: ${bits}` : `  ${event}`);
}

// Compress a review PNG to a JPEG data URL via ffmpeg (the only image tool
// present). Keeps the 672x768 dimensions; just re-encodes to keep the sheet
// JSON small, matching the existing ~140 KB portraits.
function pngToJpegDataUrl(pngPath) {
  const tmp = path.join(os.tmpdir(), `rol_portrait_${process.pid}_${Math.random().toString(36).slice(2)}.jpg`);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', pngPath, '-q:v', JPEG_QUALITY, tmp]);
    const buf = fs.readFileSync(tmp);
    return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, bytes: buf.length };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function embedIntoJson(slug, pngPath) {
  const { dataUrl, bytes } = pngToJpegDataUrl(pngPath);
  const jsonPath = path.join(JSON_DIR, `${slug}.json`);
  const obj = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!obj.sheet || typeof obj.sheet !== 'object') obj.sheet = {};
  obj.sheet.portrait = dataUrl;
  fs.writeFileSync(jsonPath, `${JSON.stringify(obj, null, 2)}\n`);
  console.log(`  embedded -> ${path.basename(jsonPath)} sheet.portrait (jpeg ${(bytes / 1024).toFixed(0)} KB)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slugs = (args.only || Object.keys(PORTRAITS)).filter((s) => {
    if (!PORTRAITS[s]) { console.warn(`skip ${s}: not in table`); return false; }
    return true;
  });
  fs.mkdirSync(REVIEW_DIR, { recursive: true });

  for (const slug of slugs) {
    const reviewPath = path.join(REVIEW_DIR, `${slug}.png`);
    console.log(`\n=== ${slug} ===`);

    if (args.embed) {
      if (!fs.existsSync(reviewPath)) { console.error(`  no review PNG: ${reviewPath}`); continue; }
      embedIntoJson(slug, reviewPath);
      continue;
    }

    const t = PORTRAITS[slug];
    const srcPath = path.join(SRC_DIR, `${slug}.png`);
    if (!fs.existsSync(srcPath)) { console.error(`  MISSING SOURCE: ${srcPath}`); continue; }
    const source = imageFileToDataUrl(srcPath);
    const result = await restylePortraitImage({
      image: source, style: '', strength: args.strength,
      subject: t.subject, background: t.background,
      timeoutMs: 600000, logger: logEvent
    });
    const { buffer } = dataUrlToBuffer(result.dataUrl);
    fs.writeFileSync(reviewPath, buffer);
    console.log(`  review -> ${reviewPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
    if (args.write) embedIntoJson(slug, reviewPath);
  }
  console.log(`\nDone.${args.embed || args.write ? ' JSON updated.' : ` Review images in ${REVIEW_DIR}`}`);
}

main().catch((e) => { console.error(`error: ${e.message || e}`); process.exit(1); });
