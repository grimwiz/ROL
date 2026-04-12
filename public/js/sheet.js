// Renders the character sheet form (editable or readonly)
const SheetForm = (() => {

  const DEFAULT = {
    name: '', pronouns: '', birthplace: '', residence: '',
    occupation: '', age: '',
    glitch: '', reputation: '',
    str: '', con: '', dex: '', int: '', pow: '',
    advantages: '', disadvantages: '',
    mandatory_skills: [
      { name: 'Art/Craft (Stage Magic)', value: '' },
      { name: 'Sleight of Hand', value: '' },
      { name: 'Persuade', value: '' }
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

  function merge(saved) {
    const base = JSON.parse(JSON.stringify(DEFAULT));
    if (!saved) return base;
    // Deep merge top-level keys
    Object.assign(base, saved);
    // Ensure arrays exist
    if (!Array.isArray(base.mandatory_skills)) base.mandatory_skills = DEFAULT.mandatory_skills;
    if (!Array.isArray(base.additional_skills)) base.additional_skills = DEFAULT.additional_skills;
    if (!Array.isArray(base.custom_fields)) base.custom_fields = [];
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 1.5rem;">
        ${fg('Name', `<input type="text" id="sf_name" value="${esc(d.name)}" placeholder="Full name"${rdAttr}>`)}
        ${fg('Pronouns', `<input type="text" id="sf_pronouns" value="${esc(d.pronouns)}" placeholder="e.g. he/him"${rdAttr}>`)}
        ${fg('Place of Birth', `<input type="text" id="sf_birthplace" value="${esc(d.birthplace)}"${rdAttr}>`)}
        ${fg('Residence', `<input type="text" id="sf_residence" value="${esc(d.residence)}"${rdAttr}>`)}
        ${fg('Occupation', `<input type="text" id="sf_occupation" value="${esc(d.occupation)}"${rdAttr}>`)}
        ${fg('Age', `<input type="number" id="sf_age" value="${esc(d.age)}" min="16" max="100"${rdAttr}>`)}
      </div>
      ${fg('The "Glitch" – What was your anomalous event?',
        `<textarea id="sf_glitch" rows="4" placeholder="Describe the unexplained event that drew you in…"${rdAttr}>${esc(d.glitch)}</textarea>`)}
      ${fg('Reputation',
        `<input type="text" id="sf_reputation" value="${esc(d.reputation)}" placeholder="e.g. Analytical. Thorough. Sceptical."${rdAttr}>`)}
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">2 · Characteristics</div>
    <div class="sheet-section-body">
      <div class="characteristics-grid">
        ${['str','con','dex','int','pow'].map(s => `
          <div class="char-field form-group">
            <label>${s.toUpperCase()}</label>
            <input type="number" id="sf_${s}" value="${esc(d[s])}" min="1" max="100"${rdAttr}>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">3 · Edges &amp; Flaws</div>
    <div class="sheet-section-body">
      ${fg('Advantages', `<input type="text" id="sf_advantages" value="${esc(d.advantages)}" placeholder="e.g. Magical (Major), Steadfast, Wealthy"${rdAttr}>`)}
      ${fg('Disadvantages', `<input type="text" id="sf_disadvantages" value="${esc(d.disadvantages)}" placeholder="e.g. Weak (Max STR 40)"${rdAttr}>`)}
    </div>
  </div>

  <div class="sheet-section">
    <div class="sheet-section-header">4 · Skills &amp; Specialties</div>
    <div class="sheet-section-body">
      <label style="display:block;margin-bottom:0.75rem;font-size:0.78rem;font-weight:700;color:var(--text2);">MANDATORY SKILLS</label>
      <div class="skills-grid" id="mandatory-skills">
        ${d.mandatory_skills.map((sk, i) => `
          <div class="skill-row">
            <input type="text" id="sf_msk_name_${i}" class="msk-name" value="${esc(sk.name)}" placeholder="Skill name"${rdAttr}>
            <input type="number" id="sf_msk_val_${i}" class="msk-val" value="${esc(sk.value)}" placeholder="%" min="0" max="100"${rdAttr}>
            ${!readonly ? `<button type="button" class="btn btn-sm btn-danger" onclick="SheetForm.removeMandatory(this)">✕</button>` : ''}
          </div>`).join('')}
      </div>
      ${!readonly ? `<button type="button" class="btn btn-sm" style="margin-top:0.5rem" onclick="SheetForm.addMandatory()">+ Add mandatory skill</button>` : ''}

      <label style="display:block;margin:1rem 0 0.75rem;font-size:0.78rem;font-weight:700;color:var(--text2);">ADDITIONAL SKILLS</label>
      <div class="skills-grid" id="additional-skills">
        ${d.additional_skills.map((sk, i) => `
          <div class="skill-row">
            <input type="text" id="sf_ask_name_${i}" class="ask-name" value="${esc(sk.name)}" placeholder="Skill name"${rdAttr}>
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
    const i = grid.querySelectorAll('.skill-row').length;
    const div = document.createElement('div');
    div.className = 'skill-row';
    div.innerHTML = `<input type="text" id="sf_msk_name_${i}" class="msk-name" placeholder="Skill name">
      <input type="number" id="sf_msk_val_${i}" class="msk-val" placeholder="%" min="0" max="100">
      <button type="button" class="btn btn-sm btn-danger" onclick="SheetForm.removeMandatory(this)">✕</button>`;
    grid.appendChild(div);
  }

  function removeMandatory(btn) {
    const row = btn && btn.closest('.skill-row');
    if (row) row.remove();
  }

  function addAdditional() {
    const grid = document.getElementById('additional-skills');
    const i = grid.querySelectorAll('.skill-row').length;
    const div = document.createElement('div');
    div.className = 'skill-row';
    div.innerHTML = `<input type="text" id="sf_ask_name_${i}" class="ask-name" placeholder="Skill name">
      <input type="number" id="sf_ask_val_${i}" class="ask-val" placeholder="%" min="0" max="100">`;
    grid.appendChild(div);
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

    return {
      name: g('name'), pronouns: g('pronouns'),
      birthplace: g('birthplace'), residence: g('residence'),
      occupation: g('occupation'), age: g('age'),
      glitch: g('glitch'), reputation: g('reputation'),
      str: g('str'), con: g('con'), dex: g('dex'), int: g('int'), pow: g('pow'),
      advantages: g('advantages'), disadvantages: g('disadvantages'),
      mandatory_skills, additional_skills,
      mov: g('mov'), luck: g('luck'), carry: g('carry'),
      custom_fields
    };
  }

  return { render, collect, addMandatory, removeMandatory, addAdditional, addCustomField, removeCustomField };
})();
