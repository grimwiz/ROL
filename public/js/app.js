// ── State ─────────────────────────────────────────────────────────────────────
const State = {
  user: null,
  sessions: [],
  users: [],
  currentSession: null,
  currentSessionPanel: 'characters',
  currentSheetUserId: null,
  npcs: [],
  scenarioInfo: null,
  scenarioSources: null,
  scenarioSelectedSourceIndex: null,
  rulesFiles: null,
  domesticAdventure: null,
  domesticCurrentStep: null,
  domesticSavedStep: null,
  domesticProgressLoaded: false,
  domesticSheet: null,
  domesticSheetLoaded: false,
  domesticSaveTimer: null,
  domesticSaveInflight: null,
  llmBusy: false,
  llmPollTimer: null,
  llmLocalPending: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function esc(v) { return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showAlert(msg, type, containerId) {
  const c = el(containerId);
  if (!c) return;
  c.innerHTML = `<div class="alert alert-${type}">${esc(msg)}</div>`;
  setTimeout(() => { if(c) c.innerHTML = ''; }, 4000);
}

function modal(html, onMount) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `<div class="modal">${html}</div>`;
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });
  document.body.appendChild(bd);
  if (onMount) onMount(bd);
  return bd;
}

const DEFAULT_GM_SKILL_VALUES = new Map([
  'athletics', 'drive', 'navigate', 'observation', 'read person',
  'research', 'sense vestigia', 'social', 'stealth',
  'fighting', 'firearms'
].map((name) => [name, 30]));

function parsePercent(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function getSheetSkills(d) {
  return [
    ...(d.combat_skills || []),
    ...(d.common_skills || []),
    ...(d.mandatory_skills || []),
    ...(d.additional_skills || [])
  ];
}

function summarizeCondition(d) {
  const damage = d.damage || {};
  const labels = [];
  if (damage.down) labels.push('Down');
  else if (damage.bloodied) labels.push('Bloodied');
  else if (damage.hurt) labels.push('Hurt');
  if (damage.impaired) labels.push('Impaired');
  return labels.join(', ') || 'OK';
}

function summarizeResources(d) {
  const out = [];
  const hp = d.derived && d.derived.hp;
  const mp = d.derived && d.derived.mp;
  const luck = d.luck;
  const mov = (d.derived && d.derived.move) || d.mov;
  if (hp) out.push(`HP ${hp}`);
  if (mp) out.push(`MP ${mp}`);
  if (mov) out.push(`MOV ${mov}`);
  if (luck) out.push(`Luck ${luck}`);
  return out.join(', ') || '—';
}

function summarizeNotableSkills(d, limit = 6) {
  const notable = getSheetSkills(d)
    .filter((s) => s && s.name)
    .map((s) => ({
      name: String(s.name).trim(),
      value: parsePercent(s.value)
    }))
    .filter((s) => s.name && s.value !== null)
    .filter((s) => {
      const baseline = DEFAULT_GM_SKILL_VALUES.get(s.name.toLowerCase());
      return baseline != null ? s.value > baseline : s.value > 0;
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit);

  return notable.map((s) => `${s.name} ${s.value}%`).join(', ') || '—';
}

function summarizeWeapons(d, limit = 3) {
  const rows = Array.isArray(d.weapons) ? d.weapons : [];
  const weapons = rows
    .filter((w) => w && (w.name || w.damage || w.range))
    .map((w) => {
      const parts = [];
      if (w.damage) parts.push(String(w.damage).trim());
      if (w.range) parts.push(String(w.range).trim());
      return `${String(w.name || 'Unnamed').trim()}${parts.length ? ` (${parts.join(', ')})` : ''}`;
    })
    .slice(0, limit);
  return weapons.join(', ') || '—';
}

function summarizePlayNotes(d) {
  const notes = [];
  if (d.advantages) notes.push(`Adv: ${d.advantages}`);
  if (d.magic_tradition) notes.push(`Magic: ${d.magic_tradition}`);
  if (d.carry) notes.push(`Gear: ${d.carry}`);
  return notes.join(' | ') || '—';
}

function hasSheetData(sheet) {
  return !!(sheet && sheet.data && Object.keys(sheet.data).length > 0);
}

const DICE_PRESETS = [
  { value: '1d100', label: 'd100 (Percentile)' },
  { value: '2d10+50', label: '2d10+50 (Luck)' },
  { value: '1d20', label: 'd20' },
  { value: '1d12', label: 'd12' },
  { value: '1d10', label: 'd10' },
  { value: '1d8', label: 'd8' },
  { value: '1d6', label: 'd6' },
  { value: '1d4', label: 'd4' }
];

function resetUserScopedState() {
  State.sessions = [];
  State.users = [];
  State.currentSession = null;
  State.currentSessionPanel = 'characters';
  State.currentSheetUserId = null;
  State.npcs = [];
  State.scenarioInfo = null;
  State.rulesFiles = null;
  resetDomesticRuntimeState();
}

function resetDomesticRuntimeState(options = {}) {
  const { preserveAdventure = false } = options;
  if (!preserveAdventure) State.domesticAdventure = null;
  State.domesticCurrentStep = null;
  State.domesticSavedStep = null;
  State.domesticProgressLoaded = false;
  State.domesticSheet = null;
  State.domesticSheetLoaded = false;
  if (State.domesticSaveTimer) {
    clearTimeout(State.domesticSaveTimer);
    State.domesticSaveTimer = null;
  }
  State.domesticSaveInflight = null;
}

function setDomesticSheetStatus(text, kind = '') {
  const status = el('domestic-sheet-status');
  if (!status) return;
  status.textContent = text || '';
  status.className = `save-status${kind ? ` ${kind}` : ''}`;
}

async function waitForDomesticPersistence() {
  if (State.domesticSaveTimer) {
    clearTimeout(State.domesticSaveTimer);
    State.domesticSaveTimer = null;
  }
  if (State.domesticSaveInflight) {
    try { await State.domesticSaveInflight; } catch {}
  }
}

// ── Routing ───────────────────────────────────────────────────────────────────
const APP_TABS = ['sessions', 'rules', 'admin'];

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = el(pageId);
  if (pg) pg.classList.add('active');
}

function setActiveMainTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  APP_TABS.forEach((name) => {
    const tabEl = el(`tab-${name}`);
    if (tabEl) tabEl.style.display = name === tab ? '' : 'none';
  });
}

function updateUiStateInUrl(patch, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null || value === '') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  if (replace) {
    window.history.replaceState({}, '', url.toString());
  } else {
    window.history.pushState({}, '', url.toString());
  }
}

function updateAdventureStepInUrl(step, replace = false) {
  updateUiStateInUrl({ adventureStep: step || null }, replace);
}

function readUiStateFromUrl() {
  const url = new URL(window.location.href);
  const parseIntParam = (name) => {
    const value = parseInt(url.searchParams.get(name), 10);
    return Number.isInteger(value) ? value : null;
  };
  const tab = url.searchParams.get('tab');
  return {
    tab: tab || 'sessions',
    sessionId: parseIntParam('session'),
    sessionRaw: url.searchParams.get('session'),
    adventureStep: parseIntParam('adventureStep')
  };
}

function readAdventureStepFromUrl() {
  return readUiStateFromUrl().adventureStep;
}

async function restoreUiFromUrl(replace = false) {
  const route = readUiStateFromUrl();

  // The Domestic now lives inside the Case File page. `?session=domestic` is the
  // canonical marker; `?tab=domestic` is kept working for old bookmarks.
  if (route.tab === 'domestic' || route.sessionRaw === 'domestic') {
    await openDomestic({ replaceUrl: replace });
    return;
  }

  const allowedTabs = new Set(['sessions', 'rules', 'admin']);
  const targetTab = allowedTabs.has(route.tab) ? route.tab : 'sessions';

  if (targetTab === 'admin' && State.user.role !== 'gm') {
    await switchTab('sessions', { replaceUrl: true });
    return;
  }

  if (targetTab === 'sessions') {
    if (route.sessionId) {
      if (!State.sessions.length) {
        await loadSessionsTab({ skipUrlUpdate: true });
      }
      await openSession(route.sessionId, { replaceUrl: replace });
      return;
    }
    await switchTab('sessions', { replaceUrl: true });
    return;
  }

  await switchTab(targetTab, { replaceUrl: replace });
}

