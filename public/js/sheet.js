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
      <label style="display:block;margin-bottom:0.75rem;font-size:0.78rem;font-weight:700;color:var(--text2);">EXPERT SKILLS</label>
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
    </select>
    <div class="occupation-key">${OCCUPATIONS.filter((o) => o.novel).map((o) => `<span>${esc(o.name)}</span>`).join('')}<div class="occupation-key-help">Brighter entries are occupations held by characters in the Rivers of London novels.</div></div>`;
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

    return {
      name: g('name'), pronouns: g('pronouns'),
      birthplace: g('birthplace'), residence: g('residence'),
      occupation: g('occupation'), age: g('age'),
      glitch: g('glitch'), backstory: g('backstory'), reputation: g('reputation'),
      portrait: g('portrait'),
      str: g('str'), con: g('con'), dex: g('dex'), int: g('int'), pow: g('pow'),
      advantages: g('advantages'), disadvantages: g('disadvantages'),
      mandatory_skills, additional_skills,
      mov: g('mov'), luck: g('luck'), carry: g('carry'),
      custom_fields
    };
  }

  return { render, collect, addMandatory, removeMandatory, addAdditional, addCustomField, removeCustomField, handlePortraitUpload, clearPortrait };
})();
