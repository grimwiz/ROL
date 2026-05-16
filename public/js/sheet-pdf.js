/* global PDFLib */
// sheet-pdf.js — export a filled-in character sheet as a PDF by overlaying
// form data onto the blank RoL Charsheet.pdf from Chaosium.
//
// The blank is made of rasterised images (no vector form fields). Coordinates
// below were derived by pixel-scanning horizontal underlines at 2x render and
// converting back to PDF points. Origin is pdf-lib's bottom-left, so any
// "y-from-top" figure is flipped via: PAGE_H - y_top.
//
// If the printed alignment drifts on a given printer, tweak COORDS; everything
// else cascades from that table.
(function () {
  'use strict';

  // A4 in PDF points (1/72in). Page 1 of RoL Charsheet.pdf.
  const PAGE_W = 595.32;
  const PAGE_H = 841.92;

  // Text sits ~1.5pt above the baseline underline; convert top-down y to pdf-lib y
  const flip = (yTop) => PAGE_H - yTop + 1.5;

  // Row coordinates (y measured top-down, in points).
  // Derived from underline detection on blank_charsheet.pdf page 1.
  const COORDS = {
    // LEFT column — Investigator Info
    nameL1:       { x: 240, y: 88,    maxW: 140 },
    nameL2:       { x: 210, y: 108.5, maxW: 170 },
    occupation:   { x: 265, y: 129,   maxW: 115 },
    birthplace:   { x: 273, y: 149.5, maxW: 108 },
    residence:    { x: 258, y: 170,   maxW: 122 },
    pronouns:     { x:  72, y: 190.5, maxW: 160 }, // left side
    age:          { x: 436, y: 190.5, maxW:  30 }, // narrow right inset
    socialClass:  { x:  72, y: 209,   maxW: 160 }, // label cell on the left
    affluence:    { x: 402, y: 209,   maxW: 170 },
    glitch:       { x:  72, y: 231.5, maxW: 320 },
    backstory1:   { x:  72, y: 252,   maxW: 320 },
    backstory2:   { x:  72, y: 272.5, maxW: 320 },

    // RIGHT column — Characteristics (5 rows). Main value + half.
    // Full value goes mid-cell (~500), half at ~555.
    charFullX: 500,
    charHalfX: 555,
    str: 88,
    con: 108.5,
    dex: 129,
    int: 149.5,
    pow: 170,

    // Supplemental (lower right)
    mov:        { x: 505, y: 231.5 },
    luckStart:  { x: 478, y: 252   },
    luckCurr:   { x: 552, y: 252   },
    mpStart:    { x: 492, y: 272.5 },
    mpCurr:     { x: 552, y: 272.5 },

    // Advantages / Disadvantages (3 rows each side)
    advX: 30,    advMaxW: 257,
    disX: 310,   disMaxW: 256,
    advDisY: [336, 356.5, 377],

    // Common skills — 9 rows at 20.5pt pitch starting y=424
    // Columns: base (~130-180 read-only), value full (~215-310), half (~328-378)
    skillBaseX:  132,
    skillFullX:  218,
    skillHalfX:  332,
    skillY0:     424,
    skillPitch:  20.5,

    // Expert skills — same row grid as common skills, middle column.
    // Label sits around x=400-490, value full around x=493-565
    expertLabelX: 400,
    expertValueX: 500,

    // Combat skills — same row grid, right-most column (not present in blank
    // beyond a couple of decorations, so we place them in the Additional
    // Skills area on page 3 if needed; here we re-use the expert column rows
    // below the expert skills).

    // Weapons (3 rows)
    weaponY:       [642.9, 663.5, 683.5],
    weaponNameX:   30,    weaponNameMaxW: 100,
    weaponFullX:   200,
    weaponHalfX:   256,
    weaponDmgX:    308,   weaponDmgMaxW:  100,
    weaponRangeX:  418,   weaponRangeMaxW: 140,

    // Magic spells (3 rows)
    spellY:     [738.4, 758.4, 778.9],
    spellNameX: 62,   spellNameMaxW: 215,
    spellOrderX:315,  spellOrderMaxW:150,
    spellNotesX:470,  spellNotesMaxW: 95,

    // SIGNARE box — on page index 1 (the back page), left column below
    // CONTACTS and left of MAGIC SPELLS. Derived from the page-1 image
    // transform; tweak signareY pitch/offset if printed alignment drifts.
    signareX:    30,
    signareMaxW: 250,
    signareY:    [236, 254, 272],

    // Damage track checkboxes (top-down y & xs). These are approximate —
    // the blank has four tick-boxes on the right of the char block.
    damageBoxes: [
      { key: 'hurt',     x: 410, y: 300 },
      { key: 'bloodied', x: 470, y: 300 },
      { key: 'down',     x: 410, y: 318 },
      { key: 'impaired', x: 470, y: 318 },
    ],

    // Portrait inset — the blank has a portrait box at top-left, approx
    // x=26..174, y=36..272 (top-down).
    portrait: { x: 26, yTop: 36, w: 148, h: 236 },
  };

  // ---- helpers -----------------------------------------------------------

  // pdf-lib's StandardFonts.Helvetica only supports WinAnsi (Latin-1 + a few
  // extras). Anything outside that — emoji, em dashes, smart quotes, the ⚔
  // marker we use for combat skills — would throw on drawText. Map common
  // characters to WinAnsi equivalents and replace the rest with '?'.
  const WINANSI_MAP = {
    '\u2018': "'", '\u2019': "'", '\u201A': ',', '\u201B': "'",
    '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
    '\u2013': '-', '\u2014': '-', '\u2212': '-',
    '\u2022': '*', '\u00B7': '*',
    '\u2026': '...',
    '\u2694': '*',          // ⚔ crossed swords (combat marker)
    '\u2620': '+',          // ☠ skull
    '\u2603': '*',          // ☃ snowman
    '\u2605': '*', '\u2606': '*',
    '\u2192': '->', '\u2190': '<-',
    '\u00A0': ' ',
  };
  // 0x20..0x7E + 0xA1..0xFF are safe; the small WinAnsi-only block 0x80..0x9F
  // (smart quotes etc.) is partly covered by the map above.
  function isWinAnsiSafe(cc) {
    return (cc >= 0x20 && cc <= 0x7E) || (cc >= 0xA0 && cc <= 0xFF);
  }
  function sanitize(text) {
    if (text === null || text === undefined) return '';
    let s = String(text);
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      const cc = ch.charCodeAt(0);
      if (isWinAnsiSafe(cc)) { out += ch; continue; }
      if (WINANSI_MAP[ch]) { out += WINANSI_MAP[ch]; continue; }
      // High surrogate (emoji) — skip its low surrogate too.
      if (cc >= 0xD800 && cc <= 0xDBFF) { i += 1; out += '?'; continue; }
      out += '?';
    }
    return out;
  }

  function ellipsize(font, text, size, maxW) {
    if (!text) return '';
    let s = sanitize(text);
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    while (s.length && font.widthOfTextAtSize(s + '…', size) > maxW) {
      s = s.slice(0, -1);
    }
    return s + '…';
  }

  // Break a string onto (at most) `lines` lines that each fit `maxW`, tail
  // is ellipsised on the final line.
  function wrap(font, text, size, maxW, lines) {
    if (!text) return [];
    const words = sanitize(text).split(/\s+/);
    const out = [];
    let cur = '';
    for (const w of words) {
      const trial = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(trial, size) <= maxW) {
        cur = trial;
      } else {
        if (cur) out.push(cur);
        cur = w;
        if (out.length === lines - 1) break;
      }
    }
    if (cur && out.length < lines) out.push(cur);
    if (out.length === lines) {
      // ellipsise tail if there were still more words we dropped
      const joined = words.join(' ');
      const rendered = out.join(' ');
      if (joined.length > rendered.length) {
        out[lines - 1] = ellipsize(font, out[lines - 1] + ' …', size, maxW);
      }
    }
    return out;
  }

  function drawText(page, font, text, x, yTop, size, maxW) {
    if (text === null || text === undefined || text === '') return;
    const s = maxW ? ellipsize(font, text, size, maxW) : sanitize(text);
    if (!s) return;
    page.drawText(s, { x, y: flip(yTop), size, font });
  }

  function drawCenter(page, font, text, xCenter, yTop, size) {
    if (!text && text !== 0) return;
    const s = sanitize(text);
    if (!s) return;
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: xCenter - w / 2, y: flip(yTop), size, font });
  }

  // ---- main export -------------------------------------------------------

  async function exportSheet(sheet, opts) {
    opts = opts || {};
    const filename = opts.filename || makeFilename(sheet);

    // Load the blank charsheet PDF (authed static mount).
    const url = opts.blankUrl || '/rules-files/RoL_Charsheet.pdf';
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) {
      throw new Error('Could not load blank charsheet: ' + resp.status);
    }
    const blankBytes = await resp.arrayBuffer();

    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdf = await PDFDocument.load(blankBytes);
    const font    = await pdf.embedFont(StandardFonts.Helvetica);
    const fontB   = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pages = pdf.getPages();
    const p1 = pages[0];
    const p2 = pages[1] || p1; // back page (NAME/CONTACTS/SIGNARE/…)

    const FS = 10;       // body font size
    const FSS = 9;       // smaller cells
    const FSN = 11;      // numeric stat cells

    // ---- Investigator Info -----------------------------------------------
    // Name (up to 2 lines if long)
    const nameLines = wrap(font, sheet.name, FS, COORDS.nameL1.maxW, 2);
    if (nameLines[0]) drawText(p1, font, nameLines[0], COORDS.nameL1.x, COORDS.nameL1.y, FS);
    if (nameLines[1]) drawText(p1, font, nameLines[1], COORDS.nameL2.x, COORDS.nameL2.y, FS, COORDS.nameL2.maxW);

    drawText(p1, font, sheet.occupation,  COORDS.occupation.x,  COORDS.occupation.y,  FS, COORDS.occupation.maxW);
    drawText(p1, font, sheet.birthplace,  COORDS.birthplace.x,  COORDS.birthplace.y,  FS, COORDS.birthplace.maxW);
    drawText(p1, font, sheet.residence,   COORDS.residence.x,   COORDS.residence.y,   FS, COORDS.residence.maxW);
    drawText(p1, font, sheet.pronouns,    COORDS.pronouns.x,    COORDS.pronouns.y,    FS, COORDS.pronouns.maxW);
    drawText(p1, font, sheet.age,         COORDS.age.x,         COORDS.age.y,         FS, COORDS.age.maxW);
    drawText(p1, font, sheet.social_class,COORDS.socialClass.x, COORDS.socialClass.y, FS, COORDS.socialClass.maxW);
    drawText(p1, font, sheet.affluence,   COORDS.affluence.x,   COORDS.affluence.y,   FS, COORDS.affluence.maxW);

    // Glitch + backstory share three rows of the lower investigator panel
    drawText(p1, font, sheet.glitch,    COORDS.glitch.x,    COORDS.glitch.y,    FS, COORDS.glitch.maxW);
    const bsLines = wrap(font, sheet.backstory, FS, COORDS.backstory1.maxW, 2);
    if (bsLines[0]) drawText(p1, font, bsLines[0], COORDS.backstory1.x, COORDS.backstory1.y, FS, COORDS.backstory1.maxW);
    if (bsLines[1]) drawText(p1, font, bsLines[1], COORDS.backstory2.x, COORDS.backstory2.y, FS, COORDS.backstory2.maxW);

    // ---- Characteristics -------------------------------------------------
    const characteristics = [
      ['str', COORDS.str], ['con', COORDS.con], ['dex', COORDS.dex],
      ['int', COORDS.int], ['pow', COORDS.pow],
    ];
    for (const [key, y] of characteristics) {
      const full = sheet[key];
      if (full === undefined || full === '' || full === null) continue;
      const n = Number(full);
      drawCenter(p1, fontB, String(full), COORDS.charFullX, y, FSN);
      if (Number.isFinite(n)) {
        drawCenter(p1, font, String(Math.floor(n / 2)), COORDS.charHalfX, y, FSN);
      }
    }

    // ---- Supplemental stats ----------------------------------------------
    // MOV — single cell
    if (sheet.mov !== undefined && sheet.mov !== '') {
      drawCenter(p1, fontB, String(sheet.mov), COORDS.mov.x, COORDS.mov.y, FSN);
    }
    // Luck — starting & current (we store a single value; repeat it)
    if (sheet.luck !== undefined && sheet.luck !== '') {
      drawCenter(p1, fontB, String(sheet.luck), COORDS.luckStart.x, COORDS.luckStart.y, FSN);
      drawCenter(p1, font,  String(sheet.luck), COORDS.luckCurr.x,  COORDS.luckCurr.y,  FSN);
    }
    // Magic points — derived from POW if not overridden
    const mp = (sheet.magic_points !== undefined && sheet.magic_points !== '')
      ? sheet.magic_points
      : (Number.isFinite(Number(sheet.pow)) ? Math.floor(Number(sheet.pow) / 5) : '');
    if (mp !== '') {
      drawCenter(p1, fontB, String(mp), COORDS.mpStart.x, COORDS.mpStart.y, FSN);
      drawCenter(p1, font,  String(mp), COORDS.mpCurr.x,  COORDS.mpCurr.y,  FSN);
    }

    // ---- Damage track (checkboxes) ---------------------------------------
    const dmg = sheet.damage || {};
    for (const box of COORDS.damageBoxes) {
      if (dmg[box.key]) {
        p1.drawText('X', { x: box.x, y: flip(box.y), size: 12, font: fontB });
      }
    }

    // ---- Advantages / Disadvantages --------------------------------------
    const advList = splitToLines(sheet.advantages);
    const disList = splitToLines(sheet.disadvantages);
    for (let i = 0; i < 3; i++) {
      const y = COORDS.advDisY[i];
      if (advList[i]) drawText(p1, font, advList[i], COORDS.advX, y, FS, COORDS.advMaxW);
      if (disList[i]) drawText(p1, font, disList[i], COORDS.disX, y, FS, COORDS.disMaxW);
    }

    // ---- Common skills ---------------------------------------------------
    // The blank sheet pre-prints the 9 common-skill labels in COMMON_SKILL
    // order, so we fill values from common_skills (the form keeps them in
    // that canonical order).
    const commons = Array.isArray(sheet.common_skills) ? sheet.common_skills : [];
    for (let i = 0; i < Math.min(commons.length, 9); i++) {
      const y = COORDS.skillY0 + i * COORDS.skillPitch;
      const s = commons[i] || {};
      if (s.base !== undefined && s.base !== '') drawCenter(p1, font, String(s.base), COORDS.skillBaseX + 24, y, FSS);
      if (s.value !== undefined && s.value !== '') {
        drawCenter(p1, fontB, String(s.value), COORDS.skillFullX + 46, y, FSS);
        const n = Number(s.value);
        if (Number.isFinite(n)) drawCenter(p1, font, String(Math.floor(n / 2)), COORDS.skillHalfX + 24, y, FSS);
      }
    }

    // ---- Expert / Combat skills (reuse right column of page 1) ----------
    // Expert skills go into the right half rows below the characteristics.
    // The form folded the old "additional skills" into the expert list, so
    // print the combined set (legacy sheets may still carry additional_skills).
    // RoL records languages in the Expert Skills space (rulebook p52/233),
    // formatted like the NPC stat blocks: "Latin", "English (own)".
    const langs = (Array.isArray(sheet.languages) ? sheet.languages : [])
      .filter(l => l && l.name)
      .map(l => ({ name: l.name + (l.own ? ' (own)' : ''), value: l.value }));
    const experts = []
      .concat(Array.isArray(sheet.mandatory_skills) ? sheet.mandatory_skills : [])
      .concat(Array.isArray(sheet.additional_skills) ? sheet.additional_skills : [])
      .concat(langs)
      .filter(s => s && s.name);
    const combats = Array.isArray(sheet.combat_skills) ? sheet.combat_skills : [];
    const rightCol = experts.slice(0, 9).map(s => ['E', s]).concat(combats.slice(0, 3).map(s => ['C', s]));
    for (let i = 0; i < Math.min(rightCol.length, 9); i++) {
      const [tag, s] = rightCol[i];
      if (!s || !s.name) continue;
      const y = COORDS.skillY0 + i * COORDS.skillPitch;
      drawText(p1, font, (tag === 'C' ? '⚔ ' : '') + s.name, COORDS.expertLabelX, y, FSS, 85);
      if (s.value !== undefined && s.value !== '') {
        drawCenter(p1, fontB, String(s.value), COORDS.expertValueX + 32, y, FSS);
      }
    }

    // ---- Weapons ---------------------------------------------------------
    const weapons = Array.isArray(sheet.weapons) ? sheet.weapons : [];
    for (let i = 0; i < Math.min(weapons.length, 3); i++) {
      const w = weapons[i] || {};
      const y = COORDS.weaponY[i];
      drawText(p1, font, w.name || '', COORDS.weaponNameX,  y, FSS, COORDS.weaponNameMaxW);
      if (w.full !== undefined) drawCenter(p1, font, String(w.full), COORDS.weaponFullX, y, FSS);
      if (w.half !== undefined) drawCenter(p1, font, String(w.half), COORDS.weaponHalfX, y, FSS);
      drawText(p1, font, w.damage || '', COORDS.weaponDmgX,   y, FSS, COORDS.weaponDmgMaxW);
      drawText(p1, font, w.range  || '', COORDS.weaponRangeX, y, FSS, COORDS.weaponRangeMaxW);
    }

    // ---- Magic spells ----------------------------------------------------
    const spells = Array.isArray(sheet.magic_spells) ? sheet.magic_spells : [];
    for (let i = 0; i < Math.min(spells.length, 3); i++) {
      const s = spells[i] || {};
      const y = COORDS.spellY[i];
      drawText(p1, font, s.name  || '', COORDS.spellNameX,  y, FSS, COORDS.spellNameMaxW);
      drawText(p1, font, s.order || '', COORDS.spellOrderX, y, FSS, COORDS.spellOrderMaxW);
      drawText(p1, font, s.notes || '', COORDS.spellNotesX, y, FSS, COORDS.spellNotesMaxW);
    }

    // ---- Signare (back page) ---------------------------------------------
    const sig = sheet.signare || {};
    const sigLines = [
      sig.sound      ? 'Sound: '  + sig.sound      : '',
      sig.smell      ? 'Smell: '  + sig.smell      : '',
      sig.sensation  ? 'Other: '  + sig.sensation  : '',
      sig.notes      ? sig.notes                   : '',
    ].filter(Boolean);
    for (let i = 0; i < Math.min(sigLines.length, COORDS.signareY.length); i++) {
      drawText(p2, font, sigLines[i], COORDS.signareX, COORDS.signareY[i], FSS, COORDS.signareMaxW);
    }

    // ---- Portrait --------------------------------------------------------
    if (sheet.portrait && typeof sheet.portrait === 'string' && sheet.portrait.startsWith('data:image/')) {
      try {
        const isPng = /^data:image\/png/i.test(sheet.portrait);
        const b64 = sheet.portrait.split(',')[1];
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const box = COORDS.portrait;
        // Fit inside the portrait frame while preserving aspect ratio
        const iw = img.width, ih = img.height;
        const scale = Math.min(box.w / iw, box.h / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = box.x + (box.w - dw) / 2;
        const dyTop = box.yTop + (box.h - dh) / 2;
        p1.drawImage(img, { x: dx, y: PAGE_H - dyTop - dh, width: dw, height: dh });
      } catch (e) {
        console.warn('Portrait embed failed:', e);
      }
    }

    // ---- Save & trigger download -----------------------------------------
    const out = await pdf.save();
    const blob = new Blob([out], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function splitToLines(s) {
    if (!s) return [];
    return String(s).split(/\r?\n|,\s*/).map(x => x.trim()).filter(Boolean);
  }

  function makeFilename(sheet) {
    const base = (sheet && sheet.name ? sheet.name : 'character')
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'character';
    return base + '.pdf';
  }

  // ---- public API --------------------------------------------------------
  window.SheetPDF = {
    export: exportSheet,
  };
})();
