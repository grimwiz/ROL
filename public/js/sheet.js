// Renders the character sheet form (editable or readonly)
const SheetForm = (() => {

  const DEFAULT = {
    name: '', pronouns: '', birthplace: '', residence: '',
    occupation: '', age: '',
    glitch: '', backstory: '', reputation: '',
    portrait: '',
    str: '', con: '', dex: '', int: '', pow: '',
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
    custom_fields: []
  };

  const OCCUPATIONS = [
    { name: 'Architect', novel: true },
    { name: 'Artist', novel: true },
    { name: 'Athlete', novel: false },
    { name: 'Author', novel: false },
    { name: 'Chancer', novel: true },
    { name: 'Clergy, member of the', novel: false },
    { name: 'Computer specialist', novel: true },
    { name: 'Criminal', novel: true },
    { name: 'Dilettante', novel: true },
    { name: 'Doctor of medicine', novel: true },
    { name: 'Driver', novel: false },
    { name: 'Entertainer', novel: true },
    { name: 'Farmer', novel: true },
    { name: 'Firefighter', novel: true },
    { name: 'Influencer', novel: false },
    { name: 'Journalist', novel: false },
    { name: 'Lawyer', novel: true },
    { name: 'Lecturer', novel: false },
    { name: 'Librarian', novel: true },
    { name: 'Nurse', novel: false },
    { name: 'Paramedic', novel: true },
    { name: 'Parapsychologist', novel: false },
    { name: 'Police officer/detective', novel: true },
    { name: 'Private investigator', novel: false },
    { name: 'Service member', novel: true },
    { name: 'Social worker', novel: true },
    { name: 'Special agent', novel: true },
    { name: 'Tradesperson', novel: true }
  ];
  const STAT_OPTIONS = [30, 40, 50, 60, 70, 80];
  const SKILL_PERCENT_OPTIONS = [30, 40, 50, 60];
  const STAT_KEYS = ['str', 'con', 'dex', 'int', 'pow'];
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

  function parseAdvantages(value) {
    if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
    return String(value || '')
      .split(/,|;|\n|\band\b/gi)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

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
    // Deep merge top-level keys
    Object.assign(base, saved);
    // Ensure arrays exist
    if (!Array.isArray(base.mandatory_skills)) base.mandatory_skills = DEFAULT.mandatory_skills;
    if (!Array.isArray(base.additional_skills)) base.additional_skills = DEFAULT.additional_skills;
    if (!Array.isArray(base.custom_fields)) base.custom_fields = [];
    base.common_skills = mergeCommonSkills(base.common_skills);
    base.advantages = parseAdvantages(base.advantages).join(', ');
    return base;
  }

  function ro(readonly) { return readonly ? ' readonly' : ''; }
  function inp(id, val, type, placeholder, extra) {
    type = type || 'text';
    return `<input type="${type}" id="sf_${id}" value="${esc(val)}" placeholder="${placeholder||''}" ${extra||''}>`;
  }
  function esc(v) { return String(v||'').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  function ta(id, val, placeholder) {
    return `<textarea id="sf_${id}" placeholder="${placeholder||''}" rows="3">${esc(val)}</textarea>`;
  }
  function fg(label, inner) {
    return `<div class="form-group"><label>${label}</label>${inner}</div>`;
  }

  function render(container, data, readonly) {
    const d = merge(data);
    const rdAttr = readonly ? ' readonly' : '';

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
        ${fg('Profession', renderProfessionSelect(d.occupation, readonly))}
        ${fg('Age', `<input type="number" id="sf_age" value="${esc(d.age)}" min="16" max="100"${rdAttr}>`)}
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
          <div id="portrait-help" class="card-sub">Upload a JPG/PNG/GIF/WebP image to display in the top-right of this character sheet.</div>
        </div>
      </div>
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">2 · Characteristics</div>
    <div class="sheet-section-body">
      <div class="characteristics-grid">
        ${['str','con','dex','int','pow'].map(s => `
          <div class="char-field form-group">
            <label>${s.toUpperCase()}</label>
            ${renderStatSelect(s, d[s], readonly)}
          </div>`).join('')}
      </div>
      <div id="stat-allocation-note" class="card-sub" style="margin-top:0.5rem"></div>
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">3 · Edges &amp; Flaws</div>
    <div class="sheet-section-body">
      ${fg('Advantages', renderAdvantagesSelect(d.advantages, readonly))}
      ${fg('Disadvantages', `<input type="text" id="sf_disadvantages" value="${esc(d.disadvantages)}" placeholder="e.g. Weak (Max STR 40)"${rdAttr}>`)}
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
    <div class="sheet-section-header">5 · The Vitals</div>
    <div class="sheet-section-body">
      <div class="edl-grid">
        ${fg('Movement (MOV)', `<input type="number" id="sf_mov" value="${esc(d.mov)}" min="1" max="20"${rdAttr}>`)}
        ${fg('Luck Roll', `<input type="number" id="sf_luck" value="${esc(d.luck)}" min="1" max="100"${rdAttr}>`)}
      </div>
      ${fg('Everyday Carry', `<textarea id="sf_carry" rows="3" placeholder="List what your character routinely carries…"${rdAttr}>${esc(d.carry)}</textarea>`)}
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">6 · Custom Fields</div>
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

  function renderPortraitPreview(value) {
    return value
      ? `<img src="${esc(value)}" alt="Character portrait" class="sheet-portrait-image">`
      : '<div class="sheet-portrait-empty">No picture</div>';
  }

  function renderProfessionSelect(selected, readonly) {
    const rdAttr = readonly ? ' disabled' : '';
    const options = OCCUPATIONS.map((occupation) => {
      const selectedAttr = occupation.name === selected ? ' selected' : '';
      const label = occupation.novel ? `${occupation.name} (Novel)` : occupation.name;
      return `<option value="${esc(occupation.name)}"${selectedAttr}>${esc(label)}</option>`;
    }).join('');
    return `<select id="sf_occupation"${rdAttr}>
      <option value="">Select a profession</option>
      ${options}
    </select>`;
  }

  function renderStatSelect(statKey, value, readonly) {
    const rdAttr = readonly ? ' disabled' : '';
    const options = STAT_OPTIONS.map((n) => {
      const selectedAttr = String(value || '') === String(n) ? ' selected' : '';
      return `<option value="${n}"${selectedAttr}>${n}</option>`;
    }).join('');
    return `<select id="sf_${statKey}"${rdAttr}>
      <option value="">-</option>
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
        <div class="card-sub" style="margin-top:0.35rem">Hold Ctrl/Cmd to select multiple advantages. Custom entries in the text box are preserved.</div>
      </details>`}`;
  }

  function getStatValue(statKey) {
    const el = document.getElementById(`sf_${statKey}`);
    const val = parseInt(el ? el.value : '', 10);
    return Number.isFinite(val) ? val : 0;
  }

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
    const delta = 280 - total;
    if (delta === 0) {
      messageEl.textContent = 'Stat allocation total is 280/280.';
      messageEl.style.color = 'var(--text2)';
      return;
    }
    if (delta > 0) {
      messageEl.textContent = `Stat allocation total is ${total}/280. Allocate ${delta} more points.`;
      messageEl.style.color = '#c77900';
      return;
    }
    const excess = Math.abs(delta);
    messageEl.textContent = `Stat allocation total is ${total}/280. Reduce your stats by ${excess} points.`;
    messageEl.style.color = '#b42318';
  }

  function handleStatChange() {
    updateStatAllocationMessage();
    updateAdvantagesAvailability();
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

  function renderCustomField(cf, i, readonly) {
    const rdAttr = readonly ? ' readonly' : '';
    return `<div class="custom-field-row" id="cf_row_${i}">
      <input type="text" id="cf_key_${i}" value="${esc(cf.key)}" placeholder="Field name"${rdAttr}>
      <input type="text" id="cf_val_${i}" value="${esc(cf.value)}" placeholder="Value"${rdAttr}>
      ${!readonly ? `<button type="button" class="btn btn-sm btn-danger" onclick="SheetForm.removeCustomField(${i})">✕</button>` : '<span></span>'}
    </div>`;
  }

  function addMandatory() {
    const grid = document.getElementById('mandatory-skills');
    const i = Date.now(); // unique id — avoids collisions with pre-rendered rows
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

  function addCustomField() {
    const container = document.getElementById('custom-fields');
    const i = container.querySelectorAll('.custom-field-row').length;
    const div = document.createElement('div');
    div.className = 'custom-field-row';
    div.id = `cf_row_${i}`;
    div.innerHTML = `<input type="text" id="cf_key_${i}" placeholder="Field name">
      <input type="text" id="cf_val_${i}" placeholder="Value">
      <button type="button" class="btn btn-sm btn-danger" onclick="SheetForm.removeCustomField(${i})">✕</button>`;
    container.appendChild(div);
  }

  function removeCustomField(i) {
    const row = document.getElementById(`cf_row_${i}`);
    if (row) row.remove();
  }

  function handlePortraitUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      event.target.value = '';
      return;
    }
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

    const custom_fields = [];
    document.querySelectorAll('#custom-fields .custom-field-row').forEach((row, i) => {
      const k = document.getElementById(`cf_key_${i}`);
      const v = document.getElementById(`cf_val_${i}`);
      if (k && k.value.trim()) custom_fields.push({ key: k.value.trim(), value: (v ? v.value.trim() : '') });
    });

    const common_skills = [];
    document.querySelectorAll('#common-skills .csk-row').forEach((row) => {
      const name = String(row.dataset.name || '').trim();
      const value = ((row.querySelector('.csk-val') || {}).value || '').trim();
      if (name) common_skills.push({ name, value: value || '30' });
    });

    return {
      name: g('name'), pronouns: g('pronouns'),
      birthplace: g('birthplace'), residence: g('residence'),
      occupation: g('occupation'), age: g('age'),
      glitch: g('glitch'), backstory: g('backstory'), reputation: g('reputation'),
      portrait: g('portrait'),
      str: g('str'), con: g('con'), dex: g('dex'), int: g('int'), pow: g('pow'),
      advantages: g('advantages_text'),
      disadvantages: g('disadvantages'),
      common_skills, mandatory_skills, additional_skills,
      mov: g('mov'), luck: g('luck'), carry: g('carry'),
      custom_fields
    };
  }

  return { render, collect, addMandatory, removeMandatory, addAdditional, removeAdditional, addCustomField, removeCustomField, handlePortraitUpload, clearPortrait };
})();
