// Renders the character sheet form (editable or readonly)
const SheetForm = (() => {

  const DEFAULT = {
    name: '', pronouns: '', birthplace: '', residence: '',
    occupation: '', social_class: '', age: '', affluence: '',
    glitch: '', backstory: '', reputation: '',
    portrait: '',
    str: '', con: '', dex: '', int: '', pow: '', siz: '',
    advantages: '', disadvantages: '',
    combat_skills: [
      { name: 'Fighting', value: '30' },
      { name: 'Firearms', value: '30' }
    ],
    mandatory_skills: [
      { name: '', value: '' },
      { name: '', value: '' }
    ],
    additional_skills: [
      { name: '', value: '' },
      { name: '', value: '' },
      { name: '', value: '' }
    ],
    mov: '', luck: '',
    damage: { hurt: false, bloodied: false, down: false, impaired: false },
    weapons: [
      { name: '', full: '', half: '', damage: '', range: '' },
      { name: '', full: '', half: '', damage: '', range: '' }
    ],
    carry: '',
    magic_spells: [],
    custom_fields: []
  };

  const STAT_OPTIONS = [10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90];
  const SKILL_PERCENT_OPTIONS = [20,25,30,35,40,45,50,55,60,65,70,75,80];
  const STAT_KEYS = ['str', 'con', 'dex', 'int', 'pow', 'siz'];
  const COMMON_SKILL_NAMES = [
    'Athletics',
    'Drive',
    'Navigate',
    'Observation',
    'Read Person',
    'Research',
    'Sense Vestigia',
    'Social',
    'Stealth'
  ];
  const COMBAT_SKILL_NAMES = ['Fighting', 'Firearms'];
  const ADVANTAGES = [
    { name: 'Connected' },
    { name: 'Damage Bonus', requirements: [{ stat: 'str', min: 60 }] },
    { name: 'Fast Reactions', requirements: [{ stat: 'dex', min: 60 }] },
    { name: 'Magical (Major Advantage)', requirements: [{ stat: 'int', min: 60 }, { stat: 'pow', min: 60 }] },
    { name: 'Natural Toughness', requirements: [{ stat: 'str', min: 60 }, { stat: 'con', min: 60 }] },
    { name: 'Rich (Major Advantage)' },
    { name: 'Scary' },
    { name: 'Signature Firearm' },
    { name: 'Signature Weapon' },
    { name: 'Silver-Tongued' },
    { name: 'Speedy', requirements: [{ stat: 'dex', min: 60 }] },
    { name: 'Steadfast', requirements: [{ stat: 'pow', min: 60 }] },
    { name: 'The Knowledge', requirements: [{ stat: 'int', min: 60 }] },
    { name: 'Wealthy' }
  ];
  const ADVANTAGE_PRESET_NAMES = ADVANTAGES.map((adv) => adv.name);

  // ── Portrait generation state ──────────────────────────────────────────────
  // The raw uploaded File/Blob is kept in memory so the player can revert from
  // a generated random portrait back to their uploaded/captured picture. Only
  // the *current* portrait (as a data URL) goes into the sheet JSON.
  let originalBlob = null;
  let originalUrl = null;        // blob: URL for the raw upload
  let lastGeneratedUrl = null;   // blob: URL of latest stylised output
  let pendingGeneratedDataUrl = null;
  let previousPortraitDataUrl = null;
  let stylising = false;
  let portraitCameraStream = null;
  // 7:8 aspect to match the printed PDF portrait box (164 × 187 pt).
  const PORTRAIT_STORAGE_WIDTH = 672;
  const PORTRAIT_STORAGE_HEIGHT = 768;
  const PORTRAIT_BG = '#1e1e26';

  function revokeIfBlobUrl(url) {
    if (url && typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  function resetPortraitState() {
    revokeIfBlobUrl(originalUrl);
    revokeIfBlobUrl(lastGeneratedUrl);
    stopPortraitCameraStream();
    const modal = document.getElementById('portrait-camera-modal');
    if (modal) modal.remove();
    originalBlob = null;
    originalUrl = null;
    lastGeneratedUrl = null;
    pendingGeneratedDataUrl = null;
    previousPortraitDataUrl = null;
    stylising = false;
  }

  // ── Derived stat calculations ──────────────────────────────────────────────
  function getStatValue(statKey) {
    const el = document.getElementById(`sf_${statKey}`);
    const val = parseInt(el ? el.value : '', 10);
    return Number.isFinite(val) ? val : 0;
  }

  function calcDerived() {
    const con = getStatValue('con');
    const siz = getStatValue('siz');
    const pow = getStatValue('pow');
    const str = getStatValue('str');
    const hp = siz && con ? Math.round((con + siz) / 10) : '';
    const san = pow ? pow : '';
    const mp  = pow ? Math.round(pow / 5) : '';
    const buildRaw = str && siz ? str + siz : null;
    let build = '';
    if (buildRaw !== null) {
      if (buildRaw <= 64)       build = '-2';
      else if (buildRaw <= 84)  build = '-1';
      else if (buildRaw <= 124) build = '0';
      else if (buildRaw <= 164) build = '+1';
      else if (buildRaw <= 204) build = '+2';
      else                       build = '+3';
    }
    return { hp, san, mp, build };
  }

  function updateDerivedDisplay() {
    const d = calcDerived();
    const fields = ['hp','san','mp','build'];
    fields.forEach((f) => {
      const el = document.getElementById(`sf_derived_${f}`);
      if (el && el.dataset.auto === 'true') el.value = d[f] !== undefined ? d[f] : '';
    });
  }

  function toggleDerivedAuto(field) {
    const el = document.getElementById(`sf_derived_${field}`);
    if (!el) return;
    const btn = document.getElementById(`sf_derived_${field}_toggle`);
    const isAuto = el.dataset.auto === 'true';
    el.dataset.auto = isAuto ? 'false' : 'true';
    el.readOnly = !isAuto; // toggling: if was auto, now manual → not readonly
    if (btn) btn.textContent = isAuto ? 'Auto' : 'Manual';
    if (!isAuto) updateDerivedDisplay();
  }
  window.SheetFormToggleDerived = toggleDerivedAuto;

  // ── Advantages helpers ─────────────────────────────────────────────────────
  function parseAdvantages(value) {
    if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
    return String(value || '')
      .split(/,|;|\n|\band\b/gi)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  // ── Common skills ──────────────────────────────────────────────────────────
  function defaultCommonSkills() {
    return COMMON_SKILL_NAMES.map((name) => ({ name, value: '30' }));
  }

  function defaultCombatSkills() {
    return COMBAT_SKILL_NAMES.map((name) => ({ name, value: '30' }));
  }

  function findSkillValue(skillName, pools) {
    const wanted = String(skillName || '').trim().toLowerCase();
    for (const pool of pools) {
      if (!Array.isArray(pool)) continue;
      for (const sk of pool) {
        const name = String((sk && sk.name) || '').trim().toLowerCase();
        const value = String((sk && sk.value) || '').trim();
        if (name === wanted && value) return value;
      }
    }
    return '';
  }

  function mergeCommonSkills(saved) {
    const byName = {};
    defaultCommonSkills().forEach((sk) => { byName[sk.name.toLowerCase()] = { ...sk }; });
    if (Array.isArray(saved)) {
      saved.forEach((sk) => {
        const key = String((sk && sk.name) || '').trim().toLowerCase();
        if (!key || !byName[key]) return;
        const value = String((sk && sk.value) || '').trim();
        byName[key].value = value || byName[key].value;
      });
    }
    return COMMON_SKILL_NAMES.map((name) => ({ ...byName[name.toLowerCase()] }));
  }

  function mergeCombatSkills(saved, mandatorySkills, additionalSkills) {
    const byName = {};
    defaultCombatSkills().forEach((sk) => { byName[sk.name.toLowerCase()] = { ...sk }; });
    if (Array.isArray(saved)) {
      saved.forEach((sk) => {
        const key = String((sk && sk.name) || '').trim().toLowerCase();
        if (!key || !byName[key]) return;
        const value = String((sk && sk.value) || '').trim();
        byName[key].value = value || byName[key].value;
      });
    }
    COMBAT_SKILL_NAMES.forEach((name) => {
      const key = name.toLowerCase();
      const explicitValue = findSkillValue(name, [saved]);
      if (explicitValue) {
        byName[key].value = explicitValue;
        return;
      }
      const legacyValue = findSkillValue(name, [mandatorySkills, additionalSkills]);
      if (legacyValue) byName[key].value = legacyValue;
    });
    return COMBAT_SKILL_NAMES.map((name) => ({ ...byName[name.toLowerCase()] }));
  }

  function normaliseDamage(saved) {
    const base = { hurt: false, bloodied: false, down: false, impaired: false };
    if (!saved || typeof saved !== 'object') return base;
    Object.keys(base).forEach((key) => { base[key] = !!saved[key]; });
    return base;
  }

  function normaliseWeapons(saved) {
    const rows = Array.isArray(saved) ? saved : [];
    const clean = rows
      .map((row) => ({
        name: String((row && row.name) || ''),
        full: String((row && row.full) || ''),
        half: String((row && row.half) || ''),
        damage: String((row && row.damage) || ''),
        range: String((row && row.range) || '')
      }))
      .filter((row) => row.name || row.full || row.half || row.damage || row.range);
    return clean.length ? clean : JSON.parse(JSON.stringify(DEFAULT.weapons));
  }

  function merge(saved) {
    const base = JSON.parse(JSON.stringify(DEFAULT));
    if (!saved) return base;
    Object.assign(base, saved);
    if (!Array.isArray(base.mandatory_skills)) base.mandatory_skills = DEFAULT.mandatory_skills;
    if (!Array.isArray(base.additional_skills)) base.additional_skills = DEFAULT.additional_skills;
    if (!Array.isArray(base.custom_fields)) base.custom_fields = [];
    if (!Array.isArray(base.magic_spells)) base.magic_spells = [];
    base.common_skills = mergeCommonSkills(base.common_skills);
    base.combat_skills = mergeCombatSkills(base.combat_skills, base.mandatory_skills, base.additional_skills);
    base.damage = normaliseDamage(base.damage);
    base.weapons = normaliseWeapons(base.weapons);
    base.advantages = parseAdvantages(base.advantages).join(', ');
    // Migrate old derived fields stored flat
    if (!base.derived) {
      base.derived = {
        hp:    saved.hp    || '',
        san:   saved.san   || '',
        mp:    saved.mp    || '',
        build: saved.build || '',
        move:  saved.move  || saved.mov || ''
      };
    }
    return base;
  }

  function esc(v) { return String(v||'').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  function fg(label, inner) {
    return `<div class="form-group"><label>${label}</label>${inner}</div>`;
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function renderStatSelect(statKey, value, readonly) {
    const rdAttr = readonly ? ' disabled' : '';
    const options = STAT_OPTIONS.map((n) => {
      const selectedAttr = String(value || '') === String(n) ? ' selected' : '';
      return `<option value="${n}"${selectedAttr}>${n}</option>`;
    }).join('');
    return `<select id="sf_${statKey}"${rdAttr}>
      <option value="">–</option>
      ${options}
    </select>`;
  }

  function renderSkillValueSelect(id, value, readonly) {
    const rdAttr = readonly ? ' disabled' : '';
    const options = SKILL_PERCENT_OPTIONS.map((n) => {
      const selectedAttr = String(value || '30') === String(n) ? ' selected' : '';
      return `<option value="${n}"${selectedAttr}>${n}%</option>`;
    }).join('');
    return `<select id="${id}" class="csk-val"${rdAttr}>${options}</select>`;
  }

  function renderPercentInput(id, value, readonly, extraClass = '') {
    return `<input type="number" id="${id}" class="${extraClass}" value="${esc(value)}" min="0" max="100"${readonly ? ' readonly' : ''}>`;
  }

  function renderCombatSkillRow(sk, i, readonly) {
    const half = sk.value ? Math.floor(parseInt(sk.value, 10) / 2) : '';
    return `<div class="combat-skill-row">
      <input type="text" value="${esc(sk.name)}" readonly>
      ${renderPercentInput(`sf_combat_val_${i}`, sk.value || '30', readonly, 'combat-skill-full')}
      <input type="text" class="combat-skill-half" value="${esc(half)}" readonly>
    </div>`;
  }

  function renderDamageToggle(key, label, checked, readonly) {
    return `<label class="damage-toggle${checked ? ' checked' : ''}">
      <input type="checkbox" id="sf_damage_${key}" ${checked ? 'checked' : ''}${readonly ? ' disabled' : ''}>
      <span>${label}</span>
    </label>`;
  }

  function renderWeaponRow(wp, i, readonly) {
    const rdAttr = readonly ? ' readonly' : '';
    return `<div class="weapon-row" id="weapon_row_${i}">
      <input type="text" class="weapon-name" value="${esc(wp.name || '')}" placeholder="Weapon name"${rdAttr}>
      <input type="text" class="weapon-full" value="${esc(wp.full || '')}" placeholder="Full"${rdAttr}>
      <input type="text" class="weapon-half" value="${esc(wp.half || '')}" placeholder="Half"${rdAttr}>
      <input type="text" class="weapon-damage" value="${esc(wp.damage || '')}" placeholder="Damage"${rdAttr}>
      <input type="text" class="weapon-range" value="${esc(wp.range || '')}" placeholder="Range"${rdAttr}>
      ${!readonly ? `<button type="button" class="btn btn-inline-remove" onclick="SheetForm.removeWeapon(this)" title="Remove weapon">✕</button>` : '<span></span>'}
    </div>`;
  }

  function renderAdvantagesSelect(value, readonly) {
    const selected = parseAdvantages(value);
    const rdAttr = readonly ? ' disabled' : '';
    const options = ADVANTAGES.map((adv) => {
      const selectedAttr = selected.includes(adv.name) ? ' selected' : '';
      return `<option value="${esc(adv.name)}"${selectedAttr}>${esc(adv.name)}</option>`;
    }).join('');
    return `
      <input type="text" id="sf_advantages_text" placeholder="Selected advantages"${readonly ? ' readonly' : ''} value="${esc(selected.join(', '))}">
      ${readonly ? '' : `<details class="sheet-inline-expand" style="margin-top:0.45rem">
        <summary>Edit selected advantages</summary>
        <select id="sf_advantages" multiple size="8"${rdAttr}>${options}</select>
        <div class="card-sub" style="margin-top:0.35rem">Hold Ctrl/Cmd to select multiple. Custom entries in the text box are preserved.</div>
      </details>`}`;
  }

  function renderPortraitPreview(value) {
    return value
      ? `<img src="${esc(value)}" alt="Character portrait" class="sheet-portrait-image">`
      : '<div class="sheet-portrait-empty">No picture</div>';
  }

  function renderDerivedField(field, label, value, autoValue, readonly) {
    const isAuto = !value || value === String(autoValue);
    const displayVal = isAuto ? autoValue : value;
    if (readonly) {
      return fg(label, `<input type="text" value="${esc(displayVal)}" readonly>`);
    }
    return fg(label, `
      <div style="display:flex;gap:0.4rem;align-items:center">
        <input type="text" id="sf_derived_${field}" value="${esc(displayVal)}"
          data-auto="${isAuto ? 'true' : 'false'}"
          ${isAuto ? 'readonly' : ''}
          style="flex:1">
        <button type="button" id="sf_derived_${field}_toggle"
          class="btn btn-sm" style="white-space:nowrap"
          onclick="SheetFormToggleDerived('${field}')"
          title="Switch between auto-calculated and manual entry">
          ${isAuto ? 'Manual' : 'Auto'}
        </button>
      </div>`);
  }

  function renderMagicSpell(spell, i, readonly) {
    const rdAttr = readonly ? ' readonly' : '';
    return `<div class="magic-spell-row" id="spell_row_${i}">
      <input type="text" class="spell-name" value="${esc(spell.name || '')}" placeholder="Spell / technique name"${rdAttr}>
      <input type="text" class="spell-order" value="${esc(spell.order || '')}" placeholder="Order &amp; mastery (e.g. 1st – Mastered)"${rdAttr}>
      <input type="text" class="spell-notes" value="${esc(spell.notes || '')}" placeholder="Notes / description"${rdAttr}>
      ${!readonly ? `<button type="button" class="btn btn-inline-remove" onclick="SheetForm.removeSpell(this)" title="Remove">✕</button>` : '<span></span>'}
    </div>`;
  }

  function renderCustomField(cf, i, readonly) {
    const rdAttr = readonly ? ' readonly' : '';
    return `<div class="custom-field-row" id="cf_row_${i}">
      <input type="text" id="cf_key_${i}" value="${esc(cf.key)}" placeholder="Field name"${rdAttr}>
      <input type="text" id="cf_val_${i}" value="${esc(cf.value)}" placeholder="Value"${rdAttr}>
      ${!readonly ? `<button type="button" class="btn btn-sm btn-danger" onclick="SheetForm.removeCustomField(${i})">✕</button>` : '<span></span>'}
    </div>`;
  }

  function hasMagicData(d) {
    return !!(
      (d.magic_tradition && String(d.magic_tradition).trim()) ||
      (d.magic_notes && String(d.magic_notes).trim()) ||
      (Array.isArray(d.magic_spells) && d.magic_spells.some((sp) => sp && (sp.name || sp.order || sp.notes)))
    );
  }

  function hasMagicSkill(skills) {
    return Array.isArray(skills) && skills.some((sk) => {
      const name = String((sk && sk.name) || '').trim().toLowerCase();
      const value = parseInt((sk && sk.value) || '', 10);
      return name === 'magic' && Number.isFinite(value) && value > 0;
    });
  }

  function isMagicCapableData(d) {
    const magicalAdvantage = parseAdvantages(d.advantages).some((adv) => /^magical\b/i.test(adv));
    return magicalAdvantage
      || hasMagicSkill(d.common_skills)
      || hasMagicSkill(d.mandatory_skills)
      || hasMagicSkill(d.additional_skills)
      || hasMagicData(d);
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function render(container, data, readonly) {
    // Clear any in-memory portrait state from a previous sheet — each render
    // starts fresh. The saved `d.portrait` data URL is what the preview shows
    // until the player uploads something new.
    resetPortraitState();

    const d = merge(data);
    const rdAttr = readonly ? ' readonly' : '';
    const derived = d.derived || {};
    const autoD = calcDerivedFromData(d);
    const showMagicSection = isMagicCapableData(d);

    container.innerHTML = `
<div class="sheet-container${readonly ? ' readonly-sheet' : ''}">

  <div class="sheet-section">
    <div class="sheet-section-header">1 · Personal Info &amp; Backstory</div>
    <div class="sheet-section-body">
      <div class="sheet-personal-layout">
        <div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 1.5rem;">
            ${fg('Name', `<input type="text" id="sf_name" value="${esc(d.name)}" placeholder="Full name"${rdAttr}>`)}
            ${fg('Pronouns', `<input type="text" id="sf_pronouns" value="${esc(d.pronouns)}" placeholder="e.g. he/him"${rdAttr}>`)}
            ${fg('Place of Birth', `<input type="text" id="sf_birthplace" value="${esc(d.birthplace)}"${rdAttr}>`)}
            ${fg('Residence', `<input type="text" id="sf_residence" value="${esc(d.residence)}"${rdAttr}>`)}
            ${fg('Occupation / Role', `<input type="text" id="sf_occupation" value="${esc(d.occupation)}" placeholder="e.g. Stage Magician / Physicist"${rdAttr}>`)}
            ${fg('Age', `<input type="number" id="sf_age" value="${esc(d.age)}" min="16" max="100"${rdAttr}>`)}
            ${fg('Social Class', `<input type="text" id="sf_social_class" value="${esc(d.social_class)}" placeholder="e.g. Middle Class (Academic)"${rdAttr}>`)}
            ${fg('Affluence', `<input type="text" id="sf_affluence" value="${esc(d.affluence || '')}" placeholder="e.g. Average"${rdAttr}>`)}
          </div>
          ${fg('The "Glitch" – What was your anomalous event?',
            `<textarea id="sf_glitch" rows="4" placeholder="Describe the unexplained event that drew you in…"${rdAttr}>${esc(d.glitch)}</textarea>`)}
          ${fg('Backstory',
            `<textarea id="sf_backstory" rows="5" placeholder="Who are they, where did they come from, and what shaped them?"${rdAttr}>${esc(d.backstory)}</textarea>`)}
          ${fg('Reputation',
            `<input type="text" id="sf_reputation" value="${esc(d.reputation)}" placeholder="e.g. Analytical. Thorough. Sceptical."${rdAttr}>`)}
        </div>
        <div class="sheet-portrait-block">
          <label>Portrait</label>
          <div class="sheet-portrait">${renderPortraitPreview(d.portrait)}</div>
          <div class="portrait-controls">
            ${!readonly ? '<input type="file" id="sf_portrait_file" accept="image/*" capture="user" onchange="SheetForm.handlePortraitUpload(event)">' : ''}
            ${!readonly ? '<button type="button" id="sf_portrait_camera" class="btn btn-sm" onclick="SheetForm.openPortraitCamera()">Take photo</button>' : ''}
            <input type="hidden" id="sf_portrait" value="${esc(d.portrait)}">
          </div>
          ${!readonly ? `
            <div style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-top:0.5rem">
              <button type="button" id="sf_portrait_random" class="btn btn-sm" onclick="SheetForm.generateRandomPortrait()">Random</button>
              <button type="button" id="sf_portrait_revert" class="btn btn-sm" style="display:none" onclick="SheetForm.revertPortrait()">Discard generated</button>
              <button type="button" id="sf_portrait_clear" class="btn btn-sm" onclick="SheetForm.clearPortrait()">Remove picture</button>
            </div>
            <div id="sf_portrait_status" class="card-sub" style="margin-top:0.35rem;min-height:1em"></div>
          ` : ''}
          <div class="card-sub">Upload or take a photo to use directly, or click <em>Random</em> to generate a portrait from the character sheet.</div>
        </div>
      </div>
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">2 · Characteristics</div>
    <div class="sheet-section-body">
      <label style="display:block;margin-bottom:0.5rem;font-size:0.78rem;font-weight:700;color:var(--text2);">BASE STATS</label>
      <div class="characteristics-grid characteristics-grid-6">
        ${['str','con','dex','int','pow','siz'].map(s => `
          <div class="char-field form-group">
            <label>${s.toUpperCase()}</label>
            ${renderStatSelect(s, d[s], readonly)}
          </div>`).join('')}
      </div>
      <div id="stat-allocation-note" class="card-sub" style="margin-top:0.5rem"></div>

      <label style="display:block;margin:1.25rem 0 0.5rem;font-size:0.78rem;font-weight:700;color:var(--text2);">DERIVED STATS</label>
      <div class="derived-grid">
        ${renderDerivedField('hp',    'HP',      derived.hp    || '', autoD.hp,    readonly)}
        ${renderDerivedField('san',   'SAN',     derived.san   || '', autoD.san,   readonly)}
        ${renderDerivedField('mp',    'MP',      derived.mp    || '', autoD.mp,    readonly)}
        ${renderDerivedField('build', 'Build',   derived.build || '', autoD.build, readonly)}
        ${fg('Move', `<input type="text" id="sf_derived_move" value="${esc(derived.move || d.mov || '')}" placeholder="e.g. 8"${rdAttr}>`)}
        ${fg('Luck', `<input type="number" id="sf_luck" value="${esc(d.luck)}" min="1" max="100"${rdAttr}>`)}
      </div>
      ${!readonly ? `<p class="card-sub" style="margin-top:0.35rem">HP, SAN, MP and Build are auto-calculated from base stats. Click "Manual" to override.</p>` : ''}
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">3 · Edges &amp; Flaws</div>
    <div class="sheet-section-body">
      ${fg('Advantages', renderAdvantagesSelect(d.advantages, readonly))}
      ${fg('Flaws', `<input type="text" id="sf_disadvantages" value="${esc(d.disadvantages)}" placeholder="e.g. Weak – physically fragile; fails most heavy lifting/grappling tests"${rdAttr}>`)}
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">4 · Skills &amp; Specialties</div>
    <div class="sheet-section-body">
      <label style="display:block;margin-bottom:0.75rem;font-size:0.78rem;font-weight:700;color:var(--text2);">COMMON SKILLS</label>
      <div class="skills-grid common-skills-grid" id="common-skills">
        ${(d.common_skills || defaultCommonSkills()).map((sk, i) => `
          <div class="skill-row csk-row" data-name="${esc(sk.name)}">
            <input type="text" value="${esc(sk.name)}" readonly>
            ${renderSkillValueSelect(`sf_csk_val_${i}`, sk.value || '30', readonly)}
          </div>`).join('')}
      </div>

      <label style="display:block;margin:1rem 0 0.75rem;font-size:0.78rem;font-weight:700;color:var(--text2);">EXPERT SKILLS</label>
      <div class="skills-grid" id="mandatory-skills">
        ${d.mandatory_skills.map((sk, i) => `
          <div class="skill-row">
            <div class="skill-name-wrap">
              <input type="text" id="sf_msk_name_${i}" class="msk-name" value="${esc(sk.name)}" placeholder="Skill name"${rdAttr}>
              ${!readonly ? `<button type="button" class="btn btn-inline-remove" title="Remove expert skill" onclick="SheetForm.removeMandatory(this)">✕</button>` : ''}
            </div>
            <input type="number" id="sf_msk_val_${i}" class="msk-val" value="${esc(sk.value)}" placeholder="%" min="0" max="100"${rdAttr}>
          </div>`).join('')}
      </div>
      ${!readonly ? `<button type="button" class="btn btn-sm" style="margin-top:0.5rem" onclick="SheetForm.addMandatory()">+ Add expert skill</button>` : ''}

      <label style="display:block;margin:1rem 0 0.75rem;font-size:0.78rem;font-weight:700;color:var(--text2);">ADDITIONAL SKILLS</label>
      <div class="skills-grid" id="additional-skills">
        ${d.additional_skills.map((sk, i) => `
          <div class="skill-row">
            <div class="skill-name-wrap">
              <input type="text" id="sf_ask_name_${i}" class="ask-name" value="${esc(sk.name)}" placeholder="Skill name"${rdAttr}>
              ${!readonly ? `<button type="button" class="btn btn-inline-remove" title="Remove skill" onclick="SheetForm.removeAdditional(this)">✕</button>` : ''}
            </div>
            <input type="number" id="sf_ask_val_${i}" class="ask-val" value="${esc(sk.value)}" placeholder="%" min="0" max="100"${rdAttr}>
          </div>`).join('')}
      </div>
      ${!readonly ? `<button type="button" class="btn btn-sm" style="margin-top:0.5rem" onclick="SheetForm.addAdditional()">+ Add skill</button>` : ''}
    </div>
  </div>

  <div class="sheet-section" id="magic-section"${showMagicSection ? '' : ' style="display:none"'}>
    <div class="sheet-section-header">5 · Magic</div>
    <div class="sheet-section-body">
      ${fg('Tradition / Practice', `<input type="text" id="sf_magic_tradition" value="${esc(d.magic_tradition || '')}" placeholder="e.g. Newtonian Practitioner"${rdAttr}>`)}
      <label style="display:block;margin:0.75rem 0 0.5rem;font-size:0.78rem;font-weight:700;color:var(--text2);">SPELLS &amp; TECHNIQUES</label>
      <div class="magic-spells-header" style="display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:0.5rem;margin-bottom:0.35rem;padding:0 0.1rem">
        <span style="font-size:0.75rem;color:var(--text2)">Name</span>
        <span style="font-size:0.75rem;color:var(--text2)">Order &amp; Mastery</span>
        <span style="font-size:0.75rem;color:var(--text2)">Notes</span>
        <span></span>
      </div>
      <div id="magic-spells">
        ${d.magic_spells.map((sp, i) => renderMagicSpell(sp, i, readonly)).join('')}
      </div>
      ${!readonly ? `<button type="button" class="btn btn-sm" style="margin-top:0.5rem" onclick="SheetForm.addSpell()">+ Add spell / technique</button>` : ''}
      ${fg('Magic Notes', `<textarea id="sf_magic_notes" rows="3" placeholder="General notes on your magical practice, limitations, or discoveries…"${rdAttr}>${esc(d.magic_notes || '')}</textarea>`)}
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">6 · Combat, Damage &amp; Gear</div>
    <div class="sheet-section-body">
      <label style="display:block;margin-bottom:0.75rem;font-size:0.78rem;font-weight:700;color:var(--text2);">COMBAT SKILLS</label>
      <div class="combat-skills-header">
        <span>Skill</span>
        <span>Full</span>
        <span>Half</span>
      </div>
      <div class="combat-skills-grid" id="combat-skills">
        ${(d.combat_skills || defaultCombatSkills()).map((sk, i) => renderCombatSkillRow(sk, i, readonly)).join('')}
      </div>

      <label style="display:block;margin-bottom:0.5rem;font-size:0.78rem;font-weight:700;color:var(--text2);">DAMAGE</label>
      <div class="damage-grid">
        ${renderDamageToggle('hurt', 'Hurt', d.damage && d.damage.hurt, readonly)}
        ${renderDamageToggle('bloodied', 'Bloodied', d.damage && d.damage.bloodied, readonly)}
        ${renderDamageToggle('down', 'Down', d.damage && d.damage.down, readonly)}
        ${renderDamageToggle('impaired', 'Impaired', d.damage && d.damage.impaired, readonly)}
      </div>

      <label style="display:block;margin:1rem 0 0.5rem;font-size:0.78rem;font-weight:700;color:var(--text2);">WEAPONS</label>
      <div class="weapons-header">
        <span>Name</span>
        <span>Full</span>
        <span>Half</span>
        <span>Damage</span>
        <span>Range</span>
        <span></span>
      </div>
      <div id="weapons">
        ${d.weapons.map((wp, i) => renderWeaponRow(wp, i, readonly)).join('')}
      </div>
      ${!readonly ? `<button type="button" class="btn btn-sm" style="margin-top:0.5rem" onclick="SheetForm.addWeapon()">+ Add weapon</button>` : ''}

      <label style="display:block;margin:1rem 0 0.5rem;font-size:0.78rem;font-weight:700;color:var(--text2);">FILES / NOTES</label>
      ${fg('Everyday Carry', `<textarea id="sf_carry" rows="3" placeholder="List what your character routinely carries…"${rdAttr}>${esc(d.carry)}</textarea>`)}
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">7 · Custom Fields</div>
    <div class="sheet-section-body">
      <div class="custom-fields" id="custom-fields">
        ${d.custom_fields.map((cf, i) => renderCustomField(cf, i, readonly)).join('')}
      </div>
      ${!readonly ? `<button type="button" class="btn btn-sm" onclick="SheetForm.addCustomField()">+ Add field</button>` : ''}
    </div>
  </div>

</div>`;
    initialiseDynamicFields(readonly);
  }

  // Derived calc from raw data object (not DOM) — used during render before DOM exists
  function calcDerivedFromData(d) {
    const con = parseInt(d.con, 10) || 0;
    const siz = parseInt(d.siz, 10) || 0;
    const pow = parseInt(d.pow, 10) || 0;
    const str = parseInt(d.str, 10) || 0;
    const hp  = siz && con ? Math.round((con + siz) / 10) : '';
    const san = pow || '';
    const mp  = pow ? Math.round(pow / 5) : '';
    const buildRaw = str && siz ? str + siz : null;
    let build = '';
    if (buildRaw !== null) {
      if (buildRaw <= 64)       build = '-2';
      else if (buildRaw <= 84)  build = '-1';
      else if (buildRaw <= 124) build = '0';
      else if (buildRaw <= 164) build = '+1';
      else if (buildRaw <= 204) build = '+2';
      else                       build = '+3';
    }
    return { hp, san, mp, build };
  }

  // ── Dynamic field wiring ───────────────────────────────────────────────────
  function meetsRequirements(requirements) {
    if (!requirements || !requirements.length) return true;
    return requirements.every((req) => getStatValue(req.stat) >= req.min);
  }

  function updateAdvantagesAvailability() {
    const select = document.getElementById('sf_advantages');
    if (!select) return syncCommonSkillsForAdvantages();
    const options = Array.from(select.options);
    options.forEach((opt) => {
      const advantage = ADVANTAGES.find((adv) => adv.name === opt.value);
      const allowed = meetsRequirements(advantage && advantage.requirements);
      opt.disabled = !allowed;
      opt.style.textDecoration = allowed ? 'none' : 'line-through';
      if (!allowed) opt.selected = false;
    });
    syncAdvantagesTextFromPicker();
  }

  function syncAdvantagesTextFromPicker() {
    const picker = document.getElementById('sf_advantages');
    const textEl = document.getElementById('sf_advantages_text');
    if (!textEl || !picker) return;
    const presetSelections = Array.from(picker.selectedOptions).map((opt) => opt.value.trim()).filter(Boolean);
    const customEntries = parseAdvantages(textEl.value).filter((entry) => !ADVANTAGE_PRESET_NAMES.includes(entry));
    textEl.value = [...presetSelections, ...customEntries].join(', ');
    syncCommonSkillsForAdvantages();
    updateMagicSectionVisibility();
  }

  function isMagicalAdvantageChosen() {
    const text = (document.getElementById('sf_advantages_text') || {}).value;
    return parseAdvantages(text).some((adv) => /^magical\b/i.test(adv));
  }

  function syncCommonSkillsForAdvantages() {
    const commonGrid = document.getElementById('common-skills');
    if (!commonGrid) return;
    const magical = isMagicalAdvantageChosen();
    commonGrid.querySelectorAll('.csk-row').forEach((row) => {
      const name = String(row.dataset.name || '').toLowerCase();
      const valueSelect = row.querySelector('.csk-val');
      if (!valueSelect) return;
      // Only auto-bump Sense Vestigia to 60 when Magical is chosen AND the
      // skill is still at its base 30 — preserve any manual override.
      if (name === 'sense vestigia' && magical && Number(valueSelect.value) === 30) {
        valueSelect.value = '60';
      }
    });

    const magicRow = Array.from(commonGrid.querySelectorAll('.csk-row'))
      .find((row) => String(row.dataset.name || '').toLowerCase() === 'magic');
    if (magical && !magicRow) {
      const index = commonGrid.querySelectorAll('.csk-row').length;
      const row = document.createElement('div');
      row.className = 'skill-row csk-row';
      row.dataset.name = 'Magic';
      row.innerHTML = `<input type="text" value="Magic" readonly>${renderSkillValueSelect(`sf_csk_val_${index}`, '60', false)}`;
      commonGrid.appendChild(row);
    }
    if (!magical && magicRow) magicRow.remove();
    updateMagicSectionVisibility();
  }

  function updateStatAllocationMessage() {
    const messageEl = document.getElementById('stat-allocation-note');
    if (!messageEl) return;
    const total = STAT_KEYS.reduce((sum, key) => sum + getStatValue(key), 0);
    // Target is 330 for 6 stats at 55 average — but allow freeform, just show total
    messageEl.textContent = `Stat total: ${total}`;
    messageEl.style.color = 'var(--text2)';
  }

  function handleStatChange() {
    updateStatAllocationMessage();
    updateAdvantagesAvailability();
    updateDerivedDisplay();
  }

  function updateCombatSkillHalves() {
    document.querySelectorAll('#combat-skills .combat-skill-row').forEach((row) => {
      const fullEl = row.querySelector('.combat-skill-full');
      const halfEl = row.querySelector('.combat-skill-half');
      if (!fullEl || !halfEl) return;
      const full = parseInt(fullEl.value, 10);
      halfEl.value = Number.isFinite(full) ? Math.floor(full / 2) : '';
    });
  }

  function isMagicCapableFromDom() {
    const magicalAdvantage = isMagicalAdvantageChosen();
    const skillRows = [
      ...Array.from(document.querySelectorAll('#common-skills .csk-row')),
      ...Array.from(document.querySelectorAll('#mandatory-skills .skill-row')),
      ...Array.from(document.querySelectorAll('#additional-skills .skill-row'))
    ];
    const hasMagicSkillRow = skillRows.some((row) => {
      const nameEl = row.querySelector('.msk-name, .ask-name') || row.querySelector('input[readonly]');
      const valueEl = row.querySelector('.msk-val, .ask-val, .csk-val');
      const name = String((nameEl && nameEl.value) || row.dataset.name || '').trim().toLowerCase();
      const value = parseInt((valueEl && valueEl.value) || '', 10);
      return name === 'magic' && Number.isFinite(value) && value > 0;
    });
    const hasMagicContent = !!(
      ((document.getElementById('sf_magic_tradition') || {}).value || '').trim() ||
      ((document.getElementById('sf_magic_notes') || {}).value || '').trim() ||
      document.querySelector('#magic-spells .magic-spell-row')
    );
    return magicalAdvantage || hasMagicSkillRow || hasMagicContent;
  }

  function updateMagicSectionVisibility() {
    const section = document.getElementById('magic-section');
    if (!section) return;
    section.style.display = isMagicCapableFromDom() ? '' : 'none';
  }

  function initialiseDynamicFields(readonly) {
    updateStatAllocationMessage();
    updateAdvantagesAvailability();
    syncCommonSkillsForAdvantages();
    updateCombatSkillHalves();
    updateMagicSectionVisibility();
    if (readonly) return;
    STAT_KEYS.forEach((stat) => {
      const el = document.getElementById(`sf_${stat}`);
      if (el) el.addEventListener('change', handleStatChange);
    });
    const advantagesPicker = document.getElementById('sf_advantages');
    if (advantagesPicker) advantagesPicker.addEventListener('change', syncAdvantagesTextFromPicker);
    const advantagesText = document.getElementById('sf_advantages_text');
    if (advantagesText) advantagesText.addEventListener('input', updateMagicSectionVisibility);
    document.querySelectorAll('.combat-skill-full').forEach((el) => {
      el.addEventListener('input', updateCombatSkillHalves);
    });
    document.querySelectorAll('.msk-name, .msk-val, .ask-name, .ask-val').forEach((el) => {
      el.addEventListener('input', updateMagicSectionVisibility);
    });
    document.querySelectorAll('#sf_magic_tradition, #sf_magic_notes, .spell-name, .spell-order, .spell-notes').forEach((el) => {
      el.addEventListener('input', updateMagicSectionVisibility);
    });
  }

  // ── Mutators ───────────────────────────────────────────────────────────────
  function addMandatory() {
    const grid = document.getElementById('mandatory-skills');
    const i = Date.now();
    const div = document.createElement('div');
    div.className = 'skill-row';
    div.innerHTML = `<div class="skill-name-wrap">
      <input type="text" id="sf_msk_name_${i}" class="msk-name" placeholder="Skill name">
      <button type="button" class="btn btn-inline-remove" title="Remove expert skill" onclick="SheetForm.removeMandatory(this)">✕</button>
    </div>
    <input type="number" id="sf_msk_val_${i}" class="msk-val" placeholder="%" min="0" max="100">`;
    grid.appendChild(div);
    div.querySelectorAll('.msk-name, .msk-val').forEach((el) => el.addEventListener('input', updateMagicSectionVisibility));
  }

  function removeMandatory(btn) {
    const row = btn && btn.closest('.skill-row');
    if (row) row.remove();
    updateMagicSectionVisibility();
  }

  function addAdditional() {
    const grid = document.getElementById('additional-skills');
    const i = Date.now();
    const div = document.createElement('div');
    div.className = 'skill-row';
    div.innerHTML = `<div class="skill-name-wrap">
      <input type="text" id="sf_ask_name_${i}" class="ask-name" placeholder="Skill name">
      <button type="button" class="btn btn-inline-remove" title="Remove skill" onclick="SheetForm.removeAdditional(this)">✕</button>
    </div>
    <input type="number" id="sf_ask_val_${i}" class="ask-val" placeholder="%" min="0" max="100">`;
    grid.appendChild(div);
    div.querySelectorAll('.ask-name, .ask-val').forEach((el) => el.addEventListener('input', updateMagicSectionVisibility));
  }

  function removeAdditional(btn) {
    const row = btn && btn.closest('.skill-row');
    if (row) row.remove();
    updateMagicSectionVisibility();
  }

  function addSpell() {
    const container = document.getElementById('magic-spells');
    const i = Date.now();
    const div = document.createElement('div');
    div.className = 'magic-spell-row';
    div.id = `spell_row_${i}`;
    div.innerHTML = `
      <input type="text" class="spell-name" placeholder="Spell / technique name">
      <input type="text" class="spell-order" placeholder="Order &amp; mastery">
      <input type="text" class="spell-notes" placeholder="Notes / description">
      <button type="button" class="btn btn-inline-remove" onclick="SheetForm.removeSpell(this)" title="Remove">✕</button>`;
    container.appendChild(div);
    div.querySelectorAll('.spell-name, .spell-order, .spell-notes').forEach((el) => el.addEventListener('input', updateMagicSectionVisibility));
    updateMagicSectionVisibility();
  }

  function removeSpell(btn) {
    const row = btn && btn.closest('.magic-spell-row');
    if (row) row.remove();
    updateMagicSectionVisibility();
  }

  function addWeapon() {
    const container = document.getElementById('weapons');
    const i = Date.now();
    const div = document.createElement('div');
    div.innerHTML = renderWeaponRow({ name: '', full: '', half: '', damage: '', range: '' }, i, false);
    container.appendChild(div.firstElementChild);
  }

  function removeWeapon(btn) {
    const row = btn && btn.closest('.weapon-row');
    if (row) row.remove();
  }

  function addCustomField() {
    const container = document.getElementById('custom-fields');
    const i = Date.now();
    const div = document.createElement('div');
    div.className = 'custom-field-row';
    div.id = `cf_row_${i}`;
    div.innerHTML = `<input type="text" id="cf_key_${i}" placeholder="Field name">
      <input type="text" id="cf_val_${i}" placeholder="Value">
      <button type="button" class="btn btn-sm btn-danger" onclick="SheetForm.removeCustomField('${i}')">✕</button>`;
    container.appendChild(div);
  }

  function removeCustomField(i) {
    const row = document.getElementById(`cf_row_${i}`);
    if (row) row.remove();
  }

  // ── Portrait helpers ───────────────────────────────────────────────────────
  function setPortraitPreview(src) {
    const slot = document.querySelector('.sheet-portrait');
    if (!slot) return;
    slot.innerHTML = src
      ? `<img src="${esc(src)}" alt="Character portrait" class="sheet-portrait-image">`
      : '<div class="sheet-portrait-empty">No picture</div>';
  }

  function setPortraitField(dataUrl) {
    const hidden = document.getElementById('sf_portrait');
    if (hidden) hidden.value = dataUrl || '';
  }

  function setPortraitStatus(msg, kind) {
    const el = document.getElementById('sf_portrait_status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = kind === 'error'
      ? 'var(--danger, #e74c3c)'
      : kind === 'ok' ? 'var(--accent-light, #8cc28b)' : '';
  }

  function updatePortraitControlsVisibility() {
    const hasPendingGenerated = !!pendingGeneratedDataUrl;
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
    show('sf_portrait_revert', hasPendingGenerated);
    const setDisabled = (id, off) => { const el = document.getElementById(id); if (el) el.disabled = !!off; };
    setDisabled('sf_portrait_file',    stylising);
    setDisabled('sf_portrait_camera',  stylising);
    setDisabled('sf_portrait_clear',   stylising);
    setDisabled('sf_portrait_random',  stylising);
    setDisabled('sf_portrait_revert',  stylising || !hasPendingGenerated);
  }

  // Kept for backward-compat with callers; folded into updatePortraitControlsVisibility.
  function setPortraitControlsEnabled() { updatePortraitControlsVisibility(); }

  // Fit an image blob into the exact portrait display size and re-encode as JPEG.
  async function fitImageBlobToPortraitSize(file, width, height, quality) {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      try {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('decode failed'));
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      const w0 = img.naturalWidth || img.width;
      const h0 = img.naturalHeight || img.height;
      if (!w0 || !h0) return file;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = PORTRAIT_BG;
      ctx.fillRect(0, 0, width, height);
      // Cover scaling: the longest side of the image fills its matching edge of
      // the canvas. The shorter axis overflows and is cropped equally on both
      // ends so the subject stays centred.
      const scale = Math.max(width / w0, height / h0);
      const drawWidth = Math.max(1, Math.round(w0 * scale));
      const drawHeight = Math.max(1, Math.round(h0 * scale));
      const x = Math.floor((width - drawWidth) / 2);
      const y = Math.floor((height - drawHeight) / 2);
      ctx.drawImage(img, x, y, drawWidth, drawHeight);
      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality || 0.9);
      });
      if (!blob) return file;
      try {
        return new File([blob], 'portrait.jpg', { type: 'image/jpeg' });
      } catch (_) {
        return blob;
      }
    } catch (err) {
      console.warn('Portrait resize fell back to original:', err);
      return file;
    }
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error || new Error('FileReader failed'));
      r.readAsDataURL(blob);
    });
  }

  async function processPortraitSource(rawFile) {
    if (!rawFile) return;
    if (!rawFile.type.startsWith('image/')) {
      throw new Error('Please upload an image file.');
    }
    setPortraitStatus('Resizing…', '');
    const file = await fitImageBlobToPortraitSize(rawFile, PORTRAIT_STORAGE_WIDTH, PORTRAIT_STORAGE_HEIGHT, 0.9);

    revokeIfBlobUrl(originalUrl);
    revokeIfBlobUrl(lastGeneratedUrl);
    originalBlob = file;
    originalUrl = URL.createObjectURL(file);
    lastGeneratedUrl = null;
    pendingGeneratedDataUrl = null;
    previousPortraitDataUrl = null;

    const dataUrl = await readBlobAsDataUrl(file);
    setPortraitField(dataUrl);
    setPortraitPreview(dataUrl);

    const kb = Math.round(file.size / 1024);
    setPortraitStatus(`Ready (${kb} KB). Save the sheet to keep this picture, or click Random to generate a new portrait from the character sheet.`, '');
    updatePortraitControlsVisibility();
  }

  function stopPortraitCameraStream() {
    if (!portraitCameraStream) return;
    portraitCameraStream.getTracks().forEach((track) => track.stop());
    portraitCameraStream = null;
  }

  function closePortraitCameraModal() {
    stopPortraitCameraStream();
    const modal = document.getElementById('portrait-camera-modal');
    if (modal) modal.remove();
  }

  async function openPortraitCamera() {
    if (stylising) return;
    closePortraitCameraModal();
    const modal = document.createElement('div');
    modal.id = 'portrait-camera-modal';
    modal.className = 'portrait-camera-modal';
    modal.innerHTML = `
      <div class="portrait-camera-dialog">
        <div class="portrait-camera-title">Take portrait photo</div>
        <video id="portrait-camera-video" class="portrait-camera-video" autoplay playsinline muted></video>
        <div class="portrait-camera-actions">
          <button type="button" class="btn btn-primary" id="portrait-camera-capture">Capture</button>
          <button type="button" class="btn" id="portrait-camera-cancel">Cancel</button>
        </div>
      </div>`;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closePortraitCameraModal();
    });
    document.body.appendChild(modal);

    try {
      portraitCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1024 }, height: { ideal: 1024 } },
        audio: false
      });
      const video = document.getElementById('portrait-camera-video');
      if (video) video.srcObject = portraitCameraStream;
    } catch (err) {
      closePortraitCameraModal();
      setPortraitStatus(`Camera unavailable: ${err.message || err}`, 'error');
      return;
    }

    const captureBtn = document.getElementById('portrait-camera-capture');
    const cancelBtn = document.getElementById('portrait-camera-cancel');
    if (captureBtn) captureBtn.addEventListener('click', capturePortraitCameraFrame);
    if (cancelBtn) cancelBtn.addEventListener('click', closePortraitCameraModal);
  }

  async function capturePortraitCameraFrame() {
    const video = document.getElementById('portrait-camera-video');
    if (!video) return;
    const width = video.videoWidth || 1024;
    const height = video.videoHeight || 1024;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      setPortraitStatus('Could not capture a webcam frame.', 'error');
      closePortraitCameraModal();
      return;
    }
    closePortraitCameraModal();
    try {
      const file = new File([blob], 'portrait-webcam.jpg', { type: 'image/jpeg' });
      await processPortraitSource(file);
    } catch (err) {
      console.error(err);
      setPortraitStatus(err.message || 'Could not process webcam image.', 'error');
    }
  }

  // ── Portrait handlers ──────────────────────────────────────────────────────
  async function handlePortraitUpload(event) {
    const rawFile = event.target.files && event.target.files[0];
    if (!rawFile) return;
    try {
      await processPortraitSource(rawFile);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Could not read that image.');
      setPortraitStatus(err.message || 'Could not read that image.', 'error');
    } finally {
      event.target.value = '';
    }
  }

  function clearPortrait() {
    resetPortraitState();
    setPortraitField('');
    setPortraitPreview('');
    const picker = document.getElementById('sf_portrait_file');
    if (picker) picker.value = '';
    closePortraitCameraModal();
    setPortraitStatus('', '');
    updatePortraitControlsVisibility();
  }

  function revertPortrait() {
    setPortraitField(previousPortraitDataUrl || '');
    setPortraitPreview(previousPortraitDataUrl || '');
    revokeIfBlobUrl(lastGeneratedUrl);
    lastGeneratedUrl = null;
    pendingGeneratedDataUrl = null;
    previousPortraitDataUrl = null;
    setPortraitStatus('Discarded generated portrait.', '');
    updatePortraitControlsVisibility();
  }

  async function generateRandomPortrait() {
    if (stylising) return;
    const portraitSheet = collectPortraitPromptSheet();

    stylising = true;
    setPortraitControlsEnabled(false);
    setPortraitStatus('Generating… (can take ~1 min on first run)', '');

    let statusTick = 0;
    const ticker = setInterval(() => {
      statusTick += 1;
      const dots = '.'.repeat((statusTick % 4) + 1);
      setPortraitStatus(`Generating${dots}`, '');
    }, 800);

    try {
      const q = await fetch('/api/portrait/random', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sheet: portraitSheet })
      });
      const qText = await q.text();
      let qJson = null;
      try { qJson = JSON.parse(qText); } catch (_) { /* left null */ }
      if (!q.ok) {
        console.error('ComfyUI /prompt rejected the workflow:', qJson || qText);
        throw new Error(`Queue failed (HTTP ${q.status}). ${qText.slice(0, 300)}`);
      }
      // /prompt can return 200 with node_errors populated when a node fails
      // validation (e.g. missing model file). Treat that as a failure and show
      // the real message.
      if (qJson && qJson.node_errors && Object.keys(qJson.node_errors).length) {
        console.error('ComfyUI node_errors:', qJson.node_errors);
        const summary = Object.entries(qJson.node_errors).map(([nodeId, info]) => {
          const errs = (info && info.errors) || [];
          const msg = errs.map((e) => `${e.type || ''}: ${e.message || ''} ${e.details ? '(' + e.details + ')' : ''}`.trim()).join('; ');
          const cls = (info && info.class_type) ? ` [${info.class_type}]` : '';
          return `node ${nodeId}${cls} — ${msg || 'unknown error'}`;
        }).join(' | ');
        throw new Error(`Validation failed: ${summary}`);
      }
      const promptId = qJson && qJson.prompt_id;
      if (!promptId) throw new Error(`ComfyUI returned no prompt_id: ${qText.slice(0, 200)}`);

      // 4. Poll history until completed.
      const started = Date.now();
      const timeoutMs = 10 * 60 * 1000;
      let entry = null;
      while (Date.now() - started < timeoutMs) {
        await new Promise((r) => setTimeout(r, 2000));
        const h = await fetch(`/api/portrait/history/${encodeURIComponent(promptId)}`, { credentials: 'include' });
        if (h.ok) {
          const hJson = await h.json();
          const e = hJson[promptId];
          if (e && e.status && e.status.completed) { entry = e; break; }
          if (e && e.status && e.status.status_str === 'error') {
            console.error('ComfyUI history error for', promptId, ':', e.status);
            // Pull out the execution_error message (last "execution_error" entry wins).
            const execErr = (e.status.messages || []).slice().reverse()
              .find((m) => Array.isArray(m) && m[0] === 'execution_error');
            if (execErr && execErr[1]) {
              const info = execErr[1];
              const where = info.node_type ? ` in ${info.node_type} (node ${info.node_id})` : '';
              throw new Error(`ComfyUI error${where}: ${info.exception_message || info.exception_type || 'unknown'}`);
            }
            throw new Error('ComfyUI reported an error. Check the ComfyUI server log for details.');
          }
        }
      }
      if (!entry) throw new Error('Timed out waiting for ComfyUI.');

      // 5. Locate the saved image and fetch it.
      const outputs = entry.outputs || {};
      const saveNode = outputs['7'] || outputs['8'] || Object.values(outputs).find((o) => o && o.images);
      if (!saveNode || !saveNode.images || !saveNode.images.length) {
        throw new Error('ComfyUI finished but returned no image.');
      }
      const img = saveNode.images[0];
      const params = new URLSearchParams();
      params.set('filename', img.filename);
      if (img.subfolder) params.set('subfolder', img.subfolder);
      params.set('type', img.type || 'output');
      const imgRes = await fetch(`/api/portrait/view?${params.toString()}`, { credentials: 'include' });
      if (!imgRes.ok) throw new Error(`Fetching the generated image failed (HTTP ${imgRes.status}).`);
      const rawBlob = await imgRes.blob();
      const blob = await fitImageBlobToPortraitSize(rawBlob, PORTRAIT_STORAGE_WIDTH, PORTRAIT_STORAGE_HEIGHT, 0.92);

      // 6. Store as data URL in the hidden field (so Save persists it) and
      //    keep a blob URL for cheap preview.
      const dataUrl = await readBlobAsDataUrl(blob);
      previousPortraitDataUrl = ((document.getElementById('sf_portrait') || {}).value || '').trim();
      setPortraitField(dataUrl);
      setPortraitPreview(dataUrl);
      revokeIfBlobUrl(lastGeneratedUrl);
      lastGeneratedUrl = URL.createObjectURL(blob);
      pendingGeneratedDataUrl = dataUrl;

      setPortraitStatus('Generated preview ready. Save the sheet to keep it, or discard it.', 'ok');
    } catch (err) {
      console.error('Portrait generation failed:', err);
      setPortraitStatus(`Generation failed: ${err.message || err}`, 'error');
    } finally {
      clearInterval(ticker);
      stylising = false;
      setPortraitControlsEnabled(true);
      updatePortraitControlsVisibility();
    }
  }

  // ── Collect ────────────────────────────────────────────────────────────────
  function collectPortraitPromptSheet() {
    const data = collect();
    return {
      pronouns: data.pronouns,
      occupation: data.occupation,
      age: data.age,
      str: data.str,
      con: data.con,
      dex: data.dex,
      int: data.int,
      pow: data.pow,
      siz: data.siz,
      social_class: data.social_class,
      reputation: data.reputation,
      advantages: data.advantages,
      common_skills: data.common_skills,
      combat_skills: data.combat_skills,
      mandatory_skills: data.mandatory_skills,
      additional_skills: data.additional_skills,
      weapons: data.weapons,
      magic_tradition: data.magic_tradition,
      magic_spells: data.magic_spells
    };
  }

  function collect() {
    const g = (id) => { const el = document.getElementById(`sf_${id}`); return el ? el.value.trim() : ''; };

    const combat_skills = [];
    document.querySelectorAll('#combat-skills .combat-skill-row').forEach((row) => {
      const name = ((row.querySelector('input[readonly]') || {}).value || '').trim();
      const value = ((row.querySelector('.combat-skill-full') || {}).value || '').trim();
      if (name) combat_skills.push({ name, value: value || '0' });
    });

    const mandatory_skills = [];
    document.querySelectorAll('#mandatory-skills .skill-row').forEach((row) => {
      const name = (row.querySelector('.msk-name') || {}).value || '';
      const value = (row.querySelector('.msk-val') || {}).value || '';
      if (name) mandatory_skills.push({ name: name.trim(), value: value.trim() });
    });

    const additional_skills = [];
    document.querySelectorAll('#additional-skills .skill-row').forEach((row) => {
      const name = (row.querySelector('.ask-name') || {}).value || '';
      const value = (row.querySelector('.ask-val') || {}).value || '';
      if (name) additional_skills.push({ name: name.trim(), value: value.trim() });
    });

    const common_skills = [];
    document.querySelectorAll('#common-skills .csk-row').forEach((row) => {
      const name = String(row.dataset.name || '').trim();
      const value = ((row.querySelector('.csk-val') || {}).value || '').trim();
      if (name) common_skills.push({ name, value: value || '30' });
    });

    const magic_spells = [];
    document.querySelectorAll('#magic-spells .magic-spell-row').forEach((row) => {
      const name  = (row.querySelector('.spell-name')  || {}).value || '';
      const order = (row.querySelector('.spell-order') || {}).value || '';
      const notes = (row.querySelector('.spell-notes') || {}).value || '';
      if (name || order) magic_spells.push({ name: name.trim(), order: order.trim(), notes: notes.trim() });
    });

    const custom_fields = [];
    document.querySelectorAll('#custom-fields .custom-field-row').forEach((row) => {
      const k = row.querySelector('input:first-child');
      const v = row.querySelector('input:nth-child(2)');
      if (k && k.value.trim()) custom_fields.push({ key: k.value.trim(), value: (v ? v.value.trim() : '') });
    });

    // Derived — respect manual overrides
    const derivedFields = ['hp','san','mp','build'];
    const derived = {};
    derivedFields.forEach((f) => {
      const el = document.getElementById(`sf_derived_${f}`);
      derived[f] = el ? el.value.trim() : '';
    });
    derived.move = g('derived_move');

    const damage = {
      hurt: !!((document.getElementById('sf_damage_hurt') || {}).checked),
      bloodied: !!((document.getElementById('sf_damage_bloodied') || {}).checked),
      down: !!((document.getElementById('sf_damage_down') || {}).checked),
      impaired: !!((document.getElementById('sf_damage_impaired') || {}).checked)
    };

    const weapons = [];
    document.querySelectorAll('#weapons .weapon-row').forEach((row) => {
      const name = ((row.querySelector('.weapon-name') || {}).value || '').trim();
      const full = ((row.querySelector('.weapon-full') || {}).value || '').trim();
      const half = ((row.querySelector('.weapon-half') || {}).value || '').trim();
      const damageValue = ((row.querySelector('.weapon-damage') || {}).value || '').trim();
      const range = ((row.querySelector('.weapon-range') || {}).value || '').trim();
      if (name || full || half || damageValue || range) {
        weapons.push({ name, full, half, damage: damageValue, range });
      }
    });

    return {
      name: g('name'), pronouns: g('pronouns'),
      birthplace: g('birthplace'), residence: g('residence'),
      occupation: g('occupation'), social_class: g('social_class'), age: g('age'), affluence: g('affluence'),
      glitch: g('glitch'), backstory: g('backstory'), reputation: g('reputation'),
      portrait: g('portrait'),
      str: g('str'), con: g('con'), dex: g('dex'), int: g('int'), pow: g('pow'), siz: g('siz'),
      advantages: g('advantages_text'),
      disadvantages: g('disadvantages'),
      combat_skills, common_skills, mandatory_skills, additional_skills,
      luck: g('luck'), damage, weapons, carry: g('carry'),
      magic_tradition: g('magic_tradition'), magic_notes: g('magic_notes'), magic_spells,
      derived,
      custom_fields
    };
  }

  return {
    render, collect,
    addMandatory, removeMandatory,
    addAdditional, removeAdditional,
    addWeapon, removeWeapon,
    addSpell, removeSpell,
    addCustomField, removeCustomField,
    openPortraitCamera,
    handlePortraitUpload, clearPortrait,
    generateRandomPortrait, revertPortrait
  };
})();

window.SheetForm = SheetForm;
