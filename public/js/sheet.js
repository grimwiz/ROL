// Renders the character sheet form (editable or readonly)
const SheetForm = (() => {

  const DEFAULT = {
    name: '', pronouns: '', birthplace: '', residence: '',
    occupation: '', social_class: '', age: '',
    glitch: '', backstory: '', reputation: '',
    portrait: '',
    str: '', con: '', dex: '', int: '', pow: '', siz: '',
    advantages: '', disadvantages: '',
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

  function merge(saved) {
    const base = JSON.parse(JSON.stringify(DEFAULT));
    if (!saved) return base;
    Object.assign(base, saved);
    if (!Array.isArray(base.mandatory_skills)) base.mandatory_skills = DEFAULT.mandatory_skills;
    if (!Array.isArray(base.additional_skills)) base.additional_skills = DEFAULT.additional_skills;
    if (!Array.isArray(base.custom_fields)) base.custom_fields = [];
    if (!Array.isArray(base.magic_spells)) base.magic_spells = [];
    base.common_skills = mergeCommonSkills(base.common_skills);
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

  // ── Main render ────────────────────────────────────────────────────────────
  function render(container, data, readonly) {
    const d = merge(data);
    const rdAttr = readonly ? ' readonly' : '';
    const derived = d.derived || {};
    const autoD = calcDerivedFromData(d);

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
            ${!readonly ? '<input type="file" id="sf_portrait_file" accept="image/*" onchange="SheetForm.handlePortraitUpload(event)">' : ''}
            <input type="hidden" id="sf_portrait" value="${esc(d.portrait)}">
            ${!readonly ? '<button type="button" class="btn btn-sm" onclick="SheetForm.clearPortrait()">Remove picture</button>' : ''}
          </div>
          <div class="card-sub">Upload a JPG/PNG/GIF/WebP image.</div>
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

  <div class="sheet-section">
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
    <div class="sheet-section-header">6 · The Vitals</div>
    <div class="sheet-section-body">
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
      if (name === 'sense vestigia' && magical) valueSelect.value = '60';
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

  function initialiseDynamicFields(readonly) {
    updateStatAllocationMessage();
    updateAdvantagesAvailability();
    syncCommonSkillsForAdvantages();
    if (readonly) return;
    STAT_KEYS.forEach((stat) => {
      const el = document.getElementById(`sf_${stat}`);
      if (el) el.addEventListener('change', handleStatChange);
    });
    const advantagesPicker = document.getElementById('sf_advantages');
    if (advantagesPicker) advantagesPicker.addEventListener('change', syncAdvantagesTextFromPicker);
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
  }

  function removeMandatory(btn) {
    const row = btn && btn.closest('.skill-row');
    if (row) row.remove();
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
  }

  function removeAdditional(btn) {
    const row = btn && btn.closest('.skill-row');
    if (row) row.remove();
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
  }

  function removeSpell(btn) {
    const row = btn && btn.closest('.magic-spell-row');
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

  function handlePortraitUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please upload an image file.'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const hidden = document.getElementById('sf_portrait');
      if (hidden) hidden.value = dataUrl;
      const slot = document.querySelector('.sheet-portrait');
      if (slot) slot.innerHTML = `<img src="${esc(dataUrl)}" alt="Character portrait" class="sheet-portrait-image">`;
    };
    reader.readAsDataURL(file);
  }

  function clearPortrait() {
    const hidden = document.getElementById('sf_portrait');
    if (hidden) hidden.value = '';
    const slot = document.querySelector('.sheet-portrait');
    if (slot) slot.innerHTML = '<div class="sheet-portrait-empty">No picture</div>';
    const picker = document.getElementById('sf_portrait_file');
    if (picker) picker.value = '';
  }

  // ── Collect ────────────────────────────────────────────────────────────────
  function collect() {
    const g = (id) => { const el = document.getElementById(`sf_${id}`); return el ? el.value.trim() : ''; };

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

    return {
      name: g('name'), pronouns: g('pronouns'),
      birthplace: g('birthplace'), residence: g('residence'),
      occupation: g('occupation'), social_class: g('social_class'), age: g('age'),
      glitch: g('glitch'), backstory: g('backstory'), reputation: g('reputation'),
      portrait: g('portrait'),
      str: g('str'), con: g('con'), dex: g('dex'), int: g('int'), pow: g('pow'), siz: g('siz'),
      advantages: g('advantages_text'),
      disadvantages: g('disadvantages'),
      common_skills, mandatory_skills, additional_skills,
      luck: g('luck'), carry: g('carry'),
      magic_tradition: g('magic_tradition'), magic_notes: g('magic_notes'), magic_spells,
      derived,
      custom_fields
    };
  }

  return {
    render, collect,
    addMandatory, removeMandatory,
    addAdditional, removeAdditional,
    addSpell, removeSpell,
    addCustomField, removeCustomField,
    handlePortraitUpload, clearPortrait
  };
})();