// ── App init ──────────────────────────────────────────────────────────────────
async function init() {
  renderLoginPage();
  window.addEventListener('popstate', () => {
    if (!State.user) return;
    restoreUiFromUrl(true).catch((err) => {
      console.error('Could not restore UI state from URL:', err);
    });
  });
  try {
    resetUserScopedState();
    State.user = await api.me();
    await renderMain();
  } catch {
    showPage('login-page');
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
function renderLoginPage() {
  const app = el('app');
  el('loading-screen') && el('loading-screen').remove();
  if (!el('login-page')) {
    const div = document.createElement('div');
    div.id = 'login-page';
    div.className = 'page login-page';
    div.innerHTML = `
      <div class="login-card">
        <div class="login-header">
          <div class="logo">🔮</div>
          <h1>The Folly</h1>
          <p>Investigator Case Files</p>
        </div>
        <div id="login-alert"></div>
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="login-user" autocomplete="username" autocapitalize="none">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="login-pass" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-full" id="login-btn">Sign in</button>
      </div>`;
    app.appendChild(div);
  }
  showPage('login-page');

  const btn = el('login-btn');
  const doLogin = async () => {
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      resetUserScopedState();
      State.user = await api.login(el('login-user').value, el('login-pass').value);
      await renderMain();
    } catch (e) {
      showAlert(e.message, 'danger', 'login-alert');
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  };
  btn.onclick = doLogin;
  el('login-pass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
}

// ── Main shell ────────────────────────────────────────────────────────────────
async function renderMain() {
  const app = el('app');
  el('loading-screen') && el('loading-screen').remove();
  if (!el('main-page')) {
    const div = document.createElement('div');
    div.id = 'main-page';
    div.className = 'page';
    app.appendChild(div);
  }

  const isGM = State.user.role === 'gm';

  el('main-page').innerHTML = `
    <nav class="nav">
      <div class="nav-brand">🔮 The Folly</div>
      <div class="nav-tabs">
        <button class="nav-tab active" data-tab="sessions" onclick="switchTab('sessions')">Case File</button>
        <button class="nav-tab" data-tab="rules" onclick="switchTab('rules')">Rules</button>
        ${isGM ? `<button class="nav-tab" data-tab="admin" onclick="switchTab('admin')">Admin</button>` : ''}
      </div>
      <div class="nav-right">
        <span id="nav-llm-status" class="llm-status" hidden title="The language model is generating content">
          <span class="llm-dot"></span><span class="llm-text">Generating…</span>
        </span>
        <div class="dice-roller" title="Quick dice roller">
          <select id="nav-dice-select" class="dice-select" aria-label="Dice preset">
            ${DICE_PRESETS.map((preset) => `<option value="${preset.value}"${preset.value === '1d100' ? ' selected' : ''}>${preset.label}</option>`).join('')}
          </select>
          <button class="btn btn-sm" onclick="rollNavDice()">Roll</button>
          <span id="nav-dice-result" class="dice-result">—</span>
        </div>
        <button class="nav-user nav-user-button" onclick="openMyCharacters()" title="View your stored characters">
          ${esc(State.user.username)}
          ${isGM ? '<span class="badge-gm">GM</span>' : ''}
        </button>
        <button class="btn btn-sm" onclick="doLogout()">Sign out</button>
      </div>
    </nav>
    <div id="tab-sessions" class="main"></div>
    <div id="tab-rules" class="main" style="display:none"></div>
    ${isGM ? `<div id="tab-admin" class="main" style="display:none"></div>` : ''}`;

  showPage('main-page');
  startLlmStatusPolling();
  await restoreUiFromUrl(true);
}

// ── LLM busyness indicator ────────────────────────────────────────────────────
// The single Ollama path tracks in-process generation activity; we poll it so a
// GM gets unmistakable feedback (status by the dice roller + regenerate buttons
// disabled) instead of clicking Bulk Regenerate again and again.
function applyLlmBusyUI(status) {
  // Locally-initiated work counts as busy immediately, before the server has
  // even entered the Ollama call — so the indicator never lags or flickers
  // off mid-operation when an early poll races ahead of the request.
  const serverBusy = !!(status && status.busy);
  const busy = serverBusy || State.llmLocalPending > 0;
  State.llmBusy = busy;
  const box = el('nav-llm-status');
  if (box) {
    box.hidden = !busy;
    const txt = box.querySelector('.llm-text');
    if (txt) {
      const where = status && status.last_section ? ` · ${status.last_section}` : '';
      txt.textContent = `Generating${where}`;
    }
  }
  document.querySelectorAll('.js-regen').forEach((b) => {
    if (busy) {
      if (!b.disabled) { b.disabled = true; b.dataset.llmDisabled = '1'; }
    } else if (b.dataset.llmDisabled) {
      b.disabled = false;
      delete b.dataset.llmDisabled;
    }
  });
}

async function pollLlmStatusOnce() {
  try {
    applyLlmBusyUI(await api.getLlmStatus());
  } catch { /* transient — keep last known state */ }
}

function startLlmStatusPolling() {
  if (State.llmPollTimer) return;
  pollLlmStatusOnce();
  State.llmPollTimer = setInterval(pollLlmStatusOnce, 3000);
}

// Bracket a locally-initiated LLM operation so the busy indicator shows
// instantly and stays until it actually finishes (consistent everywhere:
// regenerate pages/sections and GM Chat).
function llmPendingBegin(label) {
  State.llmLocalPending += 1;
  applyLlmBusyUI({ busy: true, last_section: label || null });
}
function llmPendingEnd() {
  State.llmLocalPending = Math.max(0, State.llmLocalPending - 1);
  pollLlmStatusOnce();
}

async function switchTab(tab, options = {}) {
  const { replaceUrl = false, preserveSession = false } = options;
  if (tab === 'admin' && State.user.role !== 'gm') tab = 'sessions';
  setActiveMainTab(tab);

  updateUiStateInUrl({
    tab,
    session: tab === 'sessions' && preserveSession ? undefined : null,
    adventureStep: null
  }, replaceUrl);

  if (tab === 'sessions') await loadSessionsTab({ skipUrlUpdate: true });
  if (tab === 'admin') await loadAdminTab();
  if (tab === 'rules') await loadRulesTab();
}

async function doLogout() {
  await api.logout();
  resetUserScopedState();
  State.user = null;
  showPage('login-page');
  renderLoginPage();
}

async function rollNavDice() {
  const select = el('nav-dice-select');
  const result = el('nav-dice-result');
  if (!select || !result) return;
  result.textContent = '…';
  result.title = 'Rolling…';
  try {
    const formula = select.value || '1d100';
    const preset = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : formula;
    const rolled = await api.rollDice(formula, preset);
    result.textContent = String(rolled.total);
    const modifierText = rolled.modifier ? ` ${rolled.modifier > 0 ? '+' : '-'} ${Math.abs(rolled.modifier)}` : '';
    result.title = `${formula}: ${rolled.rolls.join(' + ')}${modifierText} = ${rolled.total}`;
  } catch (e) {
    result.textContent = 'Err';
    result.title = e.message || 'Dice roll failed';
  }
}
window.rollNavDice = rollNavDice;

async function openMyCharacters() {
  const view = modal(`
    <h3>My Characters</h3>
    <div id="my-characters-body"><p style="color:var(--text2)">Loading stored characters…</p></div>
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Close</button>
    </div>`, (bd) => {
    const modalEl = bd.querySelector('.modal');
    if (modalEl) modalEl.style.maxWidth = '1100px';
  });

  const body = view.querySelector('#my-characters-body');

  try {
    const sessions = State.sessions.length ? State.sessions : await api.getSessions();
    if (!State.sessions.length) State.sessions = sessions;

    const [domesticSheet, sessionSheets] = await Promise.all([
      api.getDomesticSheet(),
      Promise.all(sessions.map(async (session) => ({
        session,
        sheet: await api.getSheet(session.id, State.user.id)
      })))
    ]);

    const rows = sessionSheets
      .filter(({ session }) => !(domesticSheet && domesticSheet.session_id && session.id === domesticSheet.session_id))
      .filter(({ sheet }) => hasSheetData(sheet))
      .map(({ session, sheet }) => ({
        label: session.name,
        route: async () => {
          view.remove();
          if (!State.sessions.length) State.sessions = sessions;
          await openSession(session.id);
        },
        data: sheet.data
      }));

    if (hasSheetData(domesticSheet)) {
      rows.unshift({
        label: 'The Domestic',
        route: async () => {
          view.remove();
          await openDomestic();
        },
        data: domesticSheet.data
      });
    }

    if (!rows.length) {
      body.innerHTML = '<div class="empty" style="padding:1.5rem 0.5rem"><p>No stored characters yet.</p></div>';
      return;
    }

    body.innerHTML = `
      <div class="card gm-overview-pane">
        <div class="card-header">
          <div>
            <div class="card-title">Stored Characters</div>
            <div class="card-sub">Summarised for active play rather than full-sheet detail.</div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Session</th><th>Character</th><th>Condition</th><th>Resources</th><th>Notable skills</th><th>Weapons</th><th>Notes</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row, i) => {
                const d = row.data || {};
                return `<tr>
                  <td><strong>${esc(row.label)}</strong></td>
                  <td>${esc(d.name || '—')}</td>
                  <td>${esc(summarizeCondition(d))}</td>
                  <td>${esc(summarizeResources(d))}</td>
                  <td>${esc(summarizeNotableSkills(d))}</td>
                  <td>${esc(summarizeWeapons(d))}</td>
                  <td>${esc(summarizePlayNotes(d))}</td>
                  <td><button class="btn btn-sm" onclick="openStoredCharacter(${i})">Open</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    window.openStoredCharacter = async (index) => {
      const row = rows[index];
      if (!row) return;
      await row.route();
    };
  } catch (e) {
    body.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
  }
}
window.openMyCharacters = openMyCharacters;

// ── Case File tab ─────────────────────────────────────────────────────────────
async function loadSessionsTab(options = {}) {
  const { skipUrlUpdate = false, replaceUrl = false } = options;
  const tab = el('tab-sessions');
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading…</p>';
  State.currentSession = null;
  State.currentSheetUserId = null;
  if (!skipUrlUpdate) {
    updateUiStateInUrl({ tab: 'sessions', session: null, adventureStep: null }, replaceUrl);
  }
  State.sessions = await api.getSessions();

  const isGM = State.user.role === 'gm';
  tab.innerHTML = `
    <div class="page-header">
      <h2>Case Files</h2>
      ${isGM ? `<button class="btn btn-primary" onclick="openCreateSession()">+ New case file</button>` : ''}
    </div>
    <div id="sessions-alert"></div>
    <div class="session-grid">
      ${renderDomesticCard()}
      ${State.sessions.map(renderSessionCard).join('')}
    </div>
    ${State.sessions.length === 0
      ? `<p class="card-sub" style="margin-top:0.85rem">No GM case files yet${isGM ? ' — create one above' : ''}. The Domestic solo adventure is always available.</p>`
      : ''}`;
}

// The Domestic is a built-in solo case file, not a GM-created one, so it gets a
// fixed card at the front of the grid rather than coming from /sessions.
function renderDomesticCard() {
  return `<div class="card session-card domestic-card" onclick="openDomestic()">
    <div class="card-header">
      <div>
        <div class="card-title">The Domestic</div>
        <div class="card-sub">Solo adventure — play through the case and build your character as you go.</div>
      </div>
      <span class="badge-gm" style="background:var(--accent)">Solo</span>
    </div>
    <p class="player-count">📖 Step-by-step · autosaved progress</p>
  </div>`;
}

function renderSessionCard(s) {
  const isGM = State.user.role === 'gm';
  return `<div class="card session-card" onclick="openSession(${s.id})">
    <div class="card-header">
      <div>
        <div class="card-title">${esc(s.name)}</div>
        ${s.description ? `<div class="card-sub">${esc(s.description)}</div>` : ''}
      </div>
      ${isGM ? `<div style="display:flex;gap:0.5rem">
        <button class="btn btn-sm" onclick="event.stopPropagation();openEditSession(${s.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteSession(${s.id})">Delete</button>
      </div>` : ''}
    </div>
    ${isGM ? `<p class="player-count">👥 ${s.player_count || 0} player${s.player_count !== 1 ? 's' : ''}</p>` : ''}
  </div>`;
}

function openCreateSession() {
  const m = modal(`
    <h3>New case file</h3>
    <div id="modal-alert"></div>
    <div class="form-group"><label>Case file name</label><input type="text" id="m-sname" placeholder="e.g. Case 01 – The River Knows"></div>
    <div class="form-group"><label>Description (optional)</label><textarea id="m-sdesc" rows="2"></textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="createSession(this)">Create</button>
    </div>`);
}

async function createSession(btn) {
  const name = el('m-sname').value.trim();
  if (!name) return showAlert('Name required', 'danger', 'modal-alert');
  btn.disabled = true;
  try {
    await api.createSession({ name, description: el('m-sdesc').value.trim() });
    btn.closest('.modal-backdrop').remove();
    await loadSessionsTab();
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}

function openEditSession(sessionId) {
  const session = State.sessions.find(s => s.id === sessionId);
  if (!session) return;
  modal(`
    <h3>Edit case file</h3>
    <div id="modal-alert"></div>
    <div class="form-group"><label>Case file name</label><input type="text" id="m-sname" value="${esc(session.name)}"></div>
    <div class="form-group"><label>Description (optional)</label><textarea id="m-sdesc" rows="2">${esc(session.description || '')}</textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="updateSession(${sessionId},this)">Save changes</button>
    </div>`);
}

async function updateSession(sessionId, btn) {
  const name = el('m-sname').value.trim();
  if (!name) return showAlert('Name required', 'danger', 'modal-alert');
  btn.disabled = true;
  try {
    await api.updateSession(sessionId, { name, description: el('m-sdesc').value.trim() });
    btn.closest('.modal-backdrop').remove();
    await loadSessionsTab();
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}

async function deleteSession(id) {
  if (!confirm('Delete this case file and all its character sheets?')) return;
  try {
    await api.deleteSession(id);
    await loadSessionsTab();
  } catch (e) { showAlert(e.message, 'danger', 'sessions-alert'); }
}

// ── Session detail view ───────────────────────────────────────────────────────
function gmSelectedPlayerStorageKey(sessionId) {
  return `gm_selected_player_${State.user ? State.user.id : 'anon'}_${sessionId}`;
}

function readStoredGmPlayerId(sessionId) {
  try {
    const value = parseInt(sessionStorage.getItem(gmSelectedPlayerStorageKey(sessionId)), 10);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

function storeGmPlayerId(sessionId, userId) {
  try {
    if (!userId) sessionStorage.removeItem(gmSelectedPlayerStorageKey(sessionId));
    else sessionStorage.setItem(gmSelectedPlayerStorageKey(sessionId), String(userId));
  } catch {
    // Ignore storage failures; the UI still works without persistence.
  }
}

async function openSession(sessionId, options = {}) {
  const { replaceUrl = false } = options;
  const session = State.sessions.find(s => s.id === sessionId);
  if (!session) {
    await loadSessionsTab({ replaceUrl: true });
    return;
  }
  State.currentSession = sessionId;
  const isGM = State.user.role === 'gm';
  State.currentSessionPanel = isGM ? 'overview' : 'characters';
  const tab = el('tab-sessions');

  setActiveMainTab('sessions');

  updateUiStateInUrl({
    tab: 'sessions',
    session: sessionId,
    adventureStep: null
  }, replaceUrl);

  tab.innerHTML = `
    <div class="page-header">
      <div>
        <button class="btn btn-sm" onclick="loadSessionsTab()" style="margin-bottom:0.5rem">← Back</button>
        <h2>${esc(session.name)}</h2>
        ${session.description ? `<p style="color:var(--text2);font-size:0.88rem">${esc(session.description)}</p>` : ''}
      </div>
      ${isGM ? `<button class="btn btn-primary btn-sm" onclick="openAssignPlayer(${sessionId})">+ Assign player</button>` : ''}
    </div>
    <div id="session-alert"></div>
    <div class="sheet-tabs session-subtabs">
      ${isGM ? `<div class="sheet-tab active" data-session-panel="overview" onclick="switchSessionPanel(${sessionId}, 'overview')">Overview</div>` : ''}
      <div class="sheet-tab${isGM ? '' : ' active'}" data-session-panel="characters" onclick="switchSessionPanel(${sessionId}, 'characters')">Characters</div>
      <div class="sheet-tab" data-session-panel="case-info" onclick="switchSessionPanel(${sessionId}, 'case-info')">Case Info</div>
      <div class="sheet-tab" data-session-panel="player-info" onclick="switchSessionPanel(${sessionId}, 'player-info')">Player Info</div>
      <div class="sheet-tab" data-session-panel="entities" onclick="switchSessionPanel(${sessionId}, 'entities')">NPC/Places/Things</div>
      ${isGM ? `<div class="sheet-tab" data-session-panel="gm-info" onclick="switchSessionPanel(${sessionId}, 'gm-info')">GM Info</div>` : ''}
      ${isGM ? `<div class="sheet-tab" data-session-panel="raw-data" onclick="switchSessionPanel(${sessionId}, 'raw-data')">Edit Files</div>` : ''}
      ${isGM ? `<div class="sheet-tab" data-session-panel="npcs" onclick="switchSessionPanel(${sessionId}, 'npcs')">NPCs</div>` : ''}
      ${isGM ? `<div class="sheet-tab" data-session-panel="gm-chat" onclick="switchSessionPanel(${sessionId}, 'gm-chat')">GM Chat</div>` : ''}
    </div>
    <div id="session-content"><p style="color:var(--text2)">Loading…</p></div>`;

  if (isGM) await renderSessionOverview(sessionId);
  else await renderSessionCharacters(sessionId);
}

function setSessionPanelActive(panel) {
  document.querySelectorAll('[data-session-panel]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.sessionPanel === panel);
  });
}

async function switchSessionPanel(sessionId, panel) {
  State.currentSessionPanel = panel;
  setSessionPanelActive(panel);
  const content = el('session-content');
  if (content) content.innerHTML = '<p style="color:var(--text2)">Loading…</p>';
  if (panel === 'case-info') {
    await renderSessionCaseInfo(sessionId);
    return;
  }
  if (panel === 'player-info') {
    await renderSessionPlayerInfo(sessionId);
    return;
  }
  if (panel === 'entities') {
    await renderSessionEntities(sessionId);
    return;
  }
  if (panel === 'gm-info') {
    await renderSessionScenarioInfo(sessionId, 'gm');
    return;
  }
  if (panel === 'raw-data') {
    await renderSessionScenarioInfo(sessionId, 'raw');
    return;
  }
  if (panel === 'npcs') {
    await renderSessionNpcs(sessionId);
    return;
  }
  if (panel === 'overview') {
    await renderSessionOverview(sessionId);
    return;
  }
  if (panel === 'gm-chat') {
    await renderSessionGmChat(sessionId);
    return;
  }
  await renderSessionCharacters(sessionId);
}
window.switchSessionPanel = switchSessionPanel;

async function renderSessionCharacters(sessionId) {
  const isGM = State.user.role === 'gm';
  if (isGM) {
    await renderGMSessionView(sessionId, readStoredGmPlayerId(sessionId));
  } else {
    await renderPlayerSessionView(sessionId);
  }
}

// Shared overview table — identical columns for player characters and NPCs.
function renderOverviewTable(title, sub, rows, emptyText) {
  return `
    <div class="card gm-overview-pane">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(title)}</div>
          <div class="card-sub">${esc(sub)}</div>
        </div>
      </div>
      ${rows.length ? `<div class="table-wrap">
        <table>
          <thead>
            <tr><th>Player</th><th>Character</th><th>Luck</th><th>Condition</th><th>Resources</th><th>Notable skills</th><th>Weapons</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${rows.map((r) => {
              const d = r.d || {};
              return `<tr>
                <td><strong>${esc(r.col1 || '—')}</strong></td>
                <td>${esc(r.name || d.name || '—')}</td>
                <td>${esc(r.luck || (d.luck != null && String(d.luck).trim() !== '' ? String(d.luck) : '—'))}</td>
                <td>${r.wounds ? `<strong>${esc(r.wounds)}</strong> · ` : ''}${esc(summarizeCondition(d))}</td>
                <td>${esc(summarizeResources(d))}</td>
                <td>${esc(summarizeNotableSkills(d))}</td>
                <td>${esc(summarizeWeapons(d))}</td>
                <td>${esc(summarizePlayNotes(d))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty" style="padding:1rem"><p>${esc(emptyText)}</p></div>`}
    </div>`;
}

// ── GM brainstorming chat (per case, GM only, ephemeral in memory) ───────────
const gmChatState = {};
function gmChat(sessionId) {
  if (!gmChatState[sessionId]) gmChatState[sessionId] = { messages: [], streaming: false, controller: null, mode: 'text' };
  return gmChatState[sessionId];
}

function gmChatLogHtml(sessionId) {
  const st = gmChat(sessionId);
  if (!st.messages.length) {
    return '<div class="empty" style="padding:1.5rem"><p>Ask for plot ideas, NPC motives, the next beat, contingencies… This chat sees the full GM material for this case and is never shown to players.</p></div>';
  }
  return st.messages.map((m, i) => {
    const who = m.role === 'user' ? 'You' : 'Assistant';
    if (m.kind === 'image' && m.role === 'assistant') {
      let inner;
      if (m.editingPrompt) {
        inner = `<textarea id="gmimgedit-${i}" class="gmchat-edit" rows="3">${esc(m.prompt || '')}</textarea>
          <div class="gmchat-msg-actions">
            <button class="btn btn-sm btn-primary" onclick="gmImageEditApply(${sessionId}, ${i})">Regenerate</button>
            <button class="btn btn-sm" onclick="gmImageEditCancel(${sessionId}, ${i})">Cancel</button>
          </div>`;
      } else if (m.error) {
        inner = `<div class="gmchat-error">⚠ ${esc(m.error)}</div>`;
      } else if (m.imageUrl) {
        inner = `<img class="gmchat-image" src="${esc(m.imageUrl)}" alt="Generated handout">
          <div class="gmchat-image-actions">
            ${m.saved
              ? `<span class="gmchat-saved">✓ Saved to ${esc(m.saved)} (GM-only) — manage player access in Edit Files</span>`
              : `<button class="btn btn-sm" onclick="saveGmHandout(${sessionId}, ${i})">Save handout</button>`}
          </div>`;
      } else {
        inner = `<em style="color:var(--text2)">Generating image…<span class="gmchat-caret">▍</span></em>`;
      }
      const imgActions = (!st.streaming && !m.editingPrompt && (m.imageUrl || m.error))
        ? `<div class="gmchat-msg-actions">
            <button class="btn btn-sm" onclick="regenerateGmImage(${sessionId}, ${i})" title="Run this prompt again for a fresh image">↻ Regenerate</button>
            <button class="btn btn-sm" onclick="gmImageEditStart(${sessionId}, ${i})" title="Edit the prompt and regenerate">✎ Edit prompt</button>
          </div>`
        : '';
      return `<div class="gmchat-msg gmchat-assistant"><div class="gmchat-who">Image</div><div class="gmchat-body">${inner}</div>${imgActions}</div>`;
    }
    if (m.role === 'user' && m.editing) {
      return `<div class="gmchat-msg gmchat-user"><div class="gmchat-who">You</div>
        <div class="gmchat-body">
          <textarea id="gmedit-${i}" class="gmchat-edit" rows="3">${esc(m.content || '')}</textarea>
          <div class="gmchat-msg-actions">
            <button class="btn btn-sm btn-primary" onclick="gmEditResend(${sessionId}, ${i})">Resend</button>
            <button class="btn btn-sm" onclick="gmEditCancel(${sessionId}, ${i})">Cancel</button>
          </div>
        </div></div>`;
    }
    let body = esc(m.content || '') + (m.streaming ? '<span class="gmchat-caret">▍</span>' : '');
    if (m.kind === 'image' && m.role === 'user') body = `🖼 ${body}`;
    if (m.error) body += `<div class="gmchat-error">⚠ ${esc(m.error)}</div>`;
    let actions = '';
    if (!st.streaming && m.kind !== 'image') {
      if (m.role === 'user') {
        actions = `<div class="gmchat-msg-actions"><button class="btn btn-sm" onclick="gmEditPrompt(${sessionId}, ${i})" title="Edit this prompt and resend">✎ Edit</button></div>`;
      } else if (m.role === 'assistant' && (m.content || m.error)) {
        actions = `<div class="gmchat-msg-actions"><button class="btn btn-sm" onclick="regenerateGmAnswer(${sessionId}, ${i})" title="Run this prompt again for a fresh answer">↻ Regenerate</button></div>`;
      }
    }
    return `<div class="gmchat-msg gmchat-${m.role}"><div class="gmchat-who">${who}</div><div class="gmchat-body">${body || '<em style="color:var(--text2)">…</em>'}</div>${actions}</div>`;
  }).join('');
}

function renderGmChatLog(sessionId) {
  const log = el('gmchat-log');
  if (!log) return;
  log.innerHTML = gmChatLogHtml(sessionId);
  log.scrollTop = log.scrollHeight;
}

function setGmChatStreaming(on) {
  const send = el('gmchat-send');
  const stop = el('gmchat-stop');
  const text = el('gmchat-text');
  if (send) send.style.display = on ? 'none' : '';
  if (stop) stop.style.display = on ? '' : 'none';
  if (text) text.disabled = on;
}

async function renderSessionGmChat(sessionId) {
  const tab = el('session-content');
  if (!tab) return;
  const st = gmChat(sessionId);
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>GM Chat</h2>
        <p class="card-sub">Private brainstorming grounded in this case's GM material. Never shown to players; ephemeral (cleared on reload).</p>
      </div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-sm" onclick="exportGmChat(${sessionId}, this)">Save to GM notes</button>
        <button class="btn btn-sm" onclick="clearGmChat(${sessionId})">Clear</button>
      </div>
    </div>
    <div id="gmchat-alert"></div>
    <div class="gmchat-wrap">
      <div class="gmchat-log" id="gmchat-log"></div>
      <div class="gmchat-compose">
        <textarea id="gmchat-text" rows="3" placeholder="Ask for ideas, NPC motives, the next beat, a twist, contingencies…" onkeydown="gmChatKey(event, ${sessionId})"></textarea>
        <div class="gmchat-actions">
          <div class="gmchat-mode" role="group" aria-label="Chat mode">
            <button type="button" id="gmchat-mode-text" class="btn btn-sm" onclick="setGmChatMode(${sessionId}, 'text')">💬 Brainstorm</button>
            <button type="button" id="gmchat-mode-image" class="btn btn-sm" onclick="setGmChatMode(${sessionId}, 'image')">🖼 Image</button>
          </div>
          <span style="flex:1"></span>
          <button class="btn btn-primary" id="gmchat-send" onclick="sendGmChat(${sessionId})">Send</button>
          <button class="btn" id="gmchat-stop" onclick="stopGmChat(${sessionId})" style="display:none">Stop</button>
        </div>
      </div>
    </div>`;
  renderGmChatLog(sessionId);
  setGmChatStreaming(st.streaming);
  applyGmChatMode(sessionId);
}

function applyGmChatMode(sessionId) {
  const st = gmChat(sessionId);
  const image = st.mode === 'image';
  const tBtn = el('gmchat-mode-text');
  const iBtn = el('gmchat-mode-image');
  if (tBtn) tBtn.classList.toggle('active', !image);
  if (iBtn) iBtn.classList.toggle('active', image);
  const text = el('gmchat-text');
  if (text) text.placeholder = image
    ? 'Describe the handout/image to generate — a map, a note, a newspaper clipping, a photo…'
    : 'Ask for ideas, NPC motives, the next beat, a twist, contingencies…';
  const send = el('gmchat-send');
  if (send) send.textContent = image ? 'Generate' : 'Send';
}

function setGmChatMode(sessionId, mode) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  st.mode = mode === 'image' ? 'image' : 'text';
  applyGmChatMode(sessionId);
}
window.setGmChatMode = setGmChatMode;

function gmChatKey(ev, sessionId) {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    sendGmChat(sessionId);
  }
}
window.gmChatKey = gmChatKey;

async function sendGmChat(sessionId) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  const textEl = el('gmchat-text');
  const text = (textEl && textEl.value || '').trim();
  if (!text) return;
  if (st.mode === 'image') { gmChatGenerateImage(sessionId, text); return; }
  textEl.value = '';
  st.messages.push({ role: 'user', content: text });
  const reply = { role: 'assistant', content: '', streaming: true };
  st.messages.push(reply);
  renderGmChatLog(sessionId);
  await runGmStream(sessionId, reply);
}
window.sendGmChat = sendGmChat;

// Streams an assistant reply into `reply` (already the last message). Payload =
// every message before it, excluding image turns. Reused by send / regenerate
// / edit-and-resend.
async function runGmStream(sessionId, reply) {
  const st = gmChat(sessionId);
  const cut = st.messages.indexOf(reply);
  const payload = st.messages.slice(0, cut < 0 ? st.messages.length : cut)
    .filter((m) => m.kind !== 'image')
    .map(({ role, content }) => ({ role, content }));
  reply.content = '';
  reply.error = null;
  reply.streaming = true;
  st.controller = new AbortController();
  st.streaming = true;
  setGmChatStreaming(true);
  llmPendingBegin('GM Chat');
  renderGmChatLog(sessionId);
  try {
    const res = await fetch(`/api/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ messages: payload }),
      signal: st.controller.signal
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
      if (res.status === 404) msg = 'Chat endpoint not found (HTTP 404) — the server is running older code; restart it to pick up GM Chat.';
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = (line) => {
      const t = line.trim();
      if (!t) return;
      let obj;
      try { obj = JSON.parse(t); } catch { return; }
      if (obj.delta) { reply.content += obj.delta; renderGmChatLog(sessionId); }
      else if (obj.error) { reply.error = obj.error; }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    handle(buffer);
  } catch (e) {
    if (e.name === 'AbortError') reply.error = reply.content ? null : 'Stopped.';
    else reply.error = e.message || 'Chat failed';
  } finally {
    reply.streaming = false;
    // Keep a failed turn visible (persistent, in-context) instead of relying on
    // the auto-dismissing banner; only drop a truly empty, error-free reply.
    if (!reply.content && !reply.error) st.messages = st.messages.filter((m) => m !== reply);
    st.streaming = false;
    st.controller = null;
    setGmChatStreaming(false);
    llmPendingEnd();
    renderGmChatLog(sessionId);
  }
}

// Re-run the prompt that produced this answer for a fresh attempt. "Redo from
// here": drop this answer and anything after it, then re-stream.
function regenerateGmAnswer(sessionId, idx) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  const target = st.messages[idx];
  if (!target || target.role !== 'assistant' || target.kind === 'image') return;
  st.messages = st.messages.slice(0, idx);
  const reply = { role: 'assistant', content: '', streaming: true };
  st.messages.push(reply);
  renderGmChatLog(sessionId);
  runGmStream(sessionId, reply);
}
window.regenerateGmAnswer = regenerateGmAnswer;

function gmEditPrompt(sessionId, idx) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  const m = st.messages[idx];
  if (!m || m.role !== 'user' || m.kind === 'image') return;
  m.editing = true;
  renderGmChatLog(sessionId);
  const ta = document.getElementById(`gmedit-${idx}`);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
window.gmEditPrompt = gmEditPrompt;

function gmEditCancel(sessionId, idx) {
  const m = gmChat(sessionId).messages[idx];
  if (m) m.editing = false;
  renderGmChatLog(sessionId);
}
window.gmEditCancel = gmEditCancel;

// Save an edited prompt and re-run from it: truncate from idx, push the edited
// user turn + a fresh assistant reply, then stream.
function gmEditResend(sessionId, idx) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  const ta = document.getElementById(`gmedit-${idx}`);
  const m = st.messages[idx];
  if (!ta || !m) return;
  const newText = ta.value.trim();
  if (!newText) return;
  st.messages = st.messages.slice(0, idx);
  st.messages.push({ role: 'user', content: newText });
  const reply = { role: 'assistant', content: '', streaming: true };
  st.messages.push(reply);
  renderGmChatLog(sessionId);
  runGmStream(sessionId, reply);
}
window.gmEditResend = gmEditResend;

function stopGmChat(sessionId) {
  const st = gmChat(sessionId);
  if (st.controller) st.controller.abort();
}
window.stopGmChat = stopGmChat;

// GM-chat "Image" mode: free-text prompt → ComfyUI (reusing the generic
// /portrait history+view proxies) → inline preview → optional GM-only save.
async function gmChatGenerateImage(sessionId, prompt) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  const textEl = el('gmchat-text');
  if (textEl) textEl.value = '';
  st.messages.push({ role: 'user', content: prompt, kind: 'image' });
  const msg = { role: 'assistant', kind: 'image', prompt };
  st.messages.push(msg);
  await runImageGen(sessionId, msg);
}

// Runs ComfyUI generation for an existing assistant image `msg` using
// msg.prompt. Reused by first generation, Regenerate, and Edit-prompt.
async function runImageGen(sessionId, msg) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  msg.imageUrl = null;
  msg.error = null;
  msg.saved = null;
  msg.ref = null;
  msg.editingPrompt = false;
  st.streaming = true;
  setGmChatStreaming(true);
  llmPendingBegin('GM Chat image');
  renderGmChatLog(sessionId);
  try {
    const q = await api.generateHandout(sessionId, msg.prompt);
    if (q && q.node_errors && Object.keys(q.node_errors).length) {
      throw new Error('ComfyUI rejected the workflow — check the ComfyUI server.');
    }
    const promptId = q && q.prompt_id;
    if (!promptId) throw new Error('ComfyUI returned no prompt_id.');
    const started = Date.now();
    const timeoutMs = 10 * 60 * 1000;
    let entry = null;
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      const h = await fetch(`/api/portrait/history/${encodeURIComponent(promptId)}`, { credentials: 'same-origin' });
      if (h.ok) {
        const hJson = await h.json();
        const e = hJson[promptId];
        if (e && e.status && e.status.completed) { entry = e; break; }
        if (e && e.status && e.status.status_str === 'error') {
          throw new Error('ComfyUI reported an error generating the image.');
        }
      }
    }
    if (!entry) throw new Error('Timed out waiting for ComfyUI.');
    const outputs = entry.outputs || {};
    const node = outputs['10'] || Object.values(outputs).find((o) => o && o.images);
    if (!node || !node.images || !node.images.length) throw new Error('ComfyUI finished but returned no image.');
    const img = node.images[0];
    const params = new URLSearchParams();
    params.set('filename', img.filename);
    if (img.subfolder) params.set('subfolder', img.subfolder);
    params.set('type', img.type || 'output');
    const imgRes = await fetch(`/api/portrait/view?${params.toString()}`, { credentials: 'same-origin' });
    if (!imgRes.ok) throw new Error(`Fetching the image failed (HTTP ${imgRes.status}).`);
    const blob = await imgRes.blob();
    msg.imageUrl = URL.createObjectURL(blob);
    msg.ref = { filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' };
  } catch (e) {
    msg.error = e.message || 'Image generation failed';
  } finally {
    st.streaming = false;
    setGmChatStreaming(false);
    llmPendingEnd();
    renderGmChatLog(sessionId);
  }
}

async function saveGmHandout(sessionId, idx) {
  const st = gmChat(sessionId);
  const msg = st.messages[idx];
  if (!msg || !msg.ref || msg.saved) return;
  const name = prompt('Name this handout (used in the filename):', '');
  if (name === null) return;
  try {
    const r = await api.saveHandout(sessionId, { ...msg.ref, name, prompt: msg.prompt });
    msg.saved = r.file || 'GM handouts';
    renderGmChatLog(sessionId);
    showAlert(`Saved ${r.file} to the GM-only area — view it and toggle player access in Edit Files.`, 'success', 'gmchat-alert');
  } catch (e) {
    showAlert(e.message || 'Save failed', 'danger', 'gmchat-alert');
  }
}
window.saveGmHandout = saveGmHandout;

// Re-run the same image prompt for another attempt.
function regenerateGmImage(sessionId, idx) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  const msg = st.messages[idx];
  if (!msg || msg.role !== 'assistant' || msg.kind !== 'image') return;
  runImageGen(sessionId, msg);
}
window.regenerateGmImage = regenerateGmImage;

function gmImageEditStart(sessionId, idx) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  const msg = st.messages[idx];
  if (!msg || msg.kind !== 'image') return;
  msg.editingPrompt = true;
  renderGmChatLog(sessionId);
  const ta = document.getElementById(`gmimgedit-${idx}`);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
window.gmImageEditStart = gmImageEditStart;

function gmImageEditCancel(sessionId, idx) {
  const msg = gmChat(sessionId).messages[idx];
  if (msg) msg.editingPrompt = false;
  renderGmChatLog(sessionId);
}
window.gmImageEditCancel = gmImageEditCancel;

// Save the edited prompt and regenerate; mirror the new prompt onto the
// preceding user bubble so the log stays coherent.
function gmImageEditApply(sessionId, idx) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  const ta = document.getElementById(`gmimgedit-${idx}`);
  const msg = st.messages[idx];
  if (!ta || !msg) return;
  const next = ta.value.trim();
  if (!next) return;
  msg.prompt = next;
  const userMsg = st.messages[idx - 1];
  if (userMsg && userMsg.role === 'user' && userMsg.kind === 'image') userMsg.content = next;
  runImageGen(sessionId, msg);
}
window.gmImageEditApply = gmImageEditApply;

function clearGmChat(sessionId) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  if (!st.messages.length || confirm('Clear this chat?')) {
    st.messages = [];
    renderGmChatLog(sessionId);
  }
}
window.clearGmChat = clearGmChat;

async function exportGmChat(sessionId, btn) {
  const st = gmChat(sessionId);
  if (st.streaming) return showAlert('Wait for the reply to finish before saving.', 'danger', 'gmchat-alert');
  if (!st.messages.length) return showAlert('Nothing to save yet.', 'danger', 'gmchat-alert');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const r = await api.exportGmChat(sessionId, st.messages.filter((m) => m.kind !== 'image').map(({ role, content }) => ({ role, content })));
    showAlert(`Saved to ${r.path} — edit it in the Edit Files tab.`, 'success', 'gmchat-alert');
  } catch (e) {
    showAlert(e.message || 'Save failed', 'danger', 'gmchat-alert');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
window.exportGmChat = exportGmChat;

// ── Assigned rolls (per case) ────────────────────────────────────────────────
const ROLL_DIFF = { regular: 'Regular', hard: 'Hard', extreme: 'Extreme' };
const ROLL_MOD = { none: '', advantage: ' · advantage', disadvantage: ' · disadvantage' };
const ADV_MODE_LABEL = { simple: 'Simple (roll twice, take best/worst)', rol: 'RoL bonus/penalty die' };

function rollOutcomeHtml(r) {
  if (r.status === 'pending' && !r.awaiting_luck) return '<span class="roll-badge roll-pending">pending</span>';
  if (r.status === 'cancelled') return '<span class="roll-badge">cancelled</span>';
  const shown = r.awaiting_luck ? r.raw_result : r.result;
  if (r.outcome === 'unadjudicated') return `<span class="roll-badge">rolled ${shown}</span> <span class="card-sub">no target set — GM adjudicates</span>`;
  const cls = r.outcome === 'fumble' || r.passed === false ? 'roll-fail' : 'roll-pass';
  const pass = r.passed == null ? '' : (r.passed ? ' — PASS' : ' — FAIL');
  const luck = (!r.awaiting_luck && r.luck_spent) ? ` <span class="card-sub">(spent ${r.luck_spent} Luck; raw ${r.raw_result})${r.restored_at ? ' · loss restored' : ''}</span>` : '';
  return `<span class="roll-badge ${cls}">rolled ${shown} → ${esc(r.outcome)}${pass}</span>${luck}`;
}

// Compact roll list for the GM Session Overview (informational + management;
// the actual rolling happens from the Roll buttons on the sheet).
function rollHistoryHtml(sessionId, rolls) {
  const list = (rolls || []).filter((r) => r.status !== 'cancelled');
  const rowHtml = (r) => {
    const tgt = r.skill_value == null ? '' : ` [${r.skill_value}%]`;
    const head = `${esc(r.character_name)} — ${esc(r.skill_label)}${tgt} (${ROLL_DIFF[r.difficulty] || r.difficulty})${ROLL_MOD[r.modifier] || ''}`;
    const acts = [];
    if (r.status === 'pending') acts.push(`<button class="btn btn-sm btn-danger" onclick="cancelAssignedRoll(${sessionId}, ${r.id}, this)">Cancel</button>`);
    if (r.status === 'resolved' && r.luck_spent > 0 && !r.restored_at) acts.push(`<button class="btn btn-sm" onclick="restoreRollLuck(${sessionId}, ${r.id}, this)">Restore Luck</button>`);
    return `<div class="roll-line">
      <div><strong>${head}</strong><div class="card-sub">${rollOutcomeHtml(r)}${r.comment ? ` — “${esc(r.comment)}”` : ''}</div></div>
      ${acts.length ? `<div style="display:flex;gap:0.4rem;flex-wrap:wrap">${acts.join('')}</div>` : ''}
    </div>`;
  };
  const pending = list.filter((r) => r.status === 'pending');
  const done = list.filter((r) => r.status === 'resolved');
  return `
    <div class="card">
      <div class="card-title">Rolls</div>
      <div class="scenario-subtitle">Pending (${pending.length})</div>
      ${pending.length ? pending.map(rowHtml).join('') : '<p class="card-sub">None — request a roll via the Roll button on a character\'s skill.</p>'}
      <div class="scenario-subtitle" style="margin-top:0.75rem">History (${done.length})</div>
      ${done.length ? done.map(rowHtml).join('') : '<p class="card-sub">No resolved rolls yet.</p>'}
    </div>`;
}

const WOUND_KEYS = ['hurt', 'bloodied', 'down', 'impaired'];

function statLineHtml(sessionId, u, label, stat, cur, base, extra, adjArr) {
  const chips = (adjArr || []).map((a) => `<span class="luck-adj">${a.delta > 0 ? '+' : ''}${a.delta}${a.note ? ` (${esc(a.note)})` : ''} <button class="btn btn-sm" onclick="clearStatAdj(${sessionId}, ${a.id}, this)">clear</button></span>`).join(' ');
  return `<div class="state-line">
    <div class="state-head"><strong>${label}</strong> <span class="roll-badge">${cur}/${base}</span>${extra || ''}</div>
    ${chips ? `<div class="state-chips">${chips}</div>` : ''}
    <div class="luck-adj-form">
      <input type="number" id="adj-${stat}-${u}" placeholder="±${label}" style="width:5rem">
      <input type="text" id="adjn-${stat}-${u}" placeholder="note">
      <button class="btn btn-sm" onclick="addStatAdj(${sessionId}, ${u}, '${stat}', this)">Add</button>
    </div>
  </div>`;
}

function luckLedgerHtml(sessionId, ledger) {
  const list = (ledger || []).filter((l) => l);
  if (!list.length) return '';
  return `
    <div class="card">
      <div class="card-title">Conditions &amp; Current Stats</div>
      ${list.map((l) => {
        const u = l.user_id;
        const checks = WOUND_KEYS.map((w) => `<label class="wound-tog"><input type="checkbox" id="w-${u}-${w}"${l.wounds && l.wounds[w] ? ' checked' : ''} onchange="toggleWounds(${sessionId}, ${u})"> ${w[0].toUpperCase()}${w.slice(1)}</label>`).join('');
        return `<div class="state-card">
          <div class="state-name">${esc(l.character_name)}</div>
          ${statLineHtml(sessionId, u, 'HP', 'hp', l.hp.current, l.hp.base, '', l.adjustments.hp)}
          ${statLineHtml(sessionId, u, 'MP', 'mp', l.mp.current, l.mp.base, '', l.adjustments.mp)}
          ${statLineHtml(sessionId, u, 'Luck', 'luck', l.effective, l.base, l.spent ? ` <span class="card-sub">(−${l.spent} spent on rolls)</span>` : '', l.adjustments.luck)}
          <div class="state-wounds">Wounds: ${checks}</div>
        </div>`;
      }).join('')}
      <div class="card-sub" style="margin-top:0.4rem">Current = base/derived + GM modifiers (Luck also − roll spends). Modifiers persist until cleared. “Restore Luck” on a resolved roll below clears its spend.</div>
    </div>`;
}

async function toggleWounds(sessionId, userId) {
  const w = {};
  for (const k of WOUND_KEYS) { const c = el(`w-${userId}-${k}`); w[k] = !!(c && c.checked); }
  try {
    await api.setSessionWounds(sessionId, userId, w);
    await reloadCurrentSessionPanel();
  } catch (e) { showAlert(e.message, 'danger', 'session-alert'); }
}
window.toggleWounds = toggleWounds;

async function addStatAdj(sessionId, userId, stat, btn) {
  const delta = parseInt((el(`adj-${stat}-${userId}`) || {}).value, 10);
  const note = ((el(`adjn-${stat}-${userId}`) || {}).value || '').trim();
  if (!Number.isFinite(delta) || delta === 0) return showAlert(`Enter a non-zero ${stat.toUpperCase()} modifier (e.g. -3 or 2).`, 'danger', 'session-alert');
  btn.disabled = true;
  try {
    await api.addSessionStatAdjustment(sessionId, userId, stat, delta, note);
    await reloadCurrentSessionPanel();
  } catch (e) { showAlert(e.message, 'danger', 'session-alert'); btn.disabled = false; }
}
window.addStatAdj = addStatAdj;

async function clearStatAdj(sessionId, adjId, btn) {
  btn.disabled = true;
  try {
    await api.clearSessionStatAdjustment(sessionId, adjId);
    await reloadCurrentSessionPanel();
  } catch (e) { showAlert(e.message, 'danger', 'session-alert'); btn.disabled = false; }
}
window.clearStatAdj = clearStatAdj;

// ── Per-skill Roll buttons on the character sheet ────────────────────────────
let skillRollCtx = null;
function normSkill(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

// Build the roll context for a player's case sheet: who, and which skills the
// GM currently has a pending request against (so we can highlight them).
async function buildSkillRollCtx(sessionId, userId, isGM) {
  const pending = {};
  let state = null;
  try {
    const d = await api.getSessionRolls(sessionId);
    ((d && d.rolls) || []).forEach((r) => {
      if (r.user_id === userId && r.status === 'pending') pending[normSkill(r.skill_label)] = r;
    });
    state = ((d && d.luck) || []).find((l) => l.user_id === userId) || null;
  } catch { /* a rolls fetch failure must not break the sheet */ }
  return { sessionId, userId, isGM, pending, state };
}

function makeRollButton(ctx, name, value) {
  const b = document.createElement('button');
  b.type = 'button';
  const pend = ctx.pending[normSkill(name)];
  b.className = `sheet-roll-btn${pend ? ' roll-needed' : ''}`;
  b.textContent = pend && !ctx.isGM ? 'Roll ●' : 'Roll';
  b.title = pend
    ? (ctx.isGM ? `Requested: ${name} (${pend.difficulty})` : 'The GM has asked for this roll')
    : (ctx.isGM ? `Request a ${name} roll` : `Make a ${name} roll`);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSkillRollModal(ctx, name, value(), ctx.pending[normSkill(name)] || null);
  });
  return b;
}

// Append a Roll button to each skill / characteristic row. Idempotent.
function attachSkillRollButtons(host, ctx) {
  if (!host || !ctx) return;
  skillRollCtx = ctx;
  const add = (row, name, valEl) => {
    if (!row || !name || !String(name).trim()) return;
    if (row.querySelector(':scope > .sheet-roll-btn')) return;
    row.classList.add('with-roll'); // CSS extends the row's grid to keep it inline
    row.appendChild(makeRollButton(ctx, String(name).trim(), () => (valEl ? valEl.value : '')));
  };
  host.querySelectorAll('#common-skills .csk-row').forEach((r) => add(r, r.dataset.name, r.querySelector('.csk-val')));
  host.querySelectorAll('#combat-skills .combat-skill-row').forEach((r) => add(r, (r.querySelector('input[readonly]') || {}).value, r.querySelector('.combat-skill-full')));
  host.querySelectorAll('#mandatory-skills .skill-row').forEach((r) => add(r, (r.querySelector('.msk-name') || {}).value, r.querySelector('.msk-val')));
  host.querySelectorAll('#additional-skills .skill-row').forEach((r) => add(r, (r.querySelector('.ask-name') || {}).value, r.querySelector('.ask-val')));
  ['str', 'con', 'dex', 'int', 'pow', 'siz'].forEach((k) => {
    const inp = host.querySelector(`#sf_${k}`);
    if (inp && inp.parentElement && !inp.parentElement.querySelector(':scope > .sheet-roll-btn')) {
      inp.parentElement.classList.add('with-roll');
      if (inp.parentElement.parentElement) inp.parentElement.parentElement.classList.add('with-roll-grid');
      inp.parentElement.appendChild(makeRollButton(ctx, k.toUpperCase(), () => inp.value));
    }
  });

  // Derived stats: title + value (+ Roll for SAN/Luck) all inline, like the
  // base-stats block. No per-field badge — current values get their own row.
  [['#sf_derived_hp'], ['#sf_derived_san', 'SAN'], ['#sf_derived_mp'], ['#sf_derived_build'], ['#sf_derived_move'], ['#sf_derived_luck', 'Luck']]
    .forEach(([id, rollName]) => {
      const inp = host.querySelector(id);
      const cell = inp && inp.closest('.form-group');
      if (!cell) return;
      cell.classList.add('with-roll');
      if (rollName && !cell.querySelector(':scope > .sheet-roll-btn')) {
        cell.appendChild(makeRollButton(ctx, rollName, () => inp.value));
      }
    });

  // Current HP / MP / Luck — its own 3-column row, each with a Roll button.
  const st = ctx.state;
  const grid = host.querySelector('.derived-grid');
  if (st && grid && !host.querySelector('.current-row')) {
    const wrap = document.createElement('div');
    wrap.className = 'current-row';
    const cell = (label, name, cur, base, rollable) => {
      const d = document.createElement('div');
      d.className = 'current-cell';
      d.innerHTML = `<div class="current-label">${label}</div><div class="current-val">${cur}</div>`;
      if (rollable) d.appendChild(makeRollButton(ctx, name, () => String(cur)));
      return d;
    };
    wrap.appendChild(cell('Current HP', 'HP', st.hp.current, st.hp.base, false));
    wrap.appendChild(cell('Current MP', 'MP', st.mp.current, st.mp.base, false));
    wrap.appendChild(cell('Current Luck', 'Luck', st.effective, st.base, true));
    grid.insertAdjacentElement('afterend', wrap);
  }
}

// Stateful popup: GM requests a roll; a player resolves a request or makes an
// unprompted roll (roll → optional Luck → confirm).
function openSkillRollModal(ctx, skill, value, pending) {
  const bd = modal('<div id="srm"></div>', (root) => {
    const m = root.querySelector('.modal');
    if (m) m.style.maxWidth = '460px';
  });
  const body = bd.querySelector('#srm');
  const close = () => bd.remove();
  const done = async () => { close(); await reloadCurrentSessionPanel(); };
  const diffSel = '<select id="srm-diff"><option value="regular">Regular</option><option value="hard">Hard</option><option value="extreme">Extreme</option></select>';
  const modSel = '<select id="srm-mod"><option value="none">No modifier</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option></select>';
  const titleTgt = value ? ` <span class="card-sub">[${esc(String(value))}%]</span>` : '';

  function gmView() {
    if (pending) {
      body.innerHTML = `<h3>${esc(skill)} — requested</h3>
        <p class="card-sub">${ROLL_DIFF[pending.difficulty]}${ROLL_MOD[pending.modifier] || ''}${pending.comment ? ` — “${esc(pending.comment)}”` : ''} · status: ${esc(pending.status)}</p>
        <div class="modal-actions"><button class="btn btn-danger" id="srm-cancel">Cancel request</button><button class="btn" id="srm-x">Close</button></div>`;
      body.querySelector('#srm-x').onclick = close;
      body.querySelector('#srm-cancel').onclick = async () => {
        try { await api.cancelSessionRoll(ctx.sessionId, pending.id); await done(); } catch (e) { alert(e.message); }
      };
      return;
    }
    body.innerHTML = `<h3>Request roll — ${esc(skill)}${titleTgt}</h3>
      <div class="form-group"><label>Difficulty</label>${diffSel}</div>
      <div class="form-group"><label>Modifier</label>${modSel}</div>
      <div class="form-group"><label>Comment (shown to the player)</label><input type="text" id="srm-comment"></div>
      <div class="modal-actions"><button class="btn" id="srm-x">Cancel</button><button class="btn btn-primary" id="srm-go">Request</button></div>`;
    body.querySelector('#srm-x').onclick = close;
    body.querySelector('#srm-go').onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        await api.createSessionRoll(ctx.sessionId, {
          user_id: ctx.userId, skill_label: skill, skill_value: value,
          difficulty: body.querySelector('#srm-diff').value,
          modifier: body.querySelector('#srm-mod').value,
          comment: body.querySelector('#srm-comment').value.trim()
        });
        await done();
      } catch (e) { ev.target.disabled = false; alert(e.message); }
    };
  }

  function showResult(r) {
    const cap = r.luck_cap || 0;
    body.innerHTML = `<h3>${esc(skill)}</h3>
      <div class="srm-result">${rollOutcomeHtml(r)}</div>
      ${r.awaiting_luck && cap > 0
        ? `<div class="form-group"><label>Spend Luck (0–${cap}, ${r.luck_available} available)</label><input type="number" id="srm-luck" value="0" min="0" max="${cap}"></div>`
        : (r.awaiting_luck ? `<p class="card-sub">No Luck can change this${r.outcome === 'fumble' ? ' (fumble)' : ''}.</p>` : '')}
      <div class="modal-actions">${r.awaiting_luck
        ? '<button class="btn btn-primary" id="srm-confirm">Confirm</button>'
        : '<button class="btn btn-primary" id="srm-done">Done</button>'}</div>`;
    if (r.awaiting_luck) {
      body.querySelector('#srm-confirm').onclick = async (ev) => {
        ev.target.disabled = true;
        const li = body.querySelector('#srm-luck');
        let lk = li ? parseInt(li.value, 10) : 0;
        if (!Number.isFinite(lk) || lk < 0) lk = 0;
        try { showResult(await api.finalizeSessionRoll(ctx.sessionId, r.id, lk)); } catch (e) { ev.target.disabled = false; alert(e.message); }
      };
    } else {
      body.querySelector('#srm-done').onclick = done;
    }
  }

  function playerView() {
    if (pending) {
      body.innerHTML = `<h3>${esc(skill)} — GM request</h3>
        <p class="card-sub">${ROLL_DIFF[pending.difficulty]}${ROLL_MOD[pending.modifier] || ''}${pending.comment ? ` — “${esc(pending.comment)}”` : ''}</p>
        <div class="modal-actions"><button class="btn" id="srm-x">Later</button><button class="btn btn-primary" id="srm-roll">Roll</button></div>`;
      body.querySelector('#srm-x').onclick = close;
      body.querySelector('#srm-roll').onclick = async (ev) => {
        ev.target.disabled = true;
        try { showResult(await api.resolveSessionRoll(ctx.sessionId, pending.id)); } catch (e) { ev.target.disabled = false; alert(e.message); }
      };
      return;
    }
    body.innerHTML = `<h3>Roll ${esc(skill)}${titleTgt}</h3>
      <div class="form-group"><label>Difficulty</label>${diffSel}</div>
      <div class="form-group"><label>Modifier</label>${modSel}</div>
      <div class="modal-actions"><button class="btn" id="srm-x">Cancel</button><button class="btn btn-primary" id="srm-roll">Roll</button></div>`;
    body.querySelector('#srm-x').onclick = close;
    body.querySelector('#srm-roll').onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        const created = await api.createSelfRoll(ctx.sessionId, {
          skill_label: skill, skill_value: value,
          difficulty: body.querySelector('#srm-diff').value,
          modifier: body.querySelector('#srm-mod').value
        });
        showResult(await api.resolveSessionRoll(ctx.sessionId, created.id));
      } catch (e) { ev.target.disabled = false; alert(e.message); }
    };
  }

  if (ctx.isGM) gmView();
  else playerView();
}

async function restoreRollLuck(sessionId, rollId, btn) {
  if (!confirm('Restore (clear) this Luck loss? It will stop counting against the character this session.')) return;
  btn.disabled = true;
  try {
    await api.restoreSessionRollLuck(sessionId, rollId);
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message, 'danger', 'rolls-alert');
    btn.disabled = false;
  }
}
window.restoreRollLuck = restoreRollLuck;

