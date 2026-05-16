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
  await restoreUiFromUrl(true);
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
            <tr><th>Player</th><th>Character</th><th>Condition</th><th>Resources</th><th>Notable skills</th><th>Weapons</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${rows.map((r) => {
              const d = r.d || {};
              return `<tr>
                <td><strong>${esc(r.col1 || '—')}</strong></td>
                <td>${esc(r.name || d.name || '—')}</td>
                <td>${esc(summarizeCondition(d))}</td>
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
  if (!gmChatState[sessionId]) gmChatState[sessionId] = { messages: [], streaming: false, controller: null };
  return gmChatState[sessionId];
}

function gmChatLogHtml(sessionId) {
  const st = gmChat(sessionId);
  if (!st.messages.length) {
    return '<div class="empty" style="padding:1.5rem"><p>Ask for plot ideas, NPC motives, the next beat, contingencies… This chat sees the full GM material for this case and is never shown to players.</p></div>';
  }
  return st.messages.map((m) => {
    const who = m.role === 'user' ? 'You' : 'Assistant';
    const body = esc(m.content || '') + (m.streaming ? '<span class="gmchat-caret">▍</span>' : '');
    return `<div class="gmchat-msg gmchat-${m.role}"><div class="gmchat-who">${who}</div><div class="gmchat-body">${body || '<em style="color:var(--text2)">…</em>'}</div></div>`;
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
      <button class="btn btn-sm" onclick="clearGmChat(${sessionId})">Clear</button>
    </div>
    <div id="gmchat-alert"></div>
    <div class="gmchat-log" id="gmchat-log"></div>
    <div class="gmchat-compose">
      <textarea id="gmchat-text" rows="3" placeholder="Ask for ideas, NPC motives, the next beat, a twist, contingencies…" onkeydown="gmChatKey(event, ${sessionId})"></textarea>
      <div class="gmchat-actions">
        <button class="btn btn-primary" id="gmchat-send" onclick="sendGmChat(${sessionId})">Send</button>
        <button class="btn" id="gmchat-stop" onclick="stopGmChat(${sessionId})" style="display:none">Stop</button>
      </div>
    </div>`;
  renderGmChatLog(sessionId);
  setGmChatStreaming(st.streaming);
}

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
  textEl.value = '';
  st.messages.push({ role: 'user', content: text });
  const reply = { role: 'assistant', content: '', streaming: true };
  st.messages.push(reply);
  renderGmChatLog(sessionId);

  const payload = st.messages.slice(0, -1).map(({ role, content }) => ({ role, content }));
  st.controller = new AbortController();
  st.streaming = true;
  setGmChatStreaming(true);
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
      else if (obj.error) { showAlert(obj.error, 'danger', 'gmchat-alert'); }
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
    if (e.name !== 'AbortError') showAlert(e.message || 'Chat failed', 'danger', 'gmchat-alert');
  } finally {
    reply.streaming = false;
    if (!reply.content) st.messages = st.messages.filter((m) => m !== reply);
    st.streaming = false;
    st.controller = null;
    setGmChatStreaming(false);
    renderGmChatLog(sessionId);
  }
}
window.sendGmChat = sendGmChat;

function stopGmChat(sessionId) {
  const st = gmChat(sessionId);
  if (st.controller) st.controller.abort();
}
window.stopGmChat = stopGmChat;

function clearGmChat(sessionId) {
  const st = gmChat(sessionId);
  if (st.streaming) return;
  if (!st.messages.length || confirm('Clear this chat?')) {
    st.messages = [];
    renderGmChatLog(sessionId);
  }
}
window.clearGmChat = clearGmChat;

