// ── State ─────────────────────────────────────────────────────────────────────
const State = {
  user: null,
  sessions: [],
  users: [],
  currentSession: null,
  currentSheetUserId: null,
  rulesFiles: null,
  domesticAdventure: null,
  domesticCurrentStep: null,
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

function summarizeSkills(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '—';
  return skills
    .filter(s => s && s.name)
    .map(s => `${s.name}${s.value ? ` (${s.value}%)` : ''}`)
    .join(', ') || '—';
}

// ── Routing ───────────────────────────────────────────────────────────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = el(pageId);
  if (pg) pg.classList.add('active');
}

function updateAdventureStepInUrl(step, replace = false) {
  const url = new URL(window.location.href);
  if (step) {
    url.searchParams.set('adventureStep', String(step));
  } else {
    url.searchParams.delete('adventureStep');
  }
  if (replace) {
    window.history.replaceState({}, '', url.toString());
  } else {
    window.history.pushState({}, '', url.toString());
  }
}

function readAdventureStepFromUrl() {
  const value = parseInt(new URL(window.location.href).searchParams.get('adventureStep'), 10);
  return Number.isInteger(value) ? value : null;
}

// ── App init ──────────────────────────────────────────────────────────────────
async function init() {
  renderLoginPage();
  window.addEventListener('popstate', () => {
    const step = readAdventureStepFromUrl();
    if (step && el('tab-rules') && el('tab-rules').style.display !== 'none') {
      openDomesticAdventure(step, true);
    }
  });
  try {
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
        <button class="nav-tab active" data-tab="sessions" onclick="switchTab('sessions')">Sessions</button>
        <button class="nav-tab" data-tab="rules" onclick="switchTab('rules')">Rules</button>
        ${isGM ? `<button class="nav-tab" data-tab="users" onclick="switchTab('users')">Accounts</button>` : ''}
      </div>
      <div class="nav-right">
        <span class="nav-user">
          ${esc(State.user.username)}
          ${isGM ? '<span class="badge-gm">GM</span>' : ''}
        </span>
        <button class="btn btn-sm" onclick="doLogout()">Sign out</button>
      </div>
    </nav>
    <div id="tab-sessions" class="main"></div>
    <div id="tab-rules" class="main" style="display:none"></div>
    ${isGM ? `<div id="tab-users" class="main" style="display:none"></div>` : ''}`;

  showPage('main-page');
  await loadSessionsTab();
}

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['sessions','users'].forEach(t => {
    const el_ = el(`tab-${t}`);
    if (el_) el_.style.display = t === tab ? '' : 'none';
  });
  const rulesTab = el('tab-rules');
  if (rulesTab) rulesTab.style.display = tab === 'rules' ? '' : 'none';
  if (tab === 'users') loadUsersTab();
  if (tab === 'rules') loadRulesTab();
}

async function doLogout() {
  await api.logout();
  State.user = null;
  showPage('login-page');
  renderLoginPage();
}

// ── Sessions tab ──────────────────────────────────────────────────────────────
async function loadSessionsTab() {
  const tab = el('tab-sessions');
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading…</p>';
  State.sessions = await api.getSessions();

  const isGM = State.user.role === 'gm';
  tab.innerHTML = `
    <div class="page-header">
      <h2>Sessions</h2>
      ${isGM ? `<button class="btn btn-primary" onclick="openCreateSession()">+ New session</button>` : ''}
    </div>
    <div id="sessions-alert"></div>
    ${State.sessions.length === 0
      ? `<div class="empty"><div class="empty-icon">📁</div><p>No sessions yet${isGM ? ' — create one above' : ''}.</p></div>`
      : `<div class="session-grid">${State.sessions.map(renderSessionCard).join('')}</div>`
    }`;
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
    <h3>New session</h3>
    <div id="modal-alert"></div>
    <div class="form-group"><label>Session name</label><input type="text" id="m-sname" placeholder="e.g. Case 01 – The River Knows"></div>
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
    <h3>Edit session</h3>
    <div id="modal-alert"></div>
    <div class="form-group"><label>Session name</label><input type="text" id="m-sname" value="${esc(session.name)}"></div>
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
  if (!confirm('Delete this session and all its character sheets?')) return;
  try {
    await api.deleteSession(id);
    await loadSessionsTab();
  } catch (e) { showAlert(e.message, 'danger', 'sessions-alert'); }
}

// ── Session detail view ───────────────────────────────────────────────────────
async function openSession(sessionId) {
  const session = State.sessions.find(s => s.id === sessionId);
  const tab = el('tab-sessions');
  const isGM = State.user.role === 'gm';

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
    <div id="session-content"><p style="color:var(--text2)">Loading…</p></div>`;

  if (isGM) {
    await renderGMSessionView(sessionId);
  } else {
    await renderPlayerSessionView(sessionId);
  }
}

async function renderGMSessionView(sessionId) {
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

  content.innerHTML = `
    <div class="card gm-overview-pane">
      <div class="card-header">
        <div>
          <div class="card-title">Session Overview</div>
          <div class="card-sub">All characters, stats, skills, and essential items.</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th><th>Character</th><th>STR</th><th>CON</th><th>DEX</th><th>INT</th><th>POW</th><th>Speed</th><th>Luck</th><th>Skills</th><th>Essential items</th>
            </tr>
          </thead>
          <tbody>
            ${players.map((p) => {
              const d = (sheetMap[p.id] && sheetMap[p.id].data) || {};
              const allSkills = [...(d.mandatory_skills || []), ...(d.additional_skills || [])];
              return `<tr>
                <td><strong>${esc(p.username)}</strong></td>
                <td>${esc(d.name || '—')}</td>
                <td>${esc(d.str || '—')}</td>
                <td>${esc(d.con || '—')}</td>
                <td>${esc(d.dex || '—')}</td>
                <td>${esc(d.int || '—')}</td>
                <td>${esc(d.pow || '—')}</td>
                <td>${esc(d.mov || '—')}</td>
                <td>${esc(d.luck || '—')}</td>
                <td>${esc(summarizeSkills(allSkills))}</td>
                <td>${esc(d.carry || '—')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
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
    window.gmCurrentPlayerId = players[0].id;
    gmSelectSheet(players[0].id, players[0].username);
  }

  async function gmSelectSheet(userId, username) {
    window.gmCurrentPlayerId = userId;
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
    <div class="card rules-access-card">
      <div class="card-title">Rulebook files</div>
      <p class="card-sub">Open the full rules in either format.</p>
      <div class="rules-links">
        <a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(files.html)}">Open HTML Rulebook</a>
        <a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(files.markdown)}">Open Markdown Rulebook</a>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Solo Adventure: The Domestic</div>
      <p class="card-sub">Track your current step in the URL, move forward with action buttons, and step back with trace links.</p>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:0.75rem">
        <button class="btn btn-primary" onclick="openDomesticAdventure()">Play The Domestic</button>
        <a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="/rules-files/The%20Domestic.md">Open source markdown</a>
      </div>
    </div>
    <div id="domestic-adventure-area"></div>
    <div class="card">
      <div class="form-group" style="margin-bottom:0.5rem">
        <label for="rules-search-input">Search rules</label>
        <input type="text" id="rules-search-input" placeholder="e.g. chase, magic, conditions">
      </div>
      <div class="rules-search-actions">
        <button class="btn btn-primary" onclick="searchRules()">Search</button>
      </div>
      <div id="rules-search-results" class="rules-search-results"></div>
    </div>`;

  const searchInput = el('rules-search-input');
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchRules();
  });

  const stepFromUrl = readAdventureStepFromUrl();
  if (stepFromUrl) {
    openDomesticAdventure(stepFromUrl, true);
  }
}

async function searchRules() {
  const q = el('rules-search-input').value.trim();
  const resultsHost = el('rules-search-results');
  if (!q) {
    resultsHost.innerHTML = '<p style="color:var(--text2)">Enter a search term.</p>';
    return;
  }
  resultsHost.innerHTML = '<p style="color:var(--text2)">Searching…</p>';
  try {
    const response = await api.searchRules(q);
    const files = response.files || State.rulesFiles;
    State.rulesFiles = files || State.rulesFiles;
    if (!response.results || response.results.length === 0) {
      resultsHost.innerHTML = '<p style="color:var(--text2)">No matching lines found in the markdown rulebook.</p>';
      return;
    }
    resultsHost.innerHTML = `
      <p style="color:var(--text2);margin-bottom:0.75rem">Found ${response.count} matching line${response.count === 1 ? '' : 's'}.</p>
      <div class="rules-results-list">
        ${response.results.map((result) => `
          <div class="rules-result-item">
            <div class="rules-result-title">${esc(result.title)} <span>line ${result.line}</span></div>
            <p>${esc(result.snippet)}</p>
          </div>
        `).join('')}
      </div>
      ${files ? `<div style="margin-top:0.75rem"><a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(files.markdown)}">Open markdown source</a></div>` : ''}`;
  } catch (e) {
    resultsHost.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
  }
}
window.searchRules = searchRules;

async function openDomesticAdventure(stepFromUrl = null, replaceUrl = false) {
  const host = el('domestic-adventure-area');
  if (!host) return;
  host.innerHTML = '<div class="card"><p style="color:var(--text2)">Loading adventure…</p></div>';

  try {
    if (!State.domesticAdventure) {
      State.domesticAdventure = await api.getDomesticAdventure();
    }
  } catch (e) {
    host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }

  const adventure = State.domesticAdventure;
  const requestedStep = stepFromUrl || State.domesticCurrentStep || adventure.startStep;
  const step = adventure.steps.find((entry) => entry.step === requestedStep) || adventure.steps.find((entry) => entry.step === adventure.startStep);
  State.domesticCurrentStep = step.step;
  updateAdventureStepInUrl(step.step, replaceUrl);

  host.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(adventure.title)} — Step ${step.step}</div>
          <div class="card-sub">${adventure.totalSteps} total steps. You can bookmark this page to return to this exact step.</div>
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
        <button class="btn" onclick="resetDomesticSheet()">Reset adventure sheet</button>
        <span class="save-status" id="domestic-sheet-status"></span>
      </div>
    </div>`;

  const sheetHost = el('domestic-sheet');
  const savedSheet = loadDomesticSheetState();
  SheetForm.render(sheetHost, savedSheet, false);
  attachDomesticSheetPersistence(sheetHost);
}
window.openDomesticAdventure = openDomesticAdventure;