async function cancelAssignedRoll(sessionId, rollId, btn) {
  if (!confirm('Cancel this assigned roll?')) return;
  btn.disabled = true;
  try {
    await api.cancelSessionRoll(sessionId, rollId);
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message, 'danger', 'rolls-alert');
    btn.disabled = false;
  }
}
window.cancelAssignedRoll = cancelAssignedRoll;

async function renderSessionOverview(sessionId) {
  const content = el('session-content');
  if (!content) return;
  content.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading overview…</p>';
  let players;
  let sheets;
  let npcs;
  let rollsData = {};
  try {
    [players, sheets, npcs, rollsData] = await Promise.all([
      api.getSessionPlayers(sessionId),
      api.getSheets(sessionId),
      api.getNpcs(sessionId),
      api.getSessionRolls(sessionId).catch(() => ({}))
    ]);
  } catch (e) {
    content.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const sheetMap = {};
  sheets.forEach((s) => { sheetMap[s.user_id] = s; });
  const luckByUser = {};
  ((rollsData && rollsData.luck) || []).forEach((l) => { luckByUser[l.user_id] = l; });
  const playerRows = players.map((p) => {
    const l = luckByUser[p.id];
    const wlabels = l && l.wounds ? WOUND_KEYS.filter((w) => l.wounds[w]).map((w) => w[0].toUpperCase() + w.slice(1)) : [];
    return {
      col1: p.username,
      name: (sheetMap[p.id] && sheetMap[p.id].data && sheetMap[p.id].data.name) || '—',
      luck: l ? `${l.effective} eff${l.spent ? ` (−${l.spent} of ${l.base})` : ''}` : null,
      wounds: wlabels.join(', '),
      d: (sheetMap[p.id] && sheetMap[p.id].data) || {}
    };
  });
  const npcRows = npcs.map((n) => ({
    col1: (n.sheet && n.sheet.occupation) || n.role || 'NPC',
    name: n.name,
    d: n.sheet || {}
  }));
  content.innerHTML = `
    <div class="page-header">
      <div>
        <h2>Session Overview</h2>
        <p class="card-sub">At-a-glance condition, resources, notable skills, and combat notes for everyone in this case.</p>
      </div>
    </div>
    <div id="session-alert"></div>
    ${renderOverviewTable('Player Characters', 'Assigned players in this case.', playerRows, 'No players assigned to this case yet.')}
    ${renderOverviewTable('NPCs', 'NPCs allocated to this case.', npcRows, 'No NPCs allocated to this case yet.')}
    ${luckLedgerHtml(sessionId, (rollsData && rollsData.luck) || [])}
    ${rollHistoryHtml(sessionId, (rollsData && rollsData.rolls) || [])}`;
}

async function renderGMSessionView(sessionId, preferredUserId = null) {
  const [players, sheets, settings] = await Promise.all([
    api.getSessionPlayers(sessionId),
    api.getSheets(sessionId),
    api.getSessionSettings(sessionId).catch(() => ({ ruleset: 'rol' }))
  ]);
  const sessionRuleset = (settings && settings.ruleset) || 'rol';

  const content = el('session-content');
  if (players.length === 0) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">👥</div><p>No players assigned to this session yet.</p></div>`;
    return;
  }

  const sheetMap = {};
  sheets.forEach(s => { sheetMap[s.user_id] = s; });
  window.gmSheetMap = sheetMap;

  content.innerHTML = `
    <div style="margin-bottom:1rem">
      <div class="sheet-tabs" id="gm-sheet-tabs">
        ${players.map((p, i) => `
          <div class="sheet-tab${i===0?' active':''}" onclick="gmSelectSheet(${p.id},'${esc(p.username)}')" id="stab_${p.id}">
            ${esc(p.username)}
            ${!sheetMap[p.id] ? ' <span style="opacity:0.5;font-size:0.75rem">(empty)</span>' : ''}
          </div>`).join('')}
      </div>
    </div>
    <div style="margin-bottom:1rem;display:flex;gap:0.75rem;align-items:center">
      <span id="gm-viewing-label" style="color:var(--text2);font-size:0.88rem"></span>
      <button class="btn btn-sm" onclick="removePlayerFromSession(${sessionId}, gmCurrentPlayerId)">Remove from session</button>
    </div>
    <div id="gm-sheet-area"></div>`;

  // Show first player
  if (players.length > 0) {
    const preferredPlayer = players.find((p) => p.id === preferredUserId) || players[0];
    window.gmCurrentPlayerId = preferredPlayer.id;
    gmSelectSheet(preferredPlayer.id, preferredPlayer.username);
  }

  async function gmSelectSheet(userId, username) {
    window.gmCurrentPlayerId = userId;
    State.currentSheetUserId = userId;
    storeGmPlayerId(sessionId, userId);
    document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
    const tab = el(`stab_${userId}`);
    if (tab) tab.classList.add('active');
    el('gm-viewing-label').textContent = `Viewing: ${username}`;
    const area = el('gm-sheet-area');
    area.innerHTML = '<p style="color:var(--text2)">Loading sheet…</p>';
    const sheet = sheetMap[userId];
    area.innerHTML = '';
    SheetForm.setRuleset((sheet && sheet.ruleset) || sessionRuleset);
    SheetForm.render(area, sheet ? sheet.data : {}, false);
    area.insertAdjacentHTML('beforeend', `
      <div class="sheet-actions">
      <button class="btn btn-primary" onclick="gmSaveSheet(${sessionId},${userId})">Save sheet</button>
      <button class="btn" onclick="exportPdf()">Export PDF</button>
      <span class="save-status" id="save-status"></span>
    </div>`);
    try { attachSkillRollButtons(area, await buildSkillRollCtx(sessionId, userId, true)); } catch (e) { /* non-fatal */ }
  }
  window.gmSelectSheet = gmSelectSheet;
}