async function renderSessionOverview(sessionId) {
  const content = el('session-content');
  if (!content) return;
  content.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading overview…</p>';
  let players;
  let sheets;
  let npcs;
  try {
    [players, sheets, npcs] = await Promise.all([
      api.getSessionPlayers(sessionId),
      api.getSheets(sessionId),
      api.getNpcs(sessionId)
    ]);
  } catch (e) {
    content.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const sheetMap = {};
  sheets.forEach((s) => { sheetMap[s.user_id] = s; });
  const playerRows = players.map((p) => ({
    col1: p.username,
    name: (sheetMap[p.id] && sheetMap[p.id].data && sheetMap[p.id].data.name) || '—',
    d: (sheetMap[p.id] && sheetMap[p.id].data) || {}
  }));
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
    ${renderOverviewTable('NPCs', 'NPCs allocated to this case.', npcRows, 'No NPCs allocated to this case yet.')}`;
}

async function renderGMSessionView(sessionId, preferredUserId = null) {
  const [players, sheets] = await Promise.all([
    api.getSessionPlayers(sessionId),
    api.getSheets(sessionId)
  ]);

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
    SheetForm.render(area, sheet ? sheet.data : {}, false);
    area.insertAdjacentHTML('beforeend', `
      <div class="sheet-actions">
      <button class="btn btn-primary" onclick="gmSaveSheet(${sessionId},${userId})">Save sheet</button>
      <button class="btn" onclick="exportPdf()">Export PDF</button>
      <span class="save-status" id="save-status"></span>
    </div>`);
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

  SheetForm.render(el('sheet-form-area'), hasSheet ? sheet.data : {}, false);
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
      <button class="btn btn-sm" onclick="regenerateScenarioSection('${esc(sectionId)}', this)">Regenerate</button>
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
  return `<button class="btn btn-primary" onclick="regenerateScenarioPage(this, '${esc(sectionsCsv || '')}', '${esc(label)}')">${esc(label)}</button>`;
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

function renderGmAnalysisList(title, entries, emptyText, sectionId = '') {
  return renderScenarioSection(title, entries, emptyText, sectionId);
}

function renderGmAnalysis(info) {
  if (State.user.role !== 'gm') return '';
  const analysis = info.gm_analysis || {};
  return `
    <section class="scenario-section gm-private-analysis">
      <div class="scenario-section-header"><h3>GM Private Analysis</h3></div>
      ${analysis.error ? `<div class="alert alert-danger">${esc(analysis.error)}</div>` : ''}
      ${analysis.generated === false ? `<div class="empty scenario-empty"><p>No GM-only analysis has been generated yet.</p></div>` : ''}
      ${renderGmAnalysisList('Scenario Progress', analysis.scenario_progress, 'No progress assessment generated yet.', 'gm.scenario_progress')}
      ${renderGmAnalysisList('Plans By Player', analysis.plans_by_player, 'No player plans generated yet.', 'gm.plans_by_player')}
      ${renderGmAnalysisList('Next Deliverables', analysis.next_deliverables, 'No next deliverables generated yet.', 'gm.next_deliverables')}
      ${renderGmAnalysisList('Fairness / Engagement', analysis.fairness_engagement, 'No engagement tracking generated yet.', 'gm.fairness_engagement')}
      ${renderGmAnalysisList('Quiet Players', analysis.quiet_players, 'No quiet-player prompts generated yet.', 'gm.quiet_players')}
      ${renderGmAnalysisList('GM Actions', analysis.gm_actions, 'No GM actions generated yet.', 'gm.gm_actions')}
    </section>`;
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
          <div class="card-sub">Select one file, edit its contents, then save that file only. Revert discards unsaved edits in the editor.</div>
        </div>
      </div>
      <div class="scenario-file-editor">
        <div class="scenario-file-list" role="list">
          ${editableSources.map((source) => `
            <button type="button" data-source-index="${source.index}" class="${source.index === State.scenarioSelectedSourceIndex ? 'active' : ''}" onclick="selectScenarioSource(${source.index})">
              <span>${esc(source.relative_path || source.path || `Source ${source.index + 1}`)}</span>
              <small>${source.visibility === 'gm' ? 'GM only' : 'player-visible'}</small>
            </button>
          `).join('')}
        </div>
        <div class="scenario-file-panel">
          ${preferredIndex ? `
            <div class="scenario-file-meta">
              <strong id="scenario-source-title">${esc(preferredIndex.relative_path || preferredIndex.path || 'Source')}</strong>
              <span id="scenario-source-visibility">${preferredIndex.visibility === 'gm' ? 'GM only' : 'player-visible'}</span>
            </div>
            <textarea id="scenario-source-editor" data-source-index="${preferredIndex.index}" rows="18">${esc(preferredIndex.content || '')}</textarea>
            <div class="scenario-source-actions">
              <button class="btn btn-primary" onclick="saveSessionScenarioSources(${State.currentSession}, this)">Save file</button>
              <button class="btn" onclick="revertScenarioSourceEditor()">Revert</button>
              <span class="save-status" id="scenario-source-status"></span>
            </div>
          ` : '<div class="empty scenario-empty"><p>No editable markdown files are available.</p></div>'}
        </div>
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
  if (visibility) visibility.textContent = source.visibility === 'gm' ? 'GM only' : 'player-visible';
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

async function reloadCurrentSessionPanel() {
  if (!State.currentSession) return;
  await switchSessionPanel(State.currentSession, State.currentSessionPanel || 'case-info');
}

async function regenerateScenarioSection(sectionId, btn) {
  if (!State.currentSession) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Regenerating…';
  try {
    await api.regenerateScenarioSection(State.currentSession, sectionId);
    showAlert('Section regenerated', 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message, 'danger', 'scenario-alert');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
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
  const sections = String(sectionsCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  const body = sections.length ? { sections } : {};
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = `${label || 'Regenerating'}…`;
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
    </div>
    <div id="admin-content"><p style="color:var(--text2);padding:1rem">Loading…</p></div>`;
  await adminShow('accounts');
}
window.loadAdminTab = loadAdminTab;

async function adminShow(section) {
  document.querySelectorAll('[data-admin]').forEach((t) => t.classList.toggle('active', t.dataset.admin === section));
  if (section === 'npcs') await renderAdminNpcs();
  else await renderAdminAccounts();
}
window.adminShow = adminShow;

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