function formatAdventureText(value) {
  return esc(value).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>').replace(/^/, '<p>').replace(/$/, '</p>');
}

function domesticStorageKey() {
  return `domestic_sheet_${State.user ? State.user.id : 'anon'}`;
}

function loadDomesticSheetState() {
  try {
    const raw = localStorage.getItem(domesticStorageKey());
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function attachDomesticSheetPersistence(host) {
  const status = el('domestic-sheet-status');
  if (!host) return;
  const onChange = () => {
    try {
      const data = SheetForm.collect();
      localStorage.setItem(domesticStorageKey(), JSON.stringify(data));
      if (status) status.textContent = 'Adventure sheet saved locally';
    } catch {
      if (status) status.textContent = 'Unable to save local adventure sheet';
    }
  };
  host.querySelectorAll('input, textarea, select').forEach((field) => {
    field.addEventListener('change', onChange);
    field.addEventListener('input', onChange);
  });
}

function resetDomesticSheet() {
  localStorage.removeItem(domesticStorageKey());
  openDomesticAdventure(State.domesticCurrentStep, true);
}
window.resetDomesticSheet = resetDomesticSheet;

// ── Accounts tab (GM) ─────────────────────────────────────────────────────────
async function loadUsersTab() {
  const tab = el('tab-users');
  if (!tab) return;
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading…</p>';
  State.users = await api.getUsers();

  tab.innerHTML = `
    <div class="page-header">
      <h2>Accounts</h2>
      <button class="btn btn-primary" onclick="openCreateUser()">+ New account</button>
    </div>
    <div id="users-alert"></div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Created</th><th></th></tr></thead>
          <tbody>
            ${State.users.map(u => `
              <tr>
                <td><strong>${esc(u.username)}</strong></td>
                <td>${u.role === 'gm' ? '<span class="badge-gm">GM</span>' : 'Player'}</td>
                <td style="color:var(--text2);font-size:0.82rem">${new Date(u.created_at).toLocaleDateString('en-GB')}</td>
                <td style="text-align:right">
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
    await loadUsersTab();
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
    await loadUsersTab();
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