async function renderPlayerSessionView(sessionId) {
  const content = el('session-content');
  const sheet = await api.getSheet(sessionId, State.user.id);
  const hasSheet = sheet && sheet.data && Object.keys(sheet.data).length > 0;

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <p style="color:var(--text2);font-size:0.88rem">${hasSheet ? 'Your character sheet for this session:' : 'No character sheet yet — fill yours in below.'}</p>
    </div>
    <div id="sheet-form-area"></div>
    <div class="sheet-actions">
      <button class="btn btn-primary" onclick="saveSheet(${sessionId})">Save sheet</button>
      <button class="btn" onclick="exportPdf()">Export PDF</button>
      <span class="save-status" id="save-status"></span>
    </div>`;

  SheetForm.setRuleset((sheet && sheet.ruleset) || 'rol');
  SheetForm.render(el('sheet-form-area'), hasSheet ? sheet.data : {}, false);
  try { attachSkillRollButtons(el('sheet-form-area'), await buildSkillRollCtx(sessionId, State.user.id, false)); } catch (e) { /* non-fatal */ }
}

async function saveSheet(sessionId) {
  const status = el('save-status');
  status.textContent = 'Saving…';
  status.className = 'save-status';
  try {
    const data = SheetForm.collect();
    await api.saveSheet(sessionId, State.user.id, data);
    status.textContent = '✓ Saved';
    status.className = 'save-status saved';
  } catch (e) {
    status.textContent = '✕ ' + e.message;
    status.className = 'save-status error';
  }
}
window.saveSheet = saveSheet;

async function exportPdf() {
  try {
    const data = SheetForm.collect();
    const res = await fetch('/api/sheet/render-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ data })
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const slug = (String(data.name || 'character')
      .replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')) || 'character';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  } catch (e) {
    alert("Export failed: " + e.message);
  }
}
window.exportPdf = exportPdf;

async function removePlayerFromSession(sessionId, userId) {
  if (!confirm('Remove this player from the session? Their character sheet will also be deleted.')) return;
  try {
    await api.removePlayer(sessionId, userId);
    await openSession(sessionId);
  } catch (e) { showAlert(e.message, 'danger', 'session-alert'); }
}
window.removePlayerFromSession = removePlayerFromSession;

function openAssignPlayer(sessionId) {
  openAssignPlayerModal(sessionId).catch((e) => {
    showAlert(e.message, 'danger', 'session-alert');
  });
}
window.openAssignPlayer = openAssignPlayer;

async function openAssignPlayerModal(sessionId) {
  State.users = await api.getUsers();
  const players = State.users.filter(u => u.role === 'player');
  if (players.length === 0) {
    alert('No player accounts exist yet. Create player accounts in the Accounts tab first.');
    return;
  }
  modal(`
    <h3>Assign player to session</h3>
    <div id="modal-alert"></div>
    <div class="form-group">
      <label>Player account</label>
      <select id="m-player-sel">
        ${players.map(p => `<option value="${p.id}">${esc(p.username)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="assignPlayer(${sessionId},this)">Assign</button>
    </div>`);
}

async function assignPlayer(sessionId, btn) {
  const userId = el('m-player-sel').value;
  btn.disabled = true;
  try {
    await api.addPlayer(sessionId, userId);
    btn.closest('.modal-backdrop').remove();
    await openSession(sessionId);
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.assignPlayer = assignPlayer;

// ── Scenario information tab ─────────────────────────────────────────────────
function scenarioArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== '');
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function scenarioText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(scenarioText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return scenarioText(value.content || value.description || value.body || value.details
      || value.summary || value.text || value.analysis || value.story || JSON.stringify(value));
  }
  return String(value);
}

let _richSeq = 0;
function looksMarkdown(s) {
  return /(^|\n)\s{0,3}#{1,4}\s|\*\*[^*\n]+\*\*|(^|\n)\s*[-*+]\s+|(^|\n)\s*>\s+|`[^`]+`/.test(s);
}
function stripPara(html) {
  return String(html).replace(/^\s*<p>/, '').replace(/<\/p>\s*$/, '');
}
// Renders a value as prose. Strings with Markdown get the rich renderer
// (headings/bold/lists) so record cards read like the "what has happened" page.
function renderRichText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (!items.length) return '';
    return `<ul class="scenario-list">${items.map((v) => `<li>${stripPara(renderRichText(v))}</li>`).join('')}</ul>`;
  }
  if (typeof value === 'object') {
    const inner = value.content || value.description || value.body || value.summary
      || value.details || value.text || value.analysis || value.story;
    return inner ? renderRichText(inner) : renderScenarioText(value);
  }
  const s = String(value).trim();
  if (!s) return '';
  if (looksMarkdown(s)) {
    _richSeq += 1;
    return `<div class="summary-content">${markdownToHtml(s, `e${_richSeq}`).html}</div>`;
  }
  return renderScenarioText(s);
}

function renderScenarioText(value) {
  const text = scenarioText(value).trim();
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${esc(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function scenarioAssetUrl(filePath, sessionId = State.currentSession) {
  const clean = String(filePath || '').replace(/^\/+/, '');
  return `/api/sessions/${encodeURIComponent(sessionId)}/scenario-info/assets/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

// In-scope images for the scenario being rendered, keyed by lowercased
// basename → repo path. Set from the (visibility-scoped) source_files in the
// scenario-info payload; the Markdown renderer only renders refs found here, so
// hallucinated or out-of-scope filenames are silently dropped.
let scenarioImageMap = {};
function setScenarioImages(sourceFiles) {
  const m = {};
  (sourceFiles || []).forEach((f) => {
    if (f && f.kind === 'graphic' && f.path) m[String(f.path).split('/').pop().toLowerCase()] = f.path;
  });
  scenarioImageMap = m;
}

function renderScenarioMedia(media) {
  const items = scenarioArray(media);
  if (!items.length) return '';
  return `<div class="scenario-media-grid">${items.map((item) => {
    const path = typeof item === 'string' ? item : item.path;
    if (!path) return '';
    const caption = typeof item === 'object' ? item.caption : '';
    const lower = path.toLowerCase();
    const url = scenarioAssetUrl(path);
    if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) {
      return `<figure><img src="${esc(url)}" alt="${esc(caption || path)}">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
    }
    return `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">${esc(caption || path)}</a>`;
  }).join('')}</div>`;
}

function renderScenarioTags(items) {
  const values = scenarioArray(items);
  if (!values.length) return '';
  return `<div class="tag-list">${values.map((item) => `<span>${esc(scenarioText(item))}</span>`).join('')}</div>`;
}

function renderScenarioSources(sources) {
  const entries = scenarioArray(sources);
  if (!entries.length) return '';
  return `<div class="scenario-sources">${entries.map((source) => {
    const path = typeof source === 'string' ? source : source.path;
    const note = typeof source === 'object' ? source.note || source.line || '' : '';
    return path ? `<span>${esc(path)}${note ? ` ${esc(note)}` : ''}</span>` : '';
  }).join('')}</div>`;
}

function renderScenarioSectionActions(sectionId) {
  if (!sectionId || State.user.role !== 'gm') return '';
  return `
    <div class="scenario-section-actions">
      <button class="btn btn-sm js-regen" onclick="regenerateScenarioSection('${esc(sectionId)}', this)">Regenerate</button>
      <button class="btn btn-sm" onclick="revertScenarioSection('${esc(sectionId)}', this)">Revert</button>
    </div>`;
}

function renderScenarioEntry(entry, fallbackTitle = 'Entry') {
  const data = entry && typeof entry === 'object' ? entry : { body: entry };
  const title = data.name || data.title || data.character || data.deliverable || fallbackTitle;
  const meta = [
    data.character && data.title ? `Character: ${data.character}` : '',
    data.player ? `Player: ${data.player}` : '',
    data.priority ? `Priority: ${data.priority}` : '',
    data.spotlight ? `Spotlight: ${data.spotlight}` : '',
    data.engagement ? `Engagement: ${data.engagement}` : '',
    data.timing ? `Timing: ${data.timing}` : '',
    data.role,
    data.status,
    data.location,
    data.owner ? `Owner: ${data.owner}` : '',
    data.session
  ].filter(Boolean);

  // Main narrative — accept whatever field the model used, render Markdown richly.
  const bodyKeys = ['content', 'description', 'summary', 'analysis', 'story', 'narrative', 'details', 'body', 'text', 'notes'];
  let bodyKey = bodyKeys.find((k) => data[k] != null && String(data[k]).trim() !== '');
  const bodyHtml = bodyKey ? renderRichText(data[bodyKey]) : '';

  // Everything else meaningful, surfaced as labelled prose/lists (not just tag
  // chips) — this is what makes GM Info readable rather than a wall of tags.
  const used = new Set([...bodyKeys, 'name', 'title', 'character', 'player', 'priority', 'spotlight',
    'engagement', 'timing', 'role', 'status', 'location', 'owner', 'session', 'id',
    'known_by', 'visible_to', 'access', 'gm_only', 'gmOnly', 'media', 'sources', 'presentation']);
  if (bodyKey) used.add(bodyKey);
  const labelFor = (k) => k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const blocks = [];
  for (const [key, value] of Object.entries(data)) {
    if (used.has(key)) continue;
    if (value == null || (Array.isArray(value) && !value.length) || String(value).trim() === '') continue;
    const html = renderRichText(value);
    if (html) blocks.push(`<div class="scenario-subtitle">${esc(labelFor(key))}</div>${html}`);
  }

  return `
    <div class="card scenario-entry-card">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(title)}</div>
          ${meta.length ? `<div class="card-sub">${esc(meta.join(' | '))}</div>` : ''}
        </div>
      </div>
      ${bodyHtml ? `<div class="scenario-body">${bodyHtml}</div>` : ''}
      ${blocks.join('')}
      ${renderScenarioMedia(data.media)}
      ${renderScenarioSources(data.sources)}
    </div>`;
}

function renderScenarioSection(title, entries, emptyText, sectionId = '') {
  const list = scenarioArray(entries);
  return `
    <section class="scenario-section">
      <div class="scenario-section-header">
        <h3>${esc(title)}</h3>
        ${renderScenarioSectionActions(sectionId)}
      </div>
      ${list.length
        ? `<div class="scenario-grid">${list.map((entry) => renderScenarioEntry(entry, title)).join('')}</div>`
        : `<div class="empty scenario-empty"><p>${esc(emptyText)}</p></div>`}
    </section>`;
}

// GM-only page-level regenerate button. `sectionsCsv` lists the section ids the
// page shows; an empty string means "all sections" (the bulk path).
function scenarioPageButton(sectionsCsv, label) {
  if (State.user.role !== 'gm') return '';
  return `<button class="btn btn-primary js-regen" onclick="regenerateScenarioPage(this, '${esc(sectionsCsv || '')}', '${esc(label)}')">${esc(label)}</button>`;
}

// ── Lightweight, safe Markdown → HTML ────────────────────────────────────────
// The LLM returns Markdown for the case/session prose. We never inject raw model
// HTML: every line is HTML-escaped first, then only our own tags are introduced,
// so this is XSS-safe by construction.
function mdSlug(text, used) {
  let base = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'sec';
  let s = base;
  let n = 2;
  while (used[s]) { s = `${base}-${n}`; n += 1; }
  used[s] = true;
  return s;
}

function mdInline(s) {
  return String(s)
    // Standalone images are handled line-by-line; strip any the model inlined
    // so raw ![..](..) never leaks into prose.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
}

function markdownToHtml(md, anchorPrefix) {
  const used = {};
  const headings = [];
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let inList = false;
  let inQuote = false;
  const flushPara = () => { if (para.length) { out.push(`<p>${mdInline(esc(para.join(' ')))}</p>`); para = []; } };
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) { flushPara(); closeList(); closeQuote(); continue; }

    const h = trimmed.match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      flushPara(); closeList(); closeQuote();
      const level = h[1].length;
      const text = h[2].replace(/#+\s*$/, '').trim();
      const id = `${anchorPrefix}-${mdSlug(text, used)}`;
      headings.push({ id, text, level });
      const tag = level === 2 ? 'h4' : (level === 3 ? 'h5' : 'h6');
      out.push(`<${tag} id="${esc(id)}" class="summary-h summary-h${level}">${mdInline(esc(text))}</${tag}>`);
      continue;
    }

    const imageLine = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (imageLine) {
      flushPara(); closeList(); closeQuote();
      const cap = imageLine[1].trim();
      const base = String(imageLine[2]).split('/').pop().toLowerCase();
      const repoPath = scenarioImageMap[base];
      if (repoPath) {
        out.push(`<figure class="scenario-figure"><img src="${esc(scenarioAssetUrl(repoPath))}" alt="${esc(cap || base)}" loading="lazy">${cap ? `<figcaption>${mdInline(esc(cap))}</figcaption>` : ''}</figure>`);
      }
      // Unknown / out-of-scope filename → silently dropped.
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      flushPara(); closeQuote();
      if (!inList) { out.push('<ul class="summary-points">'); inList = true; }
      out.push(`<li>${mdInline(esc(bullet[1].trim()))}</li>`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushPara(); closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`${mdInline(esc(quote[1].trim()))} `);
      continue;
    }

    closeList(); closeQuote();
    para.push(trimmed);
  }
  flushPara(); closeList(); closeQuote();
  return { html: out.join('\n'), headings };
}

function renderSummaryIndex(headings) {
  const items = (headings || []).filter((h) => h.level <= 3);
  if (items.length < 2) return '';
  return `<nav class="case-index" aria-label="Contents">
      <div class="case-index-title">Index</div>
      <ul>${items.map((h) => `<li class="ci-l${h.level}"><a href="#${esc(h.id)}" onclick="scrollToAnchor(event,'${esc(h.id)}')">${esc(h.text)}</a></li>`).join('')}</ul>
    </nav>`;
}

function presentationBadge(p) {
  const mode = p === 'player' ? 'player' : (p === 'scene' ? 'scene' : '');
  if (!mode) return '';
  return `<span class="presentation-badge pb-${mode}">${mode === 'player' ? 'Per-player threads' : 'Scene timeline'}</span>`;
}

function scrollToAnchor(ev, id) {
  if (ev) ev.preventDefault();
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.scrollToAnchor = scrollToAnchor;

// Renders a structured-summary object: { title?, presentation?, content(md), sources? }.
// Falls back to legacy { body|summary } prose if no Markdown content is present.
function renderStructuredSummary(obj, anchorPrefix) {
  if (!obj || typeof obj !== 'object') {
    return `<div class="scenario-body">${renderScenarioText(obj)}</div>`;
  }
  const md = typeof obj.content === 'string' ? obj.content
    : (typeof obj.body === 'string' && /[#*\->]/.test(obj.body) ? obj.body : '');
  if (md) {
    const { html, headings } = markdownToHtml(md, anchorPrefix);
    return `${presentationBadge(obj.presentation)}
      ${renderSummaryIndex(headings)}
      <div class="summary-content">${html}</div>
      ${renderScenarioSources(obj.sources)}`;
  }
  return `${presentationBadge(obj.presentation)}
    <div class="scenario-body">${renderScenarioText(obj.body || obj.summary || obj)}</div>
    ${renderScenarioSources(obj.sources)}`;
}

function renderWhatHappenedSection(whatHappened) {
  const actions = renderScenarioSectionActions('player.summary.what_has_happened');
  if (!whatHappened) {
    return `
      <section class="scenario-section">
        <div class="scenario-section-header"><h3>What Has Happened So Far</h3>${actions}</div>
        <div class="empty scenario-empty"><p>No case summary has been generated yet.</p></div>
      </section>`;
  }
  return `
    <section class="scenario-section">
      <div class="scenario-section-header">
        <h3>${esc(whatHappened.title || 'What Has Happened So Far')}</h3>
        ${actions}
      </div>
      <div class="card scenario-summary-card">
        ${renderStructuredSummary(whatHappened, 'wh')}
      </div>
    </section>`;
}

function renderSessionAnalysis(entries) {
  const actions = renderScenarioSectionActions('player.summary.session_summaries');
  const list = scenarioArray(entries);
  return `
    <section class="scenario-section">
      <div class="scenario-section-header">
        <h3>Session Analysis</h3>
        ${actions}
      </div>
      ${list.length
        ? list.map((entry, i) => `
          <div class="card scenario-summary-card session-analysis-card">
            <div class="session-analysis-title">${esc((entry && (entry.title || entry.name)) || `Session ${i + 1}`)}</div>
            ${renderStructuredSummary(entry, `s${i + 1}`)}
          </div>`).join('')
        : `<div class="empty scenario-empty"><p>No session analysis has been generated yet.</p></div>`}
    </section>`;
}

// Strict, case-insensitive match of a character story entry to a viewer's own
// character name(s). Strict on purpose: a player must never see another
// player's story, so an unmatched entry is simply hidden.
function matchesCharacter(entry, viewerNames) {
  if (!entry || typeof entry !== 'object') return false;
  const names = (viewerNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
  if (!names.length) return false;
  const ids = [entry.name, entry.character, entry.title]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);
  return ids.some((id) => names.includes(id));
}

function gmNorm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function gmSlug(s) { return gmNorm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'; }

// Compact status badge. `kind` drives the colour family via CSS
// (.gm-pill-<kind>--<value>); value text is shown verbatim.
function gmPill(kind, value, prefix = '') {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  return `<span class="gm-pill gm-pill-${esc(kind)} gm-pill-${esc(kind)}--${esc(gmSlug(v))}">${esc(prefix)}${esc(v)}</span>`;
}

function gmPriorityRank(p) {
  const m = { high: 0, urgent: 0, medium: 1, med: 1, normal: 1, low: 2 };
  const r = m[gmNorm(p)];
  return r === undefined ? 1 : r;
}

// Join the four per-character GM arrays into one record per character so each
// player gets a single consolidated brief instead of being scattered across
// four flat lists. Order follows plans_by_player, then any stragglers.
function gmCharIndex(analysis) {
  const order = [];
  const map = new Map();
  const get = (rawName) => {
    const key = gmNorm(rawName);
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, { name: String(rawName).trim(), plan: null, deliverable: null, fairness: null, quiet: null });
      order.push(key);
    }
    return map.get(key);
  };
  scenarioArray(analysis.plans_by_player).forEach((e) => { const c = get(e && (e.character || e.name)); if (c) c.plan = e; });
  scenarioArray(analysis.next_deliverables).forEach((e) => { const c = get(e && (e.character || e.name)); if (c) c.deliverable = e; });
  scenarioArray(analysis.fairness_engagement).forEach((e) => { const c = get(e && (e.character || e.name)); if (c) c.fairness = e; });
  scenarioArray(analysis.quiet_players).forEach((e) => { const c = get(e && (e.character || e.name)); if (c) c.quiet = e; });
  return order.map((k) => map.get(k));
}

function gmCharChips(c) {
  const sp = c.fairness && c.fairness.spotlight;
  const en = c.fairness && c.fairness.engagement;
  return `${gmPill('spotlight', sp, 'Spotlight: ')}${gmPill('engagement', en, 'Engagement: ')}${c.quiet ? '<span class="gm-pill gm-pill-quiet">Needs a nudge</span>' : ''}`;
}

// One consolidated, scannable brief for a single character.
function gmCharBrief(c, active) {
  const slug = gmSlug(c.name);
  const block = (label, html, extra = '') => html
    ? `<div class="gm-brief-block"><div class="scenario-subtitle">${esc(label)}${extra}</div>${html}</div>`
    : '';
  const dl = c.deliverable || {};
  const dlTiming = dl.timing ? ` <span class="gm-when">${esc(dl.timing)}</span>` : '';
  return `
    <div class="gm-brief" id="gmbrief_${slug}" ${active ? '' : 'hidden'}>
      <div class="card gm-brief-card">
        <div class="gm-brief-head">
          <div class="card-title">${esc(c.name)}</div>
          <div class="state-chips">${gmCharChips(c)}</div>
        </div>
        ${block('Next deliverable', renderRichText(dl.content), dlTiming)}
        ${c.quiet ? block('Quiet-player nudge', renderRichText(c.quiet.content || c.quiet)) : ''}
        ${block('Plans &amp; hooks', renderRichText(c.plan && (c.plan.content || c.plan)))}
        ${block('Fairness &amp; engagement', renderRichText(c.fairness && c.fairness.content))}
        ${!dl.content && !c.quiet && !(c.plan && (c.plan.content || c.plan)) && !(c.fairness && c.fairness.content)
          ? '<p class="card-sub">No analysis generated for this character yet.</p>' : ''}
      </div>
    </div>`;
}

function gmInfoSelectChar(slug) {
  document.querySelectorAll('#gm-brief-tabs .sheet-tab').forEach((t) => t.classList.toggle('active', t.dataset.char === slug));
  document.querySelectorAll('#gm-brief-area .gm-brief').forEach((b) => { b.hidden = (b.id !== `gmbrief_${slug}`); });
}
window.gmInfoSelectChar = gmInfoSelectChar;

function renderGmActions(actions) {
  const list = scenarioArray(actions).slice().sort((a, b) => gmPriorityRank(a && a.priority) - gmPriorityRank(b && b.priority));
  if (!list.length) return '<div class="empty scenario-empty"><p>No GM actions generated yet.</p></div>';
  return `<div class="gm-actions">${list.map((a) => `
    <div class="card gm-action-card gm-prio-${esc(gmSlug(a.priority || 'normal'))}">
      <div class="gm-action-head">
        <div class="card-title">${esc(a.title || a.name || 'Action')}</div>
        ${gmPill('priority', a.priority)}
      </div>
      ${renderRichText(a.content || a.description || a)}
    </div>`).join('')}</div>`;
}

function renderGmAnalysis(info) {
  if (State.user.role !== 'gm') return '';
  const analysis = info.gm_analysis || {};
  if (analysis.error) return `<div class="alert alert-danger">${esc(analysis.error)}</div>`;
  if (analysis.generated === false) {
    return `<div class="empty scenario-empty"><p>No GM-only analysis has been generated yet. Use “Regenerate Page” to build it from the session sources.</p></div>`;
  }

  const progress = scenarioArray(analysis.scenario_progress);
  const chars = gmCharIndex(analysis);
  const briefsButton = scenarioPageButton('gm.plans_by_player,gm.next_deliverables,gm.fairness_engagement,gm.quiet_players', 'Regenerate Briefs');

  const pacing = `
    <section class="scenario-section">
      <div class="scenario-section-header">
        <h3>Scenario Pacing</h3>
        ${renderScenarioSectionActions('gm.scenario_progress')}
      </div>
      ${progress.length
        ? progress.map((e, i) => `<div class="card scenario-summary-card">${(e && (e.title || e.name)) ? `<div class="session-analysis-title">${esc(e.title || e.name)}</div>` : ''}${renderStructuredSummary(e, `gp${i + 1}`)}</div>`).join('')
        : '<div class="empty scenario-empty"><p>No pacing assessment generated yet.</p></div>'}
    </section>`;

  const actionsSection = `
    <section class="scenario-section">
      <div class="scenario-section-header">
        <h3>Priority Actions</h3>
        ${renderScenarioSectionActions('gm.gm_actions')}
      </div>
      ${renderGmActions(analysis.gm_actions)}
    </section>`;

  const briefsSection = `
    <section class="scenario-section">
      <div class="scenario-section-header">
        <h3>Player Briefs</h3>
        ${briefsButton}
      </div>
      ${chars.length ? `
        <div class="gm-signal-strip">
          ${chars.map((c) => `<button type="button" class="gm-signal" onclick="gmInfoSelectChar('${esc(gmSlug(c.name))}')"><span class="gm-signal-name">${esc(c.name)}</span>${gmCharChips(c)}</button>`).join('')}
        </div>
        <div class="sheet-tabs" id="gm-brief-tabs">
          ${chars.map((c, i) => `<div class="sheet-tab${i === 0 ? ' active' : ''}" data-char="${esc(gmSlug(c.name))}" onclick="gmInfoSelectChar('${esc(gmSlug(c.name))}')">${esc(c.name)}</div>`).join('')}
        </div>
        <div id="gm-brief-area">${chars.map((c, i) => gmCharBrief(c, i === 0)).join('')}</div>`
        : '<div class="empty scenario-empty"><p>No per-player analysis generated yet.</p></div>'}
    </section>`;

  return `<div class="gm-private-analysis">${pacing}${actionsSection}${briefsSection}</div>`;
}

function renderScenarioSourceEditor(sources) {
  const markdownSources = scenarioArray(sources.markdown_sources);
  if (State.user.role !== 'gm') {
    return `
      <div class="card scenario-summary-card">
        <div class="card-title">Player-Visible Sources</div>
        ${markdownSources.length ? markdownSources.map((source) => `
          <div class="scenario-subtitle">${esc(source.relative_path || source.path || 'Source')}</div>
          <div class="scenario-body">${renderScenarioText(source.content || '')}</div>
        `).join('') : '<p class="card-sub">No player-visible source files are available.</p>'}
      </div>`;
  }

  const editableSources = (markdownSources.length ? markdownSources : [
    {
      path: sources.public_source_path,
      relative_path: sources.public_source_path,
      visibility: 'player',
      content: sources.public_source || ''
    },
    {
      path: sources.private_source_path,
      relative_path: sources.private_source_path,
      visibility: 'gm',
      content: sources.private_source || ''
    }
  ].filter((source) => source.path)).map((source, index) => ({ ...source, index }));
  const preferredIndex = editableSources.find((source) => {
    const relative = source.relative_path || source.path || '';
    return relative === 'input/player.md' || relative.endsWith('/input/player.md');
  }) || editableSources[0] || null;
  State.scenarioSelectedSourceIndex = preferredIndex ? preferredIndex.index : null;

  return `
    <div class="card scenario-source-editor">
      <div class="card-header">
        <div>
          <div class="card-title">Edit Files</div>
          <div class="card-sub">The hub for case artifacts. Create or upload files (land GM-only; share with players via the toggle), download to edit in better tools, then Replace to reinject.</div>
        </div>
        <div class="ef-toolbar">
          <button class="btn btn-sm" onclick="efCreateFile(${State.currentSession})">+ New file</button>
          <button class="btn btn-sm" onclick="efUploadFile(${State.currentSession})">⤴ Upload</button>
        </div>
      </div>
      <div class="scenario-file-editor">
        <div class="scenario-file-list" role="list">
          ${editableSources.map((source) => `
            <button type="button" data-source-index="${source.index}" class="${source.index === State.scenarioSelectedSourceIndex ? 'active' : ''}" onclick="selectScenarioSource(${source.index})">
              <span>${esc(source.relative_path || source.path || `Source ${source.index + 1}`)}</span>
              <small>${source.visibility === 'gm' ? 'GM Only' : 'Player Handout'}</small>
            </button>
          `).join('')}
        </div>
        <div class="scenario-file-panel">
          ${preferredIndex ? `
            <div class="scenario-file-meta">
              <strong id="scenario-source-title">${esc(preferredIndex.relative_path || preferredIndex.path || 'Source')}</strong>
              <span id="scenario-source-visibility">${preferredIndex.visibility === 'gm' ? 'GM Only' : 'Player Handout'}</span>
            </div>
            <textarea id="scenario-source-editor" data-source-index="${preferredIndex.index}" rows="18">${esc(preferredIndex.content || '')}</textarea>
            <div class="scenario-source-actions">
              <button class="btn btn-primary" onclick="saveSessionScenarioSources(${State.currentSession}, this)">Save file</button>
              <button class="btn" onclick="revertScenarioSourceEditor()">Revert</button>
              <button class="btn" onclick="toggleSelectedSourceVisibility(${State.currentSession})" title="Move this file between the GM-only and player folders">GM Only ⇄ Player Handout</button>
              <button class="btn" onclick="efDownloadSelected(${State.currentSession})">Download</button>
              <button class="btn" onclick="efReplaceSelected(${State.currentSession})" title="Overwrite this file with one you upload">Replace</button>
              <button class="btn" onclick="efRenameSelected(${State.currentSession})" title="Rename this file (extension kept)">Rename</button>
              <span class="save-status" id="scenario-source-status"></span>
            </div>
          ` : '<div class="empty scenario-empty"><p>No editable markdown files are available.</p></div>'}
        </div>
      </div>
    </div>
    ${assetFilesPanelHtml(sources)}`;
}

// View-only preview of image/PDF assets (handouts, maps, clippings) on the
// Edit Files page — the markdown editor can't show these.
function assetFilesPanelHtml(sources) {
  const files = scenarioArray(sources.source_files)
    .filter((f) => f && (f.kind === 'graphic' || f.kind === 'pdf'));
  if (!files.length) return '';
  return `
    <div class="card scenario-source-editor" style="margin-top:1rem">
      <div class="card-header"><div>
        <div class="card-title">Graphics &amp; PDFs</div>
        <div class="card-sub">View-only preview of image and PDF assets in this case.</div>
      </div></div>
      <div class="asset-grid">
        ${files.map((f) => {
          const url = scenarioAssetUrl(f.path);
          const label = String(f.path || '').split('/').slice(-1)[0];
          const player = f.visibility !== 'gm';
          const media = f.kind === 'pdf'
            ? '<div class="asset-pdf">PDF</div>'
            : `<img src="${esc(url)}" alt="${esc(label)}" loading="lazy">`;
          return `<div class="asset-card">
            <a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(f.path)}">${media}</a>
            <span>${esc(label)}</span>
            <span class="vis-badge vis-${player ? 'player' : 'gm'}">${player ? 'Player Handout' : 'GM Only'}</span>
            <div class="asset-card-actions">
              <button class="btn btn-sm" onclick="toggleAssetVisibility(${State.currentSession}, '${esc(f.path)}', '${player ? 'gm' : 'player'}')">${player ? 'Make GM Only' : 'Make Player Handout'}</button>
              <a class="btn btn-sm" href="${esc(url)}?download=1" download>Download</a>
              <button class="btn btn-sm" onclick="efReplaceFile(${State.currentSession}, '${esc(f.path)}')">Replace</button>
              <button class="btn btn-sm" onclick="efRenameFile(${State.currentSession}, '${esc(f.path)}')">Rename</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function scenarioSourceEditorDirty() {
  const area = el('scenario-source-editor');
  if (!area) return false;
  const index = Number(area.dataset.sourceIndex);
  const source = scenarioArray(State.scenarioSources && State.scenarioSources.markdown_sources)[index];
  return !!source && area.value !== (source.content || '');
}

function selectScenarioSource(sourceIndex) {
  const area = el('scenario-source-editor');
  if (!area) return;
  if (scenarioSourceEditorDirty() && !confirm('Discard unsaved edits to the current file?')) return;
  const sources = scenarioArray(State.scenarioSources && State.scenarioSources.markdown_sources);
  const source = sources[Number(sourceIndex)];
  if (!source) return;
  State.scenarioSelectedSourceIndex = Number(sourceIndex);
  area.dataset.sourceIndex = String(sourceIndex);
  area.value = source.content || '';
  const title = el('scenario-source-title');
  if (title) title.textContent = source.relative_path || source.path || 'Source';
  const visibility = el('scenario-source-visibility');
  if (visibility) visibility.textContent = source.visibility === 'gm' ? 'GM Only' : 'Player Handout';
  document.querySelectorAll('.scenario-file-list button').forEach((button) => button.classList.remove('active'));
  const selectedButton = document.querySelector(`.scenario-file-list button[data-source-index="${Number(sourceIndex)}"]`);
  if (selectedButton) selectedButton.classList.add('active');
}
window.selectScenarioSource = selectScenarioSource;

function revertScenarioSourceEditor() {
  const area = el('scenario-source-editor');
  if (!area) return;
  const index = Number(area.dataset.sourceIndex);
  const source = scenarioArray(State.scenarioSources && State.scenarioSources.markdown_sources)[index];
  if (!source) return;
  area.value = source.content || '';
  const status = el('scenario-source-status');
  if (status) {
    status.textContent = 'Unsaved edits reverted';
    status.className = 'save-status';
  }
}
window.revertScenarioSourceEditor = revertScenarioSourceEditor;

async function loadScenarioInfo(sessionId, asUser) {
  const info = await api.getSessionScenarioInfo(sessionId, asUser);
  if (!asUser) State.scenarioInfo = info;
  setScenarioImages(info && info.source_files);
  return info;
}

async function renderSessionScenarioInfo(sessionId, mode = 'gm') {
  const tab = el('session-content');
  if (!tab) return;
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading scenario information…</p>';

  let sources = null;
  let info = {};
  try {
    if (mode === 'raw') {
      sources = await api.getSessionScenarioSources(sessionId);
      State.scenarioSources = sources;
    } else {
      info = await loadScenarioInfo(sessionId);
    }
  } catch (e) {
    tab.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }

  if (mode === 'raw') {
    // The Edit Files page holds no AI-generated artifacts, so its action is the
    // full bulk regenerate (empty section list = all sections).
    tab.innerHTML = `
      <div class="page-header">
        <div>
          <h2>Edit Files</h2>
          <p class="card-sub">Edit player-visible source files and GM-only source files separately.</p>
        </div>
        ${scenarioPageButton('', 'Bulk Regenerate')}
      </div>
      <div id="scenario-alert"></div>
      ${renderScenarioSourceEditor(sources || {})}`;
    return;
  }

  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>GM Scenario Information</h2>
        ${info.gm_analysis && info.gm_analysis.generated_at ? `<p class="card-sub">Generated ${esc(new Date(info.gm_analysis.generated_at).toLocaleString('en-GB'))}</p>` : ''}
      </div>
      ${scenarioPageButton('gm.scenario_progress,gm.plans_by_player,gm.next_deliverables,gm.fairness_engagement,gm.quiet_players,gm.gm_actions', 'Regenerate Page')}
    </div>
    <div id="scenario-alert"></div>
    ${renderGmAnalysis(info)}`;
}

async function renderSessionCaseInfo(sessionId) {
  const tab = el('session-content');
  if (!tab) return;
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading case info…</p>';
  let info;
  try {
    info = await loadScenarioInfo(sessionId);
  } catch (e) {
    tab.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const summary = info.summary || {};
  const whatHappened = summary.what_has_happened || info.what_has_happened;
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>Case Info</h2>
        ${info.generated_at ? `<p class="card-sub">Generated ${esc(new Date(info.generated_at).toLocaleString('en-GB'))}</p>` : ''}
      </div>
      ${scenarioPageButton('player.summary.what_has_happened,player.summary.session_summaries', 'Regenerate Page')}
    </div>
    <div id="scenario-alert"></div>
    ${info.error ? `<div class="alert alert-danger">${esc(info.error)}</div>` : ''}
    ${info.generated === false
      ? `<div class="card scenario-summary-card"><div class="card-title">No case information generated yet</div><p class="card-sub">A GM can run the scenario regeneration to populate this from the session sources.</p></div>`
      : `${renderWhatHappenedSection(whatHappened)}
         ${renderSessionAnalysis(summary.session_summaries)}`}`;
}

async function renderSessionPlayerInfo(sessionId) {
  const tab = el('session-content');
  if (!tab) return;
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading player info…</p>';
  const isGM = State.user.role === 'gm';

  if (!isGM) {
    let info;
    try {
      info = await loadScenarioInfo(sessionId);
    } catch (e) {
      tab.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
      return;
    }
    const viewerNames = (info.viewer && info.viewer.character_names) || [];
    const mine = scenarioArray(info.entities && info.entities.characters)
      .filter((c) => matchesCharacter(c, viewerNames));
    tab.innerHTML = `
      <div class="page-header">
        <div><h2>Player Info</h2><p class="card-sub">Your character's story so far${viewerNames.length ? ` — ${esc(viewerNames.join(', '))}` : ''}.</p></div>
      </div>
      <div id="scenario-alert"></div>
      ${renderScenarioSection('Your Story', mine, 'No story for your character has been generated yet.', '')}`;
    return;
  }

  let players;
  try {
    players = await api.getSessionPlayers(sessionId);
  } catch (e) {
    tab.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }

  const pageButton = scenarioPageButton('player.entities.characters', 'Regenerate Page');
  if (!players.length) {
    tab.innerHTML = `
      <div class="page-header"><div><h2>Player Info</h2></div>${pageButton}</div>
      <div id="scenario-alert"></div>
      <div class="empty"><div class="empty-icon">👥</div><p>No players assigned to this session yet.</p></div>`;
    return;
  }

  tab.innerHTML = `
    <div class="page-header">
      <div><h2>Player Info</h2><p class="card-sub">Select a player to see exactly what they see.</p></div>
      ${pageButton}
    </div>
    <div id="scenario-alert"></div>
    <div style="margin-bottom:1rem">
      <div class="sheet-tabs" id="scenario-player-tabs">
        ${players.map((p, i) => `<div class="sheet-tab${i === 0 ? ' active' : ''}" id="sptab_${p.id}" onclick="scenarioSelectPlayer(${sessionId}, ${p.id}, '${esc(p.username)}')">${esc(p.username)}</div>`).join('')}
      </div>
    </div>
    <div id="scenario-player-area"><p style="color:var(--text2)">Loading…</p></div>`;

  const preferred = players.find((p) => p.id === readStoredGmPlayerId(sessionId)) || players[0];
  await scenarioSelectPlayer(sessionId, preferred.id, preferred.username);
}

async function scenarioSelectPlayer(sessionId, userId, username) {
  storeGmPlayerId(sessionId, userId);
  document.querySelectorAll('#scenario-player-tabs .sheet-tab').forEach((t) => t.classList.remove('active'));
  const tabBtn = el(`sptab_${userId}`);
  if (tabBtn) tabBtn.classList.add('active');
  const area = el('scenario-player-area');
  if (!area) return;
  area.innerHTML = '<p style="color:var(--text2)">Loading…</p>';
  let info;
  try {
    info = await api.getSessionScenarioInfo(sessionId, userId);
  } catch (e) {
    area.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  setScenarioImages(info && info.source_files);
  const viewerNames = (info.viewer && info.viewer.character_names) || [];
  const mine = scenarioArray(info.entities && info.entities.characters)
    .filter((c) => matchesCharacter(c, viewerNames));
  area.innerHTML = `
    <div class="scenario-viewer">Viewing as ${esc(username)}${viewerNames.length ? ` — ${esc(viewerNames.join(', '))}` : ''}</div>
    ${renderScenarioSection('Player Story', mine, 'No story for this player has been generated yet.', '')}`;
}
window.scenarioSelectPlayer = scenarioSelectPlayer;

async function renderSessionEntities(sessionId) {
  const tab = el('session-content');
  if (!tab) return;
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading NPC/Places/Things…</p>';
  let info;
  try {
    info = await loadScenarioInfo(sessionId);
  } catch (e) {
    tab.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const entities = info.entities || {};
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>NPC/Places/Things</h2>
        ${info.generated_at ? `<p class="card-sub">Generated ${esc(new Date(info.generated_at).toLocaleString('en-GB'))}</p>` : ''}
      </div>
      ${scenarioPageButton('player.entities.locations,player.entities.npcs,player.entities.items', 'Regenerate Page')}
    </div>
    <div id="scenario-alert"></div>
    ${info.error ? `<div class="alert alert-danger">${esc(info.error)}</div>` : ''}
    ${info.generated === false
      ? `<div class="card scenario-summary-card"><div class="card-title">Nothing generated yet</div><p class="card-sub">A GM can run the scenario regeneration to populate places, NPCs, and notable things.</p></div>`
      : `${renderScenarioSection('Places', entities.locations || info.locations, 'No places have been generated yet.', 'player.entities.locations')}
         ${renderScenarioSection('NPCs', entities.npcs || info.npcs, 'No NPCs have been generated yet.', 'player.entities.npcs')}
         ${renderScenarioSection('Things', entities.items || info.items, 'No notable things have been generated yet.', 'player.entities.items')}`}`;
}

// Toggle the currently-selected markdown file in Edit Files between the GM-only
// and player folders (server refuses the canonical player.md / gm.md).
function toggleSelectedSourceVisibility(sessionId) {
  const src = scenarioArray(State.scenarioSources && State.scenarioSources.markdown_sources)[State.scenarioSelectedSourceIndex];
  if (!src) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  toggleAssetVisibility(sessionId, src.path, src.visibility === 'gm' ? 'player' : 'gm');
}
window.toggleSelectedSourceVisibility = toggleSelectedSourceVisibility;

async function toggleAssetVisibility(sessionId, assetPath, toVisibility) {
  try {
    await api.setAssetVisibility(sessionId, assetPath, toVisibility);
    showAlert(`Now ${toVisibility === 'player' ? 'a Player Handout' : 'GM Only'}.`, 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message || 'Could not change visibility', 'danger', 'scenario-alert');
  }
}
window.toggleAssetVisibility = toggleAssetVisibility;

// ── Edit Files: Create / Upload / Download / Replace ─────────────────────────
function efPickFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}
function efFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file'));
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.readAsDataURL(file);
  });
}
function efSelectedSource() {
  return scenarioArray(State.scenarioSources && State.scenarioSources.markdown_sources)[State.scenarioSelectedSourceIndex] || null;
}

async function efCreateFile(sessionId) {
  const name = prompt('New file name (e.g. clue-note.md, briefing.md):', '');
  if (name === null) return;
  try {
    const r = await api.createSessionFile(sessionId, { name: name.trim(), text: '' });
    showAlert(`Created ${r.file} (GM Only). Edit it here; share with players via the toggle.`, 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message || 'Create failed', 'danger', 'scenario-alert');
  }
}
window.efCreateFile = efCreateFile;

async function efUploadFile(sessionId) {
  const file = await efPickFile();
  if (!file) return;
  try {
    const content_base64 = await efFileToBase64(file);
    const r = await api.createSessionFile(sessionId, { name: file.name, content_base64, area: 'gm' });
    showAlert(`Uploaded ${r.file} (GM Only). Share with players via the toggle.`, 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message || 'Upload failed', 'danger', 'scenario-alert');
  }
}
window.efUploadFile = efUploadFile;

async function efReplaceFile(sessionId, assetPath) {
  if (!assetPath) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  const file = await efPickFile();
  if (!file) return;
  try {
    const content_base64 = await efFileToBase64(file);
    await api.replaceSessionFile(sessionId, { path: assetPath, content_base64 });
    showAlert('Replaced — contents updated, visibility unchanged.', 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message || 'Replace failed', 'danger', 'scenario-alert');
  }
}
window.efReplaceFile = efReplaceFile;

async function efRenameFile(sessionId, assetPath) {
  if (!assetPath) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  const cur = String(assetPath).split('/').slice(-1)[0];
  const next = prompt('New name (extension is kept automatically):', cur.replace(/\.[^.]+$/, ''));
  if (next === null) return;
  try {
    const r = await api.renameSessionFile(sessionId, { path: assetPath, name: next });
    showAlert(`Renamed to ${r.file}.`, 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message || 'Rename failed', 'danger', 'scenario-alert');
  }
}
window.efRenameFile = efRenameFile;

function efDownloadSelected(sessionId) {
  const src = efSelectedSource();
  if (!src) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  window.open(`${scenarioAssetUrl(src.path, sessionId)}?download=1`, '_blank');
}
window.efDownloadSelected = efDownloadSelected;

function efReplaceSelected(sessionId) {
  const src = efSelectedSource();
  if (!src) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  efReplaceFile(sessionId, src.path);
}
window.efReplaceSelected = efReplaceSelected;

function efRenameSelected(sessionId) {
  const src = efSelectedSource();
  if (!src) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  efRenameFile(sessionId, src.path);
}
window.efRenameSelected = efRenameSelected;

async function reloadCurrentSessionPanel() {
  if (!State.currentSession) return;
  await switchSessionPanel(State.currentSession, State.currentSessionPanel || 'case-info');
}

async function regenerateScenarioSection(sectionId, btn) {
  if (!State.currentSession) return;
  if (State.llmBusy) {
    showAlert('A generation is already running — wait for it to finish.', 'danger', 'scenario-alert');
    return;
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Regenerating…';
  llmPendingBegin(sectionId);
  try {
    await api.regenerateScenarioSection(State.currentSession, sectionId);
    showAlert('Section regenerated', 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message, 'danger', 'scenario-alert');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
    llmPendingEnd();
  }
}
window.regenerateScenarioSection = regenerateScenarioSection;

async function revertScenarioSection(sectionId, btn) {
  if (!State.currentSession) return;
  if (!confirm('Revert this section to the previous generated value?')) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Reverting…';
  try {
    await api.revertScenarioSection(State.currentSession, sectionId);
    showAlert('Section reverted', 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message, 'danger', 'scenario-alert');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
window.revertScenarioSection = revertScenarioSection;

async function saveSessionScenarioSources(sessionId, btn) {
  const status = el('scenario-source-status');
  if (status) {
    status.textContent = 'Saving…';
    status.className = 'save-status';
  }
  btn.disabled = true;
  try {
    const allSources = scenarioArray(State.scenarioSources && State.scenarioSources.markdown_sources);
    const area = el('scenario-source-editor');
    const source = area ? allSources[Number(area.dataset.sourceIndex)] : null;
    if (!area || !source) throw new Error('Select a source file first.');
    await api.saveSessionScenarioSources(sessionId, {
      markdown_sources: [{
        path: source.path,
        relative_path: source.relative_path,
        content: area.value || ''
      }]
    });
    source.content = area.value || '';
    if (status) {
      status.textContent = 'File saved';
      status.className = 'save-status saved';
    }
  } catch (e) {
    if (status) {
      status.textContent = e.message;
      status.className = 'save-status error';
    }
  } finally {
    btn.disabled = false;
  }
}
window.saveSessionScenarioSources = saveSessionScenarioSources;

// Single generation path from the web app. `sectionsCsv` is the page's section
// ids; an empty string regenerates everything (bulk). Each section is one Ollama
// call server-side, so this can take a while — the button stays disabled until
// the run finishes.
async function regenerateScenarioPage(btn, sectionsCsv, label) {
  if (!State.currentSession) return;
  if (State.llmBusy) {
    showAlert('A generation is already running — wait for it to finish.', 'danger', 'scenario-alert');
    return;
  }
  const sections = String(sectionsCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  const body = sections.length ? { sections } : {};
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = `${label || 'Regenerating'}…`;
  llmPendingBegin(label || 'scenario');
  try {
    const result = await api.regenerateScenarioSections(State.currentSession, body);
    const ok = scenarioArray(result.regenerated).length;
    const errs = scenarioArray(result.errors);
    if (errs.length) {
      const detail = errs.map((e) => `${e.section_id}: ${e.error}`).join('; ');
      showAlert(`Regenerated ${ok} section(s); ${errs.length} failed — ${detail}`, 'danger', 'scenario-alert');
    } else {
      showAlert(`Regenerated ${ok} section(s)`, 'success', 'scenario-alert');
    }
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message, 'danger', 'scenario-alert');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
    llmPendingEnd();
  }
}
window.regenerateScenarioPage = regenerateScenarioPage;

// ── NPC tab (GM) ─────────────────────────────────────────────────────────────
function npcCaseSummary(entry) {
  const names = (entry.sessions || []).map((s) => s.name);
  if (!names.length) return 'Unallocated';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

// ── Per-case NPC detail view (read-only) ─────────────────────────────────────
// Shows the NPCs allocated to this case. Management/allocation is in Admin.
async function renderSessionNpcs(sessionId) {
  const tab = el('session-content');
  if (!tab) return;
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading NPCs…</p>';
  let npcs;
  try {
    npcs = await api.getNpcs(sessionId);
    State.npcs = npcs;
  } catch (e) {
    tab.innerHTML = `<div class="page-header"><h2>NPCs</h2></div><div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }

  const card = (npc) => {
    const occupation = (npc.sheet && npc.sheet.occupation) || npc.role || '';
    const meta = [occupation, npc.sheet ? null : 'no sheet'].filter(Boolean);
    return `
      <div class="card npc-card">
        <div class="card-header">
          <div>
            <div class="card-title">${esc(npc.name)}</div>
            ${meta.length ? `<div class="card-sub">${esc(meta.join(' | '))}</div>` : ''}
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            <button class="btn btn-sm" onclick="openNpcSheetView(${npc.id})"${npc.sheet ? '' : ' disabled'}>View sheet</button>
          </div>
        </div>
        ${(npc.sheet && npc.sheet.reputation) ? `<p class="card-sub">${esc(npc.sheet.reputation)}</p>` : ''}
      </div>`;
  };

  const isGM = State.user.role === 'gm';
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>NPCs</h2>
        <p class="card-sub">NPCs allocated to this case. Create and edit sheets in <strong>Admin → NPCs</strong>.</p>
      </div>
      ${isGM ? `<button class="btn btn-primary" onclick="openSessionNpcAssign(${sessionId})">Assign NPCs…</button>` : ''}
    </div>
    <div id="npcs-alert"></div>
    ${npcs.length
      ? `<div class="npc-grid">${npcs.map(card).join('')}</div>`
      : `<div class="empty"><div class="empty-icon">👤</div><p>No NPCs allocated to this case yet.</p></div>`}`;
}

// Pick which NPCs belong to this case, from the case screen.
async function openSessionNpcAssign(sessionId) {
  let all;
  try {
    all = await api.getNpcs();
  } catch (e) {
    return showAlert(e.message, 'danger', 'npcs-alert');
  }
  if (!all.length) {
    return modal(`
      <h3>Assign NPCs</h3>
      <p class="card-sub">No NPCs exist yet. Create them in Admin → NPCs.</p>
      <div class="modal-actions"><button class="btn" onclick="this.closest('.modal-backdrop').remove()">Close</button></div>`);
  }
  const selected = new Set(all.filter((n) => (n.session_ids || []).map(Number).includes(Number(sessionId))).map((n) => n.id));
  modal(`
    <h3>Assign NPCs to this case</h3>
    <div id="modal-alert"></div>
    <p class="card-sub" style="margin-bottom:0.5rem">Tick the NPCs that appear in this case.</p>
    <div class="case-allocation">${all.map((n) => `
      <label class="case-allocation-row">
        <input type="checkbox" value="${n.id}"${selected.has(n.id) ? ' checked' : ''}>
        <span>${esc(n.name)}${(n.sheet && n.sheet.occupation) ? ` <em style="color:var(--text2)">${esc(n.sheet.occupation)}</em>` : ''}</span>
      </label>`).join('')}</div>
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSessionNpcAssign(${sessionId}, this)">Save</button>
    </div>`);
}
window.openSessionNpcAssign = openSessionNpcAssign;

async function saveSessionNpcAssign(sessionId, btn) {
  const root = btn.closest('.modal-backdrop');
  const npcIds = [...root.querySelectorAll('.case-allocation input:checked')].map((c) => Number(c.value));
  btn.disabled = true;
  try {
    await api.setSessionNpcs(sessionId, npcIds);
    root.remove();
    await renderSessionNpcs(sessionId);
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.saveSessionNpcAssign = saveSessionNpcAssign;

// Read-only sheet view for the per-case NPC detail.
function openNpcSheetView(npcId) {
  const npc = State.npcs.find((entry) => entry.id === npcId);
  if (!npc) return;
  modal(`
    <h3>${esc(npc.name)} — Character Sheet</h3>
    <div id="npc-sheet-area"><p style="color:var(--text2)">Loading…</p></div>
    <div class="sheet-actions">
      <button class="btn" onclick="exportPdf()">Export PDF</button>
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Close</button>
    </div>`, (root) => {
    const modalEl = root.querySelector('.modal');
    if (modalEl) { modalEl.style.maxWidth = '1100px'; modalEl.style.maxHeight = '92vh'; modalEl.style.overflowY = 'auto'; }
    const area = root.querySelector('#npc-sheet-area');
    area.innerHTML = '';
    SheetForm.setRuleset('rol');
    SheetForm.render(area, npc.sheet || {}, true);
  });
}
window.openNpcSheetView = openNpcSheetView;

// ── Admin: NPC management + case allocation ──────────────────────────────────
async function renderAdminNpcs() {
  const host = el('admin-content');
  if (!host) return;
  host.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading NPCs…</p>';
  try {
    const [npcs, sessions] = await Promise.all([api.getNpcs(), api.getSessions()]);
    State.npcs = npcs;
    State.sessions = sessions;
  } catch (e) {
    host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const card = (npc) => {
    const occupation = (npc.sheet && npc.sheet.occupation) || npc.role || '';
    const meta = [occupation, `Cases: ${esc(npcCaseSummary(npc))}`].filter(Boolean);
    return `
      <div class="card npc-card">
        <div class="card-header">
          <div>
            <div class="card-title">${esc(npc.name)}</div>
            <div class="card-sub">${meta.join(' | ')}</div>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            <button class="btn btn-sm" onclick="openNpcSheet(${npc.id})">Edit</button>
            <button class="btn btn-sm" onclick="openNpcCases(${npc.id})">Cases…</button>
            <button class="btn btn-sm btn-danger" onclick="deleteNpcRecord(${npc.id})">Delete</button>
          </div>
        </div>
        ${(npc.sheet && npc.sheet.reputation) ? `<p class="card-sub">${esc(npc.sheet.reputation)}</p>` : ''}
      </div>`;
  };
  host.innerHTML = `
    <div class="page-header">
      <h2>NPCs</h2>
      <button class="btn btn-primary" onclick="openNpcSheet()">+ New NPC</button>
    </div>
    <div id="npcs-alert"></div>
    ${State.npcs.length
      ? `<div class="npc-grid">${State.npcs.map(card).join('')}</div>`
      : `<div class="empty"><div class="empty-icon">👤</div><p>No NPCs yet. Create one, or run <code>npm run npcs:seed</code> for the rulebook NPCs.</p></div>`}`;
}

// Single NPC editor (Admin) — create (no id) or edit. The sheet's own Name
// field is authoritative; case allocation is done via "Cases…".
function openNpcSheet(npcId) {
  const npc = npcId ? State.npcs.find((entry) => entry.id === npcId) : null;
  modal(`
    <h3>${npc ? `${esc(npc.name)} — Character Sheet` : 'New NPC — Character Sheet'}</h3>
    <div id="modal-alert"></div>
    <p class="card-sub" style="margin:0 0 0.5rem">Set the NPC's name in the sheet below (Personal Info → Name). Allocate to cases with the “Cases…” button.</p>
    <div id="npc-sheet-area"><p style="color:var(--text2)">Loading sheet…</p></div>
    <div class="sheet-actions">
      <button class="btn btn-primary" onclick="saveNpcSheetForm(${npc ? npc.id : 'null'}, this)">${npc ? 'Save sheet' : 'Create NPC'}</button>
      <button class="btn" onclick="exportPdf()">Export PDF</button>
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Close</button>
      <span class="save-status" id="npc-sheet-status"></span>
    </div>`, (root) => {
    const modalEl = root.querySelector('.modal');
    if (modalEl) { modalEl.style.maxWidth = '1100px'; modalEl.style.maxHeight = '92vh'; modalEl.style.overflowY = 'auto'; }
    const area = root.querySelector('#npc-sheet-area');
    area.innerHTML = '';
    SheetForm.setRuleset('rol');
    SheetForm.render(area, (npc && npc.sheet) || {}, false);
  });
}
window.openNpcSheet = openNpcSheet;

async function saveNpcSheetForm(npcId, btn) {
  const sheet = SheetForm.collect();
  const name = String(sheet.name || '').trim();
  if (!name) return showAlert('Enter the NPC name in the sheet (Personal Info → Name).', 'danger', 'modal-alert');
  const status = el('npc-sheet-status');
  if (status) { status.textContent = 'Saving…'; status.className = 'save-status'; }
  btn.disabled = true;
  try {
    const payload = { name, role: sheet.occupation || '', sheet };
    if (npcId) await api.updateNpc(npcId, payload);
    else await api.createNpc(payload);
    btn.closest('.modal-backdrop').remove();
    await renderAdminNpcs();
  } catch (e) {
    if (status) { status.textContent = `✕ ${e.message}`; status.className = 'save-status error'; }
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.saveNpcSheetForm = saveNpcSheetForm;

async function deleteNpcRecord(npcId) {
  if (!confirm('Delete this NPC?')) return;
  try {
    await api.deleteNpc(npcId);
    await renderAdminNpcs();
  } catch (e) {
    showAlert(e.message, 'danger', 'npcs-alert');
  }
}
window.deleteNpcRecord = deleteNpcRecord;

// ── Case allocation modal (shared by NPCs and Accounts) ──────────────────────
function caseCheckboxes(selectedIds, list) {
  const set = new Set((selectedIds || []).map(Number));
  const cases = list || State.sessions || [];
  if (!cases.length) return '<p class="card-sub">No case files exist yet.</p>';
  return `<div class="case-allocation">${cases.map((s) => `
    <label class="case-allocation-row">
      <input type="checkbox" value="${s.id}"${set.has(Number(s.id)) ? ' checked' : ''}>
      <span>${esc(s.name)}${s.domestic ? ' <em style="color:var(--text2)">(solo)</em>' : ''}</span>
    </label>`).join('')}</div>`;
}

function selectedCaseIds(root) {
  return [...root.querySelectorAll('.case-allocation input:checked')].map((c) => Number(c.value));
}

// NPCs can be allocated to any case including The Domestic, so use the
// dedicated allocatable-cases list rather than the visible Case Files list.
async function openNpcCases(npcId) {
  const npc = State.npcs.find((entry) => entry.id === npcId);
  if (!npc) return;
  let cases;
  try {
    cases = await api.getAllocatableCases();
    State.allocatableCases = cases;
  } catch (e) {
    return showAlert(e.message, 'danger', 'npcs-alert');
  }
  modal(`
    <h3>${esc(npc.name)} — Cases</h3>
    <div id="modal-alert"></div>
    <p class="card-sub" style="margin-bottom:0.5rem">Allocate this NPC to any cases (or none).</p>
    ${caseCheckboxes(npc.session_ids, cases)}
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveNpcCases(${npc.id}, this)">Save</button>
    </div>`);
}
window.openNpcCases = openNpcCases;

async function saveNpcCases(npcId, btn) {
  const root = btn.closest('.modal-backdrop');
  btn.disabled = true;
  try {
    await api.setNpcSessions(npcId, selectedCaseIds(root));
    root.remove();
    await renderAdminNpcs();
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.saveNpcCases = saveNpcCases;

function openUserCases(userId) {
  const user = State.users.find((entry) => entry.id === userId);
  if (!user) return;
  modal(`
    <h3>${esc(user.username)} — Cases</h3>
    <div id="modal-alert"></div>
    <p class="card-sub" style="margin-bottom:0.5rem">Allocate this account to any cases (or none).</p>
    ${caseCheckboxes(user.session_ids)}
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveUserCases(${user.id}, this)">Save</button>
    </div>`);
}
window.openUserCases = openUserCases;

async function saveUserCases(userId, btn) {
  const root = btn.closest('.modal-backdrop');
  btn.disabled = true;
  try {
    await api.setUserSessions(userId, selectedCaseIds(root));
    root.remove();
    await renderAdminAccounts();
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.saveUserCases = saveUserCases;

// ── Admin shell ──────────────────────────────────────────────────────────────
async function loadAdminTab() {
  const tab = el('tab-admin');
  if (!tab) return;
  tab.innerHTML = `
    <div class="page-header"><h2>Admin</h2></div>
    <div class="sheet-tabs">
      <div class="sheet-tab active" data-admin="accounts" onclick="adminShow('accounts')">Accounts</div>
      <div class="sheet-tab" data-admin="npcs" onclick="adminShow('npcs')">NPCs</div>
      <div class="sheet-tab" data-admin="cases" onclick="adminShow('cases')">Case Settings</div>
      <div class="sheet-tab" data-admin="llm" onclick="adminShow('llm')">LLM</div>
    </div>
    <div id="admin-content"><p style="color:var(--text2);padding:1rem">Loading…</p></div>`;
  await adminShow('accounts');
}
window.loadAdminTab = loadAdminTab;

async function adminShow(section) {
  document.querySelectorAll('[data-admin]').forEach((t) => t.classList.toggle('active', t.dataset.admin === section));
  if (section === 'npcs') await renderAdminNpcs();
  else if (section === 'cases') await renderAdminCases();
  else if (section === 'llm') await renderAdminLlm();
  else await renderAdminAccounts();
}
window.adminShow = adminShow;

async function renderAdminCases() {
  const host = el('admin-content');
  if (!host) return;
  host.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading…</p>';
  let sessions;
  try {
    sessions = await api.getSessions();
    const settings = await Promise.all(sessions.map((s) => api.getSessionSettings(s.id).catch(() => ({ advantage_mode: 'rol', ruleset: 'rol' }))));
    sessions.forEach((s, i) => {
      s._adv = (settings[i] && settings[i].advantage_mode) || 'rol';
      s._ruleset = (settings[i] && settings[i].ruleset) || 'rol';
    });
  } catch (e) {
    host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  host.innerHTML = `
    <div class="page-header"><h2>Case Settings</h2></div>
    <div id="cases-alert"></div>
    ${sessions.length ? `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Case</th><th>Advantage / disadvantage handling</th><th>Ruleset</th></tr></thead>
      <tbody>${sessions.map((s) => `<tr>
        <td><strong>${esc(s.name)}</strong></td>
        <td><select onchange="saveCaseAdvantage(${s.id}, this.value, this)">
          <option value="rol"${s._adv !== 'simple' ? ' selected' : ''}>RoL bonus/penalty die (roll the tens die twice)</option>
          <option value="simple"${s._adv === 'simple' ? ' selected' : ''}>Simple (roll two d100s, take best/worst)</option>
        </select></td>
        <td><select onchange="saveCaseRuleset(${s.id}, this.value, this)">
          <option value="rol"${s._ruleset !== 'coc' ? ' selected' : ''}>Rivers of London (no SIZ; no HP/Build)</option>
          <option value="coc"${s._ruleset === 'coc' ? ' selected' : ''}>CoC-style (SIZ, plus SIZ-derived HP &amp; Build)</option>
        </select></td>
      </tr>`).join('')}</tbody>
    </table></div></div>` : '<div class="empty"><p>No GM case files yet.</p></div>'}`;
}

async function saveCaseAdvantage(sessionId, mode, sel) {
  sel.disabled = true;
  try {
    await api.setSessionSettings(sessionId, { advantage_mode: mode });
    showAlert('Saved.', 'success', 'cases-alert');
  } catch (e) {
    showAlert(e.message, 'danger', 'cases-alert');
  } finally {
    sel.disabled = false;
  }
}
window.saveCaseAdvantage = saveCaseAdvantage;

async function saveCaseRuleset(sessionId, ruleset, sel) {
  sel.disabled = true;
  try {
    await api.setSessionSettings(sessionId, { ruleset });
    showAlert('Saved. Re-open a character sheet for this case to see the change.', 'success', 'cases-alert');
  } catch (e) {
    showAlert(e.message, 'danger', 'cases-alert');
  } finally {
    sel.disabled = false;
  }
}
window.saveCaseRuleset = saveCaseRuleset;

async function renderAdminLlm() {
  const host = el('admin-content');
  if (!host) return;
  host.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading…</p>';
  let info;
  try {
    info = await api.getLlmModels();
  } catch (e) {
    host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const models = Array.isArray(info.models) ? info.models : [];
  const current = info.current || '';
  const def = info.default || '';
  // Always include the current model in the list even if Ollama didn't list it.
  const options = models.slice();
  if (current && !options.includes(current)) options.unshift(current);

  const selector = options.length
    ? `<select id="llm-model-select">
        ${options.map((m) => `<option value="${esc(m)}"${m === current ? ' selected' : ''}>${esc(m)}${m === def ? ' (default)' : ''}</option>`).join('')}
       </select>`
    : `<input type="text" id="llm-model-select" value="${esc(current)}" placeholder="model name e.g. ${esc(def)}">`;

  host.innerHTML = `
    <div id="llm-alert"></div>
    <div class="card">
      <div class="card-header"><div>
        <div class="card-title">Language model</div>
        <div class="card-sub">Model used for all generation and GM Chat. Persists in <code>data/app-config.json</code>; the configured default is <strong>${esc(def)}</strong>.</div>
      </div></div>
      ${info.error ? `<div class="alert alert-danger">Couldn’t list models from Ollama (${esc(info.error)}). You can still type a model name below.</div>` : ''}
      <div class="form-group" style="max-width:520px">
        <label>Active model</label>
        ${selector}
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-primary" onclick="saveAdminLlmModel(this)">Save</button>
        ${def && current !== def ? `<button class="btn" onclick="saveAdminLlmModel(this, '${esc(def)}')">Reset to default</button>` : ''}
        <span class="save-status" id="llm-status"></span>
      </div>
    </div>`;
}

async function saveAdminLlmModel(btn, forceModel) {
  const sel = el('llm-model-select');
  const model = (forceModel != null ? forceModel : (sel && sel.value || '')).trim();
  if (!model) { showAlert('Pick or enter a model.', 'danger', 'llm-alert'); return; }
  btn.disabled = true;
  try {
    const r = await api.setLlmModel(model);
    showAlert(`Active model set to ${r.model}.`, 'success', 'llm-alert');
    await renderAdminLlm();
  } catch (e) {
    showAlert(e.message || 'Could not set the model', 'danger', 'llm-alert');
  } finally {
    btn.disabled = false;
  }
}
window.saveAdminLlmModel = saveAdminLlmModel;

// ── Rules tab ────────────────────────────────────────────────────────────────
async function loadRulesTab() {
  const tab = el('tab-rules');
  if (!tab) return;

  let files = State.rulesFiles;
  if (!files) {
    try {
      const rules = await api.getRules();
      files = rules.files;
      State.rulesFiles = files;
    } catch (e) {
      tab.innerHTML = `
        <div class="page-header"><h2>Rules Library</h2></div>
        <div class="alert alert-danger">${esc(e.message)}</div>`;
      return;
    }
  }

  tab.innerHTML = `
    <div class="page-header"><h2>Rules Library</h2></div>
    <div class="card">
      <div class="card-title">Rivers of London Rulebook</div>
      <p class="card-sub">The HTML rulebook is shown below. Use your browser's built-in find (Ctrl/Cmd + F) to search.</p>
      <div class="rulebook-pane">
        <iframe src="${esc(files.html)}" title="Rivers of London rulebook" loading="lazy"></iframe>
      </div>
    </div>`;
}

// The Domestic opens inside the Case File page, like any other case file.
async function openDomestic(options = {}) {
  const { replaceUrl = false } = options;
  const tab = el('tab-sessions');
  if (!tab) return;
  State.currentSession = null;
  State.currentSheetUserId = null;
  setActiveMainTab('sessions');
  updateUiStateInUrl({ tab: 'sessions', session: 'domestic' }, replaceUrl);

  // Re-read the solo character from the server whenever it is opened so
  // returning to The Domestic cannot show stale in-memory state.
  resetDomesticRuntimeState({ preserveAdventure: true });

  tab.innerHTML = `
    <div class="page-header">
      <div>
        <button class="btn btn-sm" onclick="loadSessionsTab()" style="margin-bottom:0.5rem">← Back</button>
        <h2>The Domestic</h2>
        <p style="color:var(--text2);font-size:0.88rem">Solo adventure — play through the case and build your character as you go.</p>
      </div>
    </div>
    <div id="session-alert"></div>
    <div id="domestic-adventure-area"></div>`;

  const stepFromUrl = readAdventureStepFromUrl();
  if (stepFromUrl) {
    await openDomesticAdventure(stepFromUrl, true);
    return;
  }
  await openDomesticAdventure();
}
window.openDomestic = openDomestic;

async function openDomesticAdventure(stepFromUrl = null, replaceUrl = false) {
  const host = el('domestic-adventure-area');
  if (!host) return;
  host.innerHTML = '<div class="card"><p style="color:var(--text2)">Loading adventure…</p></div>';

  try {
    if (!State.domesticAdventure) {
      State.domesticAdventure = await api.getDomesticAdventure();
    }
    if (!State.domesticProgressLoaded) {
      const progress = await api.getDomesticProgress();
      State.domesticSavedStep = progress && Number.isInteger(progress.current_step) ? progress.current_step : null;
      State.domesticProgressLoaded = true;
    }
    if (!State.domesticSheetLoaded) {
      State.domesticSheet = await loadDomesticSheetState();
      State.domesticSheetLoaded = true;
    }
  } catch (e) {
    host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }

  const adventure = State.domesticAdventure;
  const requestedStep = stepFromUrl || State.domesticCurrentStep || State.domesticSavedStep || adventure.startStep;
  const step = adventure.steps.find((entry) => entry.step === requestedStep) || adventure.steps.find((entry) => entry.step === adventure.startStep);
  State.domesticCurrentStep = step.step;
  queueDomesticProgressSave(step.step);
  updateAdventureStepInUrl(step.step, replaceUrl);

  host.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(adventure.title)} — Step ${step.step}</div>
        </div>
      </div>
      <div class="adventure-description">${formatAdventureText(step.description)}</div>
      <div style="margin-top:1rem">
        <div class="card-sub" style="margin-bottom:0.45rem">Forward actions</div>
        <div class="adventure-actions">
          ${step.actions.length === 0
            ? '<span style="color:var(--text2)">No forward actions parsed for this step.</span>'
            : step.actions.map((action) => `<button class=\"btn btn-primary\" onclick=\"openDomesticAdventure(${action.target})\">${esc(action.label)}</button>`).join('')}
        </div>
      </div>
      <div style="margin-top:1rem">
        <div class="card-sub" style="margin-bottom:0.45rem">Earlier trace links</div>
        <div class="adventure-actions">
          ${step.tracebacks.length === 0
            ? '<span style="color:var(--text2)">No prior trace links listed.</span>'
            : step.tracebacks.map((target) => `<button class=\"btn btn-subtle\" onclick=\"openDomesticAdventure(${target})\">Back to ${target}</button>`).join('')}
        </div>
      </div>
      <div class="card-sub" style="margin-top:1rem">Build and track your character stats below while you play.</div>
      <div id="domestic-sheet"></div>
      <div class="sheet-actions">
        <button class="btn btn-primary" onclick="saveDomesticSheet()">Save sheet</button>
        <button class="btn" onclick="resetDomesticSheet()">Reset adventure</button>
        <span class="save-status" id="domestic-sheet-status"></span>
      </div>
    </div>`;

  const sheetHost = el('domestic-sheet');
  SheetForm.setRuleset('rol');
  SheetForm.render(sheetHost, State.domesticSheet || {}, false);
  attachDomesticSheetPersistence(sheetHost);
}
window.openDomesticAdventure = openDomesticAdventure;

function formatAdventureText(value) {
  // Extract markdown image refs (![alt](src)) and replace with placeholders so
  // the surrounding text can be safely escaped without mangling the tag.
  const images = [];
  const placeholder = (i) => `\u0000IMG${i}\u0000`;
  const text = String(value || '').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const i = images.length;
    images.push({ alt, src });
    return placeholder(i);
  });

  let html = esc(text)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';

  html = html.replace(/\u0000IMG(\d+)\u0000/g, (_, idx) => {
    const img = images[Number(idx)];
    const srcPath = String(img.src || '').replace(/^\/+/, '');
    const encoded = srcPath.split('/').map(encodeURIComponent).join('/');
    return `<img class="adventure-image" src="/rules-files/${encoded}" alt="${esc(img.alt)}" style="max-width:100%;height:auto;display:block;margin:0.75rem auto;">`;
  });

  return html;
}

async function loadDomesticSheetState() {
  const serverSheet = await api.getDomesticSheet();
  return (serverSheet && serverSheet.data) || {};
}

async function persistDomesticSheet(data, pendingLabel = 'Saving adventure sheet…') {
  State.domesticSheet = data || {};
  setDomesticSheetStatus(pendingLabel);
  try {
    State.domesticSaveInflight = api.saveDomesticSheet(State.domesticSheet);
    await State.domesticSaveInflight;
    setDomesticSheetStatus('Adventure sheet saved', 'saved');
  } catch (e) {
    setDomesticSheetStatus('Unable to save adventure sheet', 'error');
    throw e;
  } finally {
    State.domesticSaveInflight = null;
  }
}

function queueDomesticProgressSave(step) {
  if (!Number.isInteger(step) || State.domesticSavedStep === step) return;
  State.domesticSavedStep = step;
  api.saveDomesticProgress(step).catch((e) => {
    console.error('Unable to save Domestic progress:', e);
    if (State.domesticSavedStep === step) State.domesticSavedStep = null;
  });
}

function attachDomesticSheetPersistence(host) {
  if (!host) return;
  const onChange = () => {
    try {
      const data = SheetForm.collect();
      State.domesticSheet = data;
      if (State.domesticSaveTimer) clearTimeout(State.domesticSaveTimer);
      State.domesticSaveTimer = window.setTimeout(async () => {
        State.domesticSaveTimer = null;
        try {
          await persistDomesticSheet(State.domesticSheet);
        } catch {}
      }, 350);
    } catch {
      setDomesticSheetStatus('Unable to save adventure sheet', 'error');
    }
  };
  host.querySelectorAll('input, textarea, select').forEach((field) => {
    field.addEventListener('change', onChange);
    field.addEventListener('input', onChange);
  });
}

async function saveDomesticSheet() {
  await waitForDomesticPersistence();
  try {
    const data = SheetForm.collect();
    await persistDomesticSheet(data, 'Saving…');
  } catch {}
}
window.saveDomesticSheet = saveDomesticSheet;

async function resetDomesticSheet() {
  const startStep = (State.domesticAdventure && State.domesticAdventure.startStep) || 1;
  setDomesticSheetStatus('Resetting adventure…');
  await waitForDomesticPersistence();
  await Promise.all([
    api.deleteDomesticSheet(),
    api.saveDomesticProgress(startStep)
  ]);
  resetDomesticRuntimeState({ preserveAdventure: true });
  await openDomesticAdventure(startStep, true);
}
window.resetDomesticSheet = resetDomesticSheet;

// ── Accounts tab (GM) ─────────────────────────────────────────────────────────
async function renderAdminAccounts() {
  const host = el('admin-content');
  if (!host) return;
  host.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading…</p>';
  try {
    const [users, sessions] = await Promise.all([api.getUsers(), api.getSessions()]);
    State.users = users;
    State.sessions = sessions;
  } catch (e) {
    host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }

  host.innerHTML = `
    <div class="page-header">
      <h2>Accounts</h2>
      <button class="btn btn-primary" onclick="openCreateUser()">+ New account</button>
    </div>
    <div id="users-alert"></div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Cases</th><th>Created</th><th></th></tr></thead>
          <tbody>
            ${State.users.map(u => `
              <tr>
                <td><strong>${esc(u.username)}</strong></td>
                <td>${u.role === 'gm' ? '<span class="badge-gm">GM</span>' : 'Player'}</td>
                <td style="color:var(--text2);font-size:0.85rem">${esc(((u.sessions || []).map(s => s.name).join(', ')) || 'None')}</td>
                <td style="color:var(--text2);font-size:0.82rem">${new Date(u.created_at).toLocaleDateString('en-GB')}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-sm" onclick="openUserCases(${u.id})">Cases…</button>
                  <button class="btn btn-sm" onclick="openChangePassword(${u.id},'${esc(u.username)}')">Change password</button>
                  ${u.id !== State.user.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">Delete</button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openCreateUser() {
  modal(`
    <h3>New account</h3>
    <div id="modal-alert"></div>
    <div class="form-group"><label>Username</label><input type="text" id="m-uname" autocapitalize="none"></div>
    <div class="form-group"><label>Password</label><input type="password" id="m-upass"></div>
    <div class="form-group">
      <label>Role</label>
      <select id="m-urole">
        <option value="player">Player</option>
        <option value="gm">GM</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="createUser(this)">Create</button>
    </div>`);
}
window.openCreateUser = openCreateUser;

async function createUser(btn) {
  const username = el('m-uname').value.trim();
  const password = el('m-upass').value;
  const role = el('m-urole').value;
  if (!username || !password) return showAlert('Username and password required', 'danger', 'modal-alert');
  if (password.length < 8) return showAlert('Password must be at least 8 characters', 'danger', 'modal-alert');
  btn.disabled = true;
  try {
    await api.createUser({ username, password, role });
    btn.closest('.modal-backdrop').remove();
    await renderAdminAccounts();
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.createUser = createUser;

function openChangePassword(userId, username) {
  modal(`
    <h3>Change password — ${esc(username)}</h3>
    <div id="modal-alert"></div>
    <div class="form-group"><label>New password</label><input type="password" id="m-newpass"></div>
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="changePassword(${userId},this)">Update</button>
    </div>`);
}
window.openChangePassword = openChangePassword;

async function changePassword(userId, btn) {
  const password = el('m-newpass').value;
  if (password.length < 8) return showAlert('Password must be at least 8 characters', 'danger', 'modal-alert');
  btn.disabled = true;
  try {
    await api.updatePassword(userId, password);
    btn.closest('.modal-backdrop').remove();
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.changePassword = changePassword;

async function gmSaveSheet(sessionId, userId) {
  const status = el('save-status');
  status.textContent = 'Saving…';
  status.className = 'save-status';
  try {
    const data = SheetForm.collect();
    await api.saveSheet(sessionId, userId, data);
    // Keep the in-memory sheetMap current so switching between players doesn't revert to stale data
    if (window.gmSheetMap) window.gmSheetMap[userId] = { data };
    status.textContent = '✓ Saved';
    status.className = 'save-status saved';
  } catch (e) {
    status.textContent = '✕ ' + e.message;
    status.className = 'save-status error';
  }
}
window.gmSaveSheet = gmSaveSheet;

async function deleteUser(id) {
  if (!confirm('Delete this account? This will also remove their character sheets.')) return;
  try {
    await api.deleteUser(id);
    await renderAdminAccounts();
  } catch (e) { showAlert(e.message, 'danger', 'users-alert'); }
}
window.deleteUser = deleteUser;

// Make tab functions global
window.switchTab = switchTab;
window.loadSessionsTab = loadSessionsTab;
window.openSession = openSession;
window.openCreateSession = openCreateSession;
window.openEditSession = openEditSession;
window.updateSession = updateSession;
window.createSession = createSession;
window.deleteSession = deleteSession;
window.doLogout = doLogout;

// Start
init();
