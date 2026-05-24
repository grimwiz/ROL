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
  rulesChat: { messages: [], streaming: false, controller: null },
  aiSupportMode: {},  // per-session GM AI Support mode: 'gm' (default) | 'rules'
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
  llmStatusTitle: 'An AI task is running (only one runs at a time on the shared GPU)',
  llmCanCancel: false,
  llmLastSection: null,
  activeRegen: null,
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
const APP_TABS = ['sessions', 'rules', 'admin', 'about'];

// Project / build metadata surfaced in the About tab. Edit the blurb and links
// here — `buildRef`/`buildDate` track the deployed commit.
const APP_METADATA = {
  authorPortrait: '/ROL.jpg',
  donationUrl: 'https://donate.stripe.com/aFa14o8Fv4waa8Td4mbV600',
  repositoryUrl: 'https://github.com/grimwiz/ROL',
  repositoryLabel: 'github.com/grimwiz/ROL',
  inspirationUrl: 'https://rivers-of-london.com/',
  licenseName: 'Apache License 2.0',
  buildRef: 'd93d147',
  buildDate: '2026-05-17T21:43:59+01:00'
};

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

  const allowedTabs = new Set(['sessions', 'rules', 'admin', 'about']);
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

// ── Theme: Auto / Light / Dark (P1 dual-theme) ───────────────────────────────
// The no-FOUC bootstrap in index.html resolves the theme before CSS paints.
// This module owns the in-app toggle, persistence, and live OS reaction.
const THEME_KEY = 'folly-theme';
const THEME_COLOR = { dark: '#15131f', light: '#f6f5f9' };
const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="12" r="5"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></g></svg>',
  dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
};
const THEME_LABELS = { auto: 'Theme: Auto (follows system)', light: 'Theme: Light', dark: 'Theme: Dark' };
let themeMqlBound = false;
function getThemePref() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
function setThemePref(p) { try { localStorage.setItem(THEME_KEY, p); } catch { /* private mode */ } }
function resolveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
}
function applyTheme() {
  const pref = getThemePref();
  const effective = resolveTheme(pref);
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.setAttribute('content', THEME_COLOR[effective]);
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = THEME_ICONS[pref];
    btn.setAttribute('aria-label', THEME_LABELS[pref]);
    btn.setAttribute('title', THEME_LABELS[pref]);
    btn.setAttribute('aria-pressed', pref === 'dark' ? 'true' : 'false');
    btn.dataset.themePref = pref;
  }
  if (!themeMqlBound && window.matchMedia) {
    const mql = matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (getThemePref() === 'auto') applyTheme(); };
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
    themeMqlBound = true;
  }
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  setThemePref(order[(order.indexOf(getThemePref()) + 1) % order.length]);
  applyTheme();
}
window.cycleTheme = cycleTheme;

// ── Login ─────────────────────────────────────────────────────────────────────
function renderLoginPage() {
  const app = el('app');
  el('loading-screen') && el('loading-screen').remove();
  if (!el('login-page')) {
    const div = document.createElement('div');
    div.id = 'login-page';
    div.className = 'page login-page';
    div.innerHTML = `
      <div class="login-bg" aria-hidden="true"></div>
      <div class="login-card">
        <div class="login-header">
          <svg class="brand-mark lg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <path d="M20 50V30a12 12 0 0 1 24 0v20" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
            <line x1="15" y1="50" x2="49" y2="50" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            <path d="M32 23c2.7 2.5 4.2 4.9 4.2 7.3a4.2 4.2 0 0 1-8.4 0c0-1 .4-2.1 1.3-3.3C30.4 25.9 31.5 24.4 32 23Z" fill="currentColor"/>
            <circle cx="32" cy="13" r="2.3" fill="currentColor" opacity="0.6"/>
          </svg>
          <h1>The Folly</h1>
          <p>Investigator Case Files</p>
        </div>
        <div id="login-alert"></div>
        <form id="login-form" autocomplete="on">
          <div class="form-group">
            <label>Username</label>
            <input type="text" id="login-user" name="username" autocomplete="username" autocapitalize="none">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="login-pass" name="password" autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary btn-full" id="login-btn">Sign in</button>
        </form>
      </div>`;
    app.appendChild(div);
  }
  showPage('login-page');

  const btn = el('login-btn');
  const form = el('login-form');
  const doLogin = async () => {
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      resetUserScopedState();
      const u = el('login-user'); const p = el('login-pass');
      State.user = await api.login(u.value, p.value);
      // Clear inputs immediately on success so password managers (Bitwarden
      // etc.) that finalise the save on the form's submit event don't see
      // hanging credentials and queue a prompt to fire on a later button.
      try { u.value = ''; p.value = ''; } catch (_) { /* best-effort */ }
      await renderMain();
      // renderMain() also removes #login-page (covers session-restore path
      // too); leaving this here is idempotent and harmless.
      const loginPage = el('login-page');
      if (loginPage) loginPage.remove();
    } catch (e) {
      showAlert(e.message, 'danger', 'login-alert');
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  };
  // Submit on Enter or button click dispatches a real submit event — the
  // signal password managers use to confirm a login completed.
  form.addEventListener('submit', (e) => { e.preventDefault(); doLogin(); });
}

// ── Main shell ────────────────────────────────────────────────────────────────
async function renderMain() {
  const app = el('app');
  el('loading-screen') && el('loading-screen').remove();
  // Remove the login form from the DOM regardless of how we got here (fresh
  // login OR session-restore on refresh) so password managers never see a
  // hidden login form and misread later button clicks as a re-submit.
  el('login-page') && el('login-page').remove();
  if (!el('main-page')) {
    const div = document.createElement('div');
    div.id = 'main-page';
    div.className = 'page';
    app.appendChild(div);
  }

  const isGM = State.user.role === 'gm';

  el('main-page').innerHTML = `
    <nav class="nav">
      <div class="nav-brand">
        <svg class="brand-mark sm" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <path d="M20 50V30a12 12 0 0 1 24 0v20" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
          <line x1="15" y1="50" x2="49" y2="50" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          <path d="M32 23c2.7 2.5 4.2 4.9 4.2 7.3a4.2 4.2 0 0 1-8.4 0c0-1 .4-2.1 1.3-3.3C30.4 25.9 31.5 24.4 32 23Z" fill="currentColor"/>
          <circle cx="32" cy="13" r="2.3" fill="currentColor" opacity="0.6"/>
        </svg>
        <span>The Folly</span>
      </div>
      <div class="nav-tabs">
        <button class="nav-tab active" data-tab="sessions" onclick="switchTab('sessions')">Case Files</button>
        <button class="nav-tab" data-tab="rules" onclick="switchTab('rules')">Rules</button>
        ${isGM ? `<button class="nav-tab" data-tab="admin" onclick="switchTab('admin')">Admin</button>` : ''}
        <button class="nav-tab" data-tab="about" onclick="switchTab('about')">About</button>
      </div>
      <div class="nav-right">
        <button id="theme-toggle" class="theme-toggle" type="button" onclick="cycleTheme()" aria-label="Theme: change" title="Theme"></button>
        <span id="nav-llm-status" class="llm-status" hidden title="An AI task is running (only one runs at a time on the shared GPU)">
          <span class="llm-dot"></span><span class="llm-text">AI working…</span>
          ${isGM ? '<button type="button" class="llm-stop" onclick="stopActiveRegen()" hidden>Stop</button>' : ''}
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
    ${isGM ? `<div id="tab-admin" class="main" style="display:none"></div>` : ''}
    <div id="tab-about" class="main" style="display:none"></div>`;

  showPage('main-page');
  applyTheme();
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
  const serverCanCancel = !!(status && status.can_cancel && status.kind !== 'image');
  State.llmCanCancel = !!State.activeRegen || serverCanCancel;
  if (status && status.last_section) State.llmLastSection = status.last_section;
  else if (!busy) State.llmLastSection = null;
  const box = el('nav-llm-status');
  if (box) {
    box.hidden = !busy;
    const txt = box.querySelector('.llm-text');
    if (txt) {
      const activeStatus = State.activeRegen && State.activeRegen.status
        ? String(State.activeRegen.status).replace(/^Stop\s+·\s*/, '').trim()
        : '';
      const activeLabel = activeStatus || (State.activeRegen && State.activeRegen.label);
      const statusLabel = (status && status.last_section) || State.llmLastSection;
      const where = activeLabel || statusLabel ? ` · ${activeLabel || statusLabel}` : '';
      txt.textContent = `AI working${where}`;
    }
    const stop = box.querySelector('.llm-stop');
    if (stop) stop.hidden = !State.llmCanCancel;
    const ps = status && status.ps;
    if (ps && ps.name) {
      const split = ps.cpu_pct ? `${ps.gpu_pct}% GPU/${ps.cpu_pct}% CPU` : `${ps.gpu_pct}% GPU`;
      const vram = ps.vram_gb != null ? ` · ${ps.vram_gb}GB VRAM` : '';
      State.llmStatusTitle = `${ps.name} · ${split}${ps.ctx ? ` · ctx ${ps.ctx}` : ''}${vram}`;
    }
    box.title = State.llmStatusTitle;
  }
  document.querySelectorAll('.js-regen').forEach((b) => {
    if (busy && State.llmCanCancel) {
      if (!b.dataset.regenOriginal) b.dataset.regenOriginal = b.textContent;
      b.disabled = false;
      b.dataset.stopBtn = '1';
      b.textContent = (State.activeRegen && State.activeRegen.status)
        || (State.llmLastSection ? `Stop · ${State.llmLastSection}` : 'Stop');
      return;
    }
    if (b.dataset.regenOriginal) {
      b.textContent = b.dataset.regenOriginal;
      delete b.dataset.regenOriginal;
    }
    if (busy) {
      if (!b.disabled) { b.disabled = true; b.dataset.llmDisabled = '1'; }
    } else if (b.dataset.llmDisabled) {
      b.disabled = false;
      delete b.dataset.llmDisabled;
    }
    if (b.dataset.stopBtn) delete b.dataset.stopBtn;
  });
}

async function stopActiveRegen() {
  const active = State.activeRegen;
  const label = (active && active.label) || State.llmLastSection || 'language model';
  if (active) active.status = `Stopping · ${label}`;
  applyLlmBusyUI({ busy: true, kind: 'llm', can_cancel: true, last_section: label });
  try {
    await api.cancelLlm();
  } catch (e) {
    showAlert(e.message || 'Could not stop the language model', 'danger', 'scenario-alert');
  } finally {
    if (active && active.controller) {
      try { active.controller.abort(); } catch (_) {}
    }
    pollLlmStatusOnce();
  }
}
window.stopActiveRegen = stopActiveRegen;

async function pollLlmStatusOnce() {
  try {
    const status = await api.getLlmStatus();
    applyLlmBusyUI(status);
    if (status && status.busy) ensureLlmPolling();
    else if (State.llmLocalPending === 0) stopLlmPolling();
  } catch { /* transient — keep last known state */ }
}

// Strict polling: one poll at login, then keep polling while this browser has
// an AI operation in flight or the server reports one.
function startLlmStatusPolling() {
  pollLlmStatusOnce(); // one-shot at login; no interval while idle
}
function ensureLlmPolling() {
  if (State.llmPollTimer) return;
  State.llmPollTimer = setInterval(pollLlmStatusOnce, 3000);
}
function stopLlmPolling() {
  if (!State.llmPollTimer) return;
  clearInterval(State.llmPollTimer);
  State.llmPollTimer = null;
}

// Bracket a locally-initiated LLM operation so the busy indicator shows
// instantly and stays until it actually finishes (consistent everywhere:
// regenerate pages/sections and GM Chat).
function llmPendingBegin(label) {
  State.llmLocalPending += 1;
  applyLlmBusyUI({ busy: true, last_section: label || null });
  ensureLlmPolling();
  pollLlmStatusOnce();
}
function llmPendingEnd() {
  State.llmLocalPending = Math.max(0, State.llmLocalPending - 1);
  if (State.llmLocalPending === 0) stopLlmPolling();
  pollLlmStatusOnce(); // final refresh so the badge clears when the op ends
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
  if (tab === 'about') loadAboutTab();
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
  const builtIn = !!s.system_key;
  // Optional cover: a graphic in the session Gallery whose stem matches the
  // session name (server-resolved per-viewer; null when none exists).
  const cover = s.cover_image
    ? `<img class="session-cover" src="${esc(scenarioAssetUrl(s.cover_image, s.id))}" alt="${esc(s.name)}" loading="lazy">`
    : '';
  const actions = isGM
    ? (builtIn
      ? `<div style="display:flex;gap:0.5rem">
        <button class="btn btn-sm" onclick="event.stopPropagation();resetCanonicalSession(${s.id})">Reset</button>
      </div>`
      : `<div style="display:flex;gap:0.5rem">
        <button class="btn btn-sm" onclick="event.stopPropagation();openEditSession(${s.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteSession(${s.id})">Delete</button>
      </div>`)
    : '';
  return `<div class="card session-card" onclick="openSession(${s.id})">
    <div class="card-header">
      <div>
        <div class="card-title">${esc(s.name)}</div>
        ${s.description ? `<div class="card-sub">${esc(s.description)}</div>` : ''}
      </div>
      ${actions}
    </div>
    ${isGM ? `<p class="player-count">${builtIn ? 'Built-in test case' : `👥 ${s.player_count || 0} player${s.player_count !== 1 ? 's' : ''}`}</p>` : ''}
    ${cover}
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

async function resetCanonicalSession(id) {
  if (!confirm('Reset this built-in case from its canonical copy? Local edits to seeded files will be overwritten.')) return;
  try {
    const result = await api.resetCanonicalSession(id);
    await loadSessionsTab({ skipUrlUpdate: true });
    const npcBits = result.npcs ? ` NPCs: ${result.npcs.allocated || 0} allocated, ${result.npcs.seeded || 0} seeded.` : '';
    showAlert(`Reset complete: ${result.copied || 0} file${result.copied === 1 ? '' : 's'} restored.${npcBits}`, 'success', 'sessions-alert');
  } catch (e) {
    showAlert(e.message, 'danger', 'sessions-alert');
  }
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
        <h2>${esc(session.name)}</h2>
        ${session.description ? `<p style="color:var(--text2);font-size:0.88rem">${esc(session.description)}</p>` : ''}
      </div>
    </div>
    <div id="session-alert"></div>
    <div class="sheet-tabs session-subtabs">
      ${isGM ? `<div class="sheet-tab active" data-session-panel="overview" onclick="switchSessionPanel(${sessionId}, 'overview')">Overview</div>` : ''}
      <div class="sheet-tab${isGM ? '' : ' active'}" data-session-panel="characters" onclick="switchSessionPanel(${sessionId}, 'characters')">Characters</div>
      <div class="sheet-tab" data-session-panel="case-info" onclick="switchSessionPanel(${sessionId}, 'case-info')">Case Info</div>
      ${!isGM ? `<div class="sheet-tab" data-session-panel="handouts" onclick="switchSessionPanel(${sessionId}, 'handouts')">Handouts</div>` : ''}
      <div class="sheet-tab" data-session-panel="player-info" onclick="switchSessionPanel(${sessionId}, 'player-info')">Player Stories</div>
      <div class="sheet-tab" data-session-panel="entities" onclick="switchSessionPanel(${sessionId}, 'entities')">Places/NPC/Things</div>
      ${isGM ? `<div class="sheet-tab" data-session-panel="gm-info" onclick="switchSessionPanel(${sessionId}, 'gm-info')">GM Info</div>` : ''}
      ${isGM ? `<div class="sheet-tab" data-session-panel="raw-data" onclick="switchSessionPanel(${sessionId}, 'raw-data')">Edit Files</div>` : ''}
      ${isGM ? `<div class="sheet-tab" data-session-panel="npcs" onclick="switchSessionPanel(${sessionId}, 'npcs')">NPCs</div>` : ''}
      <div class="sheet-tab" data-session-panel="gm-chat" onclick="switchSessionPanel(${sessionId}, 'gm-chat')">AI Support</div>
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
  try {
    if (panel === 'case-info') await renderSessionCaseInfo(sessionId);
    else if (panel === 'handouts') await renderSessionScenarioInfo(sessionId, 'raw');
    else if (panel === 'player-info') await renderSessionPlayerInfo(sessionId);
    else if (panel === 'entities') await renderSessionEntities(sessionId);
    else if (panel === 'gm-info') await renderSessionScenarioInfo(sessionId, 'gm');
    else if (panel === 'raw-data') await renderSessionScenarioInfo(sessionId, 'raw');
    else if (panel === 'npcs') await renderSessionNpcs(sessionId);
    else if (panel === 'overview') await renderSessionOverview(sessionId);
    else if (panel === 'gm-chat') await renderSessionAiSupport(sessionId);
    else await renderSessionCharacters(sessionId);
  } finally {
    applyLlmBusyUI({
      busy: State.llmBusy,
      kind: State.llmCanCancel ? 'llm' : null,
      can_cancel: State.llmCanCancel,
      last_section: (State.activeRegen && State.activeRegen.label) || State.llmLastSection
    });
  }
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

function renderAiMarkdown(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  _richSeq += 1;
  return `<div class="chat-markdown">${markdownToHtml(text, `chat${_richSeq}`).html}</div>`;
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
        inner = `<img class="gmchat-image" src="${esc(m.imageUrl)}" alt="Generated handout">`;
      } else {
        inner = `<em style="color:var(--text2)">Generating image…<span class="gmchat-caret">▍</span></em>`;
      }
      const imgActions = (!st.streaming && !m.editingPrompt && (m.imageUrl || m.error))
        ? `<div class="gmchat-msg-actions">
            <button class="btn btn-sm" onclick="regenerateGmImage(${sessionId}, ${i})" title="Run this prompt again for a fresh image">↻ Regenerate</button>
            <button class="btn btn-sm" onclick="gmImageEditStart(${sessionId}, ${i})" title="Edit the prompt and regenerate">✎ Edit prompt</button>
            ${m.imageUrl ? (m.saved
              ? `<span class="gmchat-saved">✓ Saved to ${esc(m.saved)} (GM-only) — manage player access in Edit Files</span>`
              : `<button class="btn btn-sm" onclick="saveGmHandout(${sessionId}, ${i})">💾 Save handout</button>`) : ''}
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
    const markdownBody = m.role === 'assistant';
    let body = markdownBody ? renderAiMarkdown(m.content || '') : esc(m.content || '');
    if (m.streaming) body += '<span class="gmchat-caret">▍</span>';
    if (m.kind === 'image' && m.role === 'user') body = `Image: ${body}`;
    if (m.error) body += `<div class="gmchat-error">⚠ ${esc(m.error)}</div>`;
    let actions = '';
    if (!st.streaming && m.kind !== 'image') {
      if (m.role === 'user') {
        actions = `<div class="gmchat-msg-actions"><button class="btn btn-sm" onclick="gmEditPrompt(${sessionId}, ${i})" title="Edit this prompt and resend">✎ Edit</button></div>`;
      } else if (m.role === 'assistant' && (m.content || m.error)) {
        actions = `<div class="gmchat-msg-actions"><button class="btn btn-sm" onclick="regenerateGmAnswer(${sessionId}, ${i})" title="Run this prompt again for a fresh answer">↻ Regenerate</button></div>`;
      }
    }
    return `<div class="gmchat-msg gmchat-${m.role}"><div class="gmchat-who">${who}</div><div class="gmchat-body${markdownBody ? ' gmchat-markdown-body' : ''}">${body || '<em style="color:var(--text2)">…</em>'}</div>${actions}</div>`;
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

// AI Support — role-aware dispatch with an optional GM mode toggle.
// Player: rules-chat surface (rules + their character JSON). No toggle.
// GM, mode='gm' (default): renderSessionGmChat — Brainstorm + Image + Save.
// GM, mode='rules': rules-chat surface, with a toggle back to GM Chat.
// The toggle is rendered in both GM views so the GM can always switch modes.
function aiSupportToggleHtml(sessionId, mode) {
  return `<div class="gmchat-mode" role="group" aria-label="AI Support mode">
    <button type="button" class="btn btn-sm${mode === 'gm' ? ' active' : ''}" onclick="setAiSupportMode(${sessionId}, 'gm')">💬 GM Chat</button>
    <button type="button" class="btn btn-sm${mode === 'rules' ? ' active' : ''}" onclick="setAiSupportMode(${sessionId}, 'rules')">📖 Rules</button>
  </div>`;
}

function setAiSupportMode(sessionId, mode) {
  State.aiSupportMode[sessionId] = mode === 'rules' ? 'rules' : 'gm';
  renderSessionAiSupport(sessionId);
}
window.setAiSupportMode = setAiSupportMode;

async function renderSessionAiSupport(sessionId) {
  const isGM = State.user.role === 'gm';
  const mode = State.aiSupportMode[sessionId] || 'gm';
  if (isGM && mode === 'gm') {
    return renderSessionGmChat(sessionId);
  }
  // Rules-chat panel: player path (no toggle), or GM-in-rules-mode (with toggle).
  const tab = el('session-content');
  if (!tab) return;
  const subText = isGM
    ? 'Ask rules questions. Grounded in the compact rules reference.'
    : 'Ask rules questions. Grounded in the compact rules reference and your stored character sheet.';
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>AI Support</h2>
        <p class="card-sub">${subText}</p>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        ${isGM ? aiSupportToggleHtml(sessionId, 'rules') : ''}
        <button class="btn btn-sm" onclick="clearRulesChat()">Clear</button>
      </div>
    </div>
    <div id="rules-chat-alert"></div>
    <div class="gmchat-wrap">
      <div class="gmchat-log" id="rules-chat-log"></div>
      <div class="gmchat-compose gmchat-compose-inline">
        <textarea id="rules-chat-text" rows="3" placeholder="Ask how a rule works, or how it applies${isGM ? ' to a character' : ' to your character'}…" onkeydown="rulesChatKey(event)"></textarea>
        <div class="gmchat-actions gmchat-actions-side">
          <button class="btn btn-primary" id="rules-chat-send" onclick="sendRulesChat()">Send</button>
          <button class="btn" id="rules-chat-stop" onclick="stopRulesChat()" style="display:none">Stop</button>
        </div>
      </div>
    </div>`;
  renderRulesChatLog();
  setRulesChatStreaming(State.rulesChat.streaming);
}

async function renderSessionGmChat(sessionId) {
  const tab = el('session-content');
  if (!tab) return;
  const st = gmChat(sessionId);
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>AI Support</h2>
        <p class="card-sub">Private brainstorming grounded in this case's GM material. Never shown to players; ephemeral (cleared on reload).</p>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        ${aiSupportToggleHtml(sessionId, 'gm')}
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
          <select id="gmchat-size" class="dice-select" title="Image size / ratio" style="display:none">
            <option value="portrait" selected>Portrait</option>
            <option value="landscape">Landscape</option>
            <option value="square">Square</option>
            <option value="character">Character (sheet box)</option>
            <option value="intricate">Intricate (hi-res, maps)</option>
          </select>
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
  const sizeSel = el('gmchat-size');
  if (sizeSel) sizeSel.style.display = image ? '' : 'none';
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
  const sizeSel = el('gmchat-size');
  const size = sizeSel ? sizeSel.value : 'portrait';
  st.messages.push({ role: 'user', content: prompt, kind: 'image' });
  const msg = { role: 'assistant', kind: 'image', prompt, size };
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
    const q = await api.generateHandout(sessionId, msg.prompt, msg.size);
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
      <div class="scenario-section-actions">
        <button class="btn" onclick="exportPrintDoc(${sessionId}, 'player')" title="Assemble a printable hardcopy: case info, places/NPCs/things, and each player's sheet + story">Player printable</button>
        <button class="btn" onclick="exportPrintDoc(${sessionId}, 'gm')" title="Assemble a printable hardcopy: GM info, overview, and allocated NPC sheets">GM printable</button>
      </div>
    </div>
    <div id="session-alert"></div>
    ${renderOverviewTable('Player Characters', 'Assigned players in this case.', playerRows, 'No players assigned to this case yet.')}
    ${renderOverviewTable('NPCs', 'NPCs allocated to this case.', npcRows, 'No NPCs allocated to this case yet.')}
    ${luckLedgerHtml(sessionId, (rollsData && rollsData.luck) || [])}
    ${rollHistoryHtml(sessionId, (rollsData && rollsData.rolls) || [])}`;
}

// ── Printable hardcopy export (browser Print → Save as PDF) ──────────────────
// Assembles all relevant sections into one static, print-clean document so the
// GM can Print → Save as PDF for an offline session. Sheets reuse the read-only
// Characters layout; interactive chrome is stripped by the @media print CSS.
function closePrintDoc() {
  document.body.classList.remove('print-mode');
  const d = el('print-doc'); if (d) d.remove();
  const t = el('print-toolbar'); if (t) t.remove();
}
window.closePrintDoc = closePrintDoc;
window.doPrintDoc = () => window.print();

// Inject a sheet-data portrait into every entry card whose title matches a
// known character/NPC name. Single source of truth (the sheet), one technique
// for both players and NPCs — no special cases, no reliance on Gallery files.
function injectSheetPortraits(root, portraitsByName) {
  if (!root || !portraitsByName) return;
  const norm = (s) => String(s || '').toLowerCase().trim();
  const map = {};
  Object.keys(portraitsByName).forEach((k) => { map[norm(k)] = portraitsByName[k]; });
  root.querySelectorAll('.scenario-entry-card').forEach((card) => {
    const titleEl = card.querySelector('.card-title');
    if (!titleEl) return;
    const dataUri = map[norm(titleEl.textContent)];
    if (!dataUri) return;
    if (card.querySelector('.scenario-figure')) return; // already has one
    let body = card.querySelector('.scenario-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'scenario-body';
      (card.querySelector('.card-header') || card).insertAdjacentElement('afterend', body);
    }
    const fig = document.createElement('figure');
    fig.className = 'scenario-figure sf-left';
    fig.style.setProperty('--sf-w', '30%');
    const img = document.createElement('img');
    img.src = dataUri;
    img.alt = titleEl.textContent;
    img.loading = 'lazy';
    fig.appendChild(img);
    body.insertBefore(fig, body.firstChild);
  });
}

async function exportPrintDoc(sessionId, kind) {
  closePrintDoc();
  const toolbar = document.createElement('div');
  toolbar.id = 'print-toolbar';
  toolbar.className = 'print-toolbar';
  toolbar.innerHTML = '<button class="btn btn-primary" onclick="doPrintDoc()">🖨 Print / Save PDF</button><button class="btn" onclick="closePrintDoc()">Close</button>';
  document.body.appendChild(toolbar);
  const doc = document.createElement('div');
  doc.id = 'print-doc';
  doc.className = 'print-doc';
  doc.innerHTML = '<p style="padding:2rem;color:#555">Assembling document…</p>';
  document.body.appendChild(doc);
  document.body.classList.add('print-mode');
  window.scrollTo(0, 0);

  const sheetJobs = [];
  // No .print-section wrapper here — the caller groups the sheet WITH its
  // owning heading in one section so the title isn't orphaned on its own page.
  const sheetBlock = (label, data, ruleset) => {
    const id = `pdsheet-${sheetJobs.length}`;
    sheetJobs.push({ id, data: data || {}, ruleset: ruleset || (data && data.ruleset) || 'rol' });
    return `<h3>${esc(label)}</h3><div id="${id}"></div>`;
  };

  try {
    const sess = ((typeof State === 'object' && State.sessions) || []).find((s) => s && s.id === sessionId);
    const caseName = (sess && sess.name) || `Session ${sessionId}`;
    const stamp = new Date().toLocaleString('en-GB');
    let html = '';
    const portraitsByName = {};

    if (kind === 'player') {
      const base = await loadScenarioInfo(sessionId);
      const [players, sheets, npcs] = await Promise.all([
        api.getSessionPlayers(sessionId),
        api.getSheets(sessionId),
        api.getNpcs(sessionId)
      ]);
      const sheetByUser = {};
      sheets.forEach((s) => { sheetByUser[s.user_id] = s; });
      // Unified portrait source: the sheet. Player characters' portraits live
      // on their sheet.data.portrait; NPC portraits on npc.sheet.portrait. One
      // map keyed by name → data URI, used by injectSheetPortraits below.
      sheets.forEach((s) => { const d = s && s.data; if (d && d.name && d.portrait) portraitsByName[d.name] = d.portrait; });
      npcs.forEach((n) => { if (n && n.name && n.sheet && n.sheet.portrait) portraitsByName[n.name] = n.sheet.portrait; });
      const summary = base.summary || {};
      const whatHappened = summary.what_has_happened || base.what_has_happened;
      const sessions = scenarioArray(summary.session_summaries);
      const ent = base.entities || {};
      setScenarioImages(base.source_files);
      html += `<div class="print-cover"><h1>${esc(caseName)}</h1><p>Player hardcopy — ${esc(stamp)}</p></div>`;
      html += `<div class="print-section"><h2>Case Info</h2>${renderWhatHappenedSection(whatHappened, false)}${renderSessionAnalysis(sessions, false)}</div>`;
      html += `<div class="print-section"><h2>Places / NPCs / Things</h2>
        ${renderScenarioSection('Places', ent.locations || base.locations, 'No places generated.', '', false)}
        ${renderScenarioSection('NPCs', ent.npcs || base.npcs, 'No NPCs generated.', '', false)}
        ${renderScenarioSection('Things', ent.items || base.items, 'No things generated.', '', false)}</div>`;
      for (const p of players) {
        let info = null;
        try { info = await api.getSessionScenarioInfo(sessionId, p.id); } catch (_) { info = null; }
        const vNames = (info && info.viewer && info.viewer.character_names) || [];
        const mine = info ? scenarioArray(info.entities && info.entities.characters).filter((c) => matchesCharacter(c, vNames)) : [];
        if (info) setScenarioImages(info.source_files);
        const sh = sheetByUser[p.id];
        // One section per player: name + sheet + story stay together (page
        // break before the player, not between their title and sheet).
        html += `<div class="print-section">
          <h2>${esc(p.username)}${vNames.length ? ` — ${esc(vNames.join(', '))}` : ''}</h2>
          ${sheetBlock(`${p.username} — Character Sheet`, sh && sh.data, sh && sh.ruleset)}
          ${renderScenarioSection('Player Story', mine, 'No story generated for this player.', '', false)}
        </div>`;
      }
    } else {
      const base = await loadScenarioInfo(sessionId);
      const [players, sheets, npcs, rollsData] = await Promise.all([
        api.getSessionPlayers(sessionId),
        api.getSheets(sessionId),
        api.getNpcs(sessionId),
        api.getSessionRolls(sessionId).catch(() => ({}))
      ]);
      const sheetMap = {}; sheets.forEach((s) => { sheetMap[s.user_id] = s; });
      const luckByUser = {}; ((rollsData && rollsData.luck) || []).forEach((l) => { luckByUser[l.user_id] = l; });
      const playerRows = players.map((p) => {
        const l = luckByUser[p.id];
        const wl = l && l.wounds ? WOUND_KEYS.filter((w) => l.wounds[w]).map((w) => w[0].toUpperCase() + w.slice(1)) : [];
        return { col1: p.username, name: (sheetMap[p.id] && sheetMap[p.id].data && sheetMap[p.id].data.name) || '—',
          luck: l ? `${l.effective} eff${l.spent ? ` (−${l.spent} of ${l.base})` : ''}` : null,
          wounds: wl.join(', '), d: (sheetMap[p.id] && sheetMap[p.id].data) || {} };
      });
      const npcRows = npcs.map((n) => ({ col1: (n.sheet && n.sheet.occupation) || n.role || 'NPC', name: n.name, d: n.sheet || {} }));
      setScenarioImages(base.source_files);
      html += `<div class="print-cover"><h1>${esc(caseName)}</h1><p>GM hardcopy — ${esc(stamp)}</p></div>`;
      html += `<div class="print-section"><h2>GM Info</h2>${renderGmAnalysis(base)}</div>`;
      html += `<div class="print-section"><h2>Overview</h2>
        ${renderOverviewTable('Player Characters', 'Assigned players in this case.', playerRows, 'No players assigned.')}
        ${renderOverviewTable('NPCs', 'NPCs allocated to this case.', npcRows, 'No NPCs allocated.')}</div>`;
      // Each NPC sheet is its own section/page; the group heading folds into
      // the first one so it isn't stranded on a page of its own.
      html += npcs.map((n, i) => `<div class="print-section">${i === 0 ? '<h2>Allocated NPC Character Sheets</h2>' : ''}${sheetBlock(`${n.name} — NPC Sheet`, n.sheet, n.sheet && n.sheet.ruleset)}</div>`).join('');
    }

    doc.innerHTML = html || '<p style="padding:2rem">Nothing to export.</p>';
    for (const job of sheetJobs) {
      const host = el(job.id);
      if (!host || typeof SheetForm === 'undefined') continue;
      try {
        SheetForm.setRuleset(job.ruleset || 'rol');
        SheetForm.setSessionId(sessionId);
        SheetForm.setPortraitAi(false);
        SheetForm.render(host, job.data, true);
      } catch (e) { host.innerHTML = `<p style="color:#a00">Sheet render failed: ${esc(e.message || e)}</p>`; }
    }
    injectSheetPortraits(doc, portraitsByName);
  } catch (e) {
    doc.innerHTML = `<div style="padding:2rem;color:#a00">Export failed: ${esc(e.message || e)}</div>
      <div style="padding:0 2rem"><button class="btn" onclick="closePrintDoc()">Close</button></div>`;
  }
}
window.exportPrintDoc = exportPrintDoc;

async function renderGMSessionView(sessionId, preferredUserId = null) {
  const [players, sheets, settings] = await Promise.all([
    api.getSessionPlayers(sessionId),
    api.getSheets(sessionId),
    api.getSessionSettings(sessionId).catch(() => ({ ruleset: 'rol' }))
  ]);
  const sessionRuleset = (settings && settings.ruleset) || 'rol';

  const content = el('session-content');
  if (players.length === 0) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">👥</div><p>No players assigned to this session yet.</p><button class="btn btn-primary" style="margin-top:1rem" onclick="openAssignPlayer(${sessionId})">+ Assign player</button></div>`;
    return;
  }

  const sheetMap = {};
  sheets.forEach(s => { sheetMap[s.user_id] = s; });
  window.gmSheetMap = sheetMap;

  content.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
      <div class="sheet-tabs" id="gm-sheet-tabs" style="flex:1 1 auto">
        ${players.map((p, i) => `
          <div class="sheet-tab${i===0?' active':''}" onclick="gmSelectSheet(${p.id},'${esc(p.username)}')" id="stab_${p.id}">
            ${esc(p.username)}
            ${!sheetMap[p.id] ? ' <span style="opacity:0.5;font-size:0.75rem">(empty)</span>' : ''}
          </div>`).join('')}
      </div>
      <button class="btn btn-sm" onclick="openAssignPlayer(${sessionId})" title="Assign another player to this case">+ Assign player</button>
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
    SheetForm.setSessionId(sessionId);
    SheetForm.setPortraitAi(true);
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
  SheetForm.setSessionId(sessionId);
  SheetForm.setPortraitAi(true);
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
  return /(^|\n)\s{0,3}#{1,6}\s|\*\*[^*\n]+\*\*|(^|\n)\s*(?:[-*+]|\d+\.)\s+|(^|\n)\s*>\s+|`[^`]+`|(^|\n)\s*\|.*\|\s*(?:\n|$)|!\[[^\]]*\]\([^)]+\)/.test(s);
}
function stripPara(html) {
  return String(html)
    .replace(/^\s*<div class="summary-content">([\s\S]*)<\/div>\s*$/, '$1')
    .replace(/^\s*<p>/, '')
    .replace(/<\/p>\s*$/, '');
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
  _richSeq += 1;
  return markdownToHtml(text, `t${_richSeq}`).html;
}

function scenarioAssetUrl(filePath, sessionId = State.currentSession) {
  const clean = String(filePath || '').replace(/^\/+/, '');
  return `/api/sessions/${encodeURIComponent(sessionId)}/scenario-info/assets/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

// In-scope images for the scenario being rendered, keyed by lowercased
// basename → repo path. Set from the (visibility-scoped) source_files in the
// scenario-info payload; the Markdown renderer only renders refs found here, so
// hallucinated or out-of-scope filenames are silently dropped.
// Filename layout tag: "<frac><LHS|RHS|FW>" e.g. 0.3RHS (30% right, text
// wraps), 0.5LHS (50% left), 1.0FW (full width). Default 0.3LHS.
function scenarioFigureLayout(filename) {
  const stem = String(filename || '').replace(/\.[a-z0-9]+$/i, '');
  const m = stem.match(/[-_.]?(\d(?:\.\d+)?)(rhs|lhs|fw)$/i);
  let frac = 0.3;
  let pos = 'lhs';
  if (m) { frac = parseFloat(m[1]); pos = m[2].toLowerCase(); }
  if (!Number.isFinite(frac)) frac = 0.3;
  frac = Math.min(1, Math.max(0.1, frac));
  if (pos === 'fw' || frac >= 1) return { cls: 'sf-full', style: '' };
  const pct = Math.round(frac * 100);
  return { cls: pos === 'rhs' ? 'sf-right' : 'sf-left', style: `--sf-w:${pct}%` };
}

// An entity's own portrait file ("<name>-portrait.png", separators optional —
// mirrors the server matcher). Returned as a repo path or ''.
function entityPortraitPath(name) {
  const key = String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (key.replace(/-/g, '').length < 2) return '';
  const pat = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '-?');
  const re = new RegExp(`^${pat}-?portrait$`);
  for (const [base, repoPath] of Object.entries(scenarioImageMap)) {
    const norm = base.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (re.test(norm)) return repoPath;
  }
  return '';
}

let scenarioImageMap = {};
let scenarioGraphicFiles = [];
let scenarioDbImageMap = {};
function setScenarioImages(sourceFiles) {
  const m = {};
  (sourceFiles || []).forEach((f) => {
    if (f && f.kind === 'graphic' && f.path) m[String(f.path).split('/').pop().toLowerCase()] = f.path;
  });
  scenarioImageMap = m;
  scenarioGraphicFiles = (sourceFiles || [])
    .filter((f) => f && f.kind === 'graphic' && f.path)
    .map((f) => {
      const file = String(f.path).split('/').pop();
      return {
        path: f.path,
        file,
        stem: imgKey(file.replace(/\.[^.]+$/, '')),
        visibility: f.visibility === 'gm' ? 'gm' : 'player',
        prompt: typeof f.prompt === 'string' ? f.prompt : '',
        modified_at: f.modified_at || ''
      };
    });
}

function isTrustedDbImageSrc(src) {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(String(src || '').trim());
}

function addScenarioDbImage(map, name, src) {
  const label = String(name || '').trim();
  const imageSrc = String(src || '').trim();
  const slug = imgKey(label);
  if (!label || slug.replace(/-/g, '').length < 2 || !isTrustedDbImageSrc(imageSrc)) return;
  const keys = [
    label.toLowerCase(),
    slug,
    `${slug}-portrait`,
    `${slug}.png`,
    `${slug}-portrait.png`,
    `${slug}.jpg`,
    `${slug}-portrait.jpg`
  ];
  keys.forEach((key) => { map[key] = imageSrc; });
}

function setScenarioDbImages(info) {
  const m = {};
  const walk = (node, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const name = node.name || node.title || node.character || node.player;
    if (name && typeof node.portrait === 'string') addScenarioDbImage(m, name, node.portrait);
    Object.keys(node).forEach((key) => walk(node[key], depth + 1));
  };
  walk(info);
  scenarioDbImageMap = m;
}

// Mirrors the server imgMatchKey: lowercase, runs of non-alphanumerics → "-".
function imgKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Graphics whose filename PREFIX-matches an entity name (separators optional —
// same rule the server-side index injector uses), so the table row shows the
// artifact that "Regenerate Index" will attach to that entity.
function entityGraphics(name) {
  const key = imgKey(name);
  if (key.replace(/-/g, '').length < 3) return [];
  const pat = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '-?');
  const re = new RegExp(`^${pat}(?:-|$)`);
  return scenarioGraphicFiles.filter((g) => re.test(g.stem));
}

// Default filename slug for an entity's generated artifact, so the deterministic
// index injector picks it up on "Regenerate Index".
function entitySlug(name) {
  return imgKey(name).slice(0, 60) || 'entity';
}

// ── Index image manager ──────────────────────────────────────────────────────
// A collapsed table at the foot of index pages (GM only). One row per index
// entry; each row pulls the entry's Edit-Files artifact + prompt in so they can
// be managed here, with a Generate column that drafts a prompt and a first
// image. "Regenerate Index" reloads this page, so the table tracks the same
// filename-prefix matching the deterministic injector uses.
let eitRegistry = {};
let eitBusy = false;
// Last prompt used to generate for an entity, keyed `${sessionId}:${slug}`.
// Survives the panel reload so the primary box keeps what the GM just used.
let eitLastPrompt = {};
// Landscape first → it is the default aspect (places/objects/scenes); the GM
// switches to Portrait per-graphic for a single figure.
const EIT_SIZES = [['landscape', 'Landscape'], ['portrait', 'Portrait'], ['square', 'Square'], ['character', 'Character'], ['intricate', 'Intricate']];

function eitDesc(entry) {
  if (!entry || typeof entry !== 'object') return String(entry || '');
  const keys = ['content', 'description', 'summary', 'analysis', 'story', 'narrative', 'details', 'body', 'text', 'notes'];
  const k = keys.find((x) => entry[x] != null && String(entry[x]).trim() !== '');
  return k ? String(entry[k]).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500) : '';
}

// Build manager rows from the SAME grouped index items that render the visible
// top-of-page jump index ([label, [{entry?, title, id}, …]]), so the table
// always mirrors exactly what the GM sees indexed at the top.
function eitFromIndex(indexGroups) {
  const out = [];
  (indexGroups || []).forEach(([label, items]) => {
    (items || []).forEach((it) => {
      const name = it && (it.title || it.name);
      if (name) out.push({ name, kind: label, desc: eitDesc(it && it.entry) });
    });
  });
  return out;
}

function renderEntityImageManager(sessionId, items) {
  if (State.user.role !== 'gm') return '';
  const rows = (items || []).filter((it) => it && it.name);
  if (!rows.length) return '';
  eitRegistry = {};
  const sizeSel = (sid) => `<select id="${sid}-size" class="dice-select" title="Size / aspect ratio">${EIT_SIZES.map(([v, l], j) => `<option value="${esc(v)}"${j === 0 ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  // Cache-bust by file mtime: Chrome reuses an identical <img src> from the
  // in-document cache without a request after the SPA re-render, so a
  // regenerated-in-place image (same filename) needs a changing URL to refresh.
  const assetVer = (g) => scenarioAssetUrl(g.path) + (g.modified_at ? `?v=${encodeURIComponent(g.modified_at)}` : '');
  let total = 0;
  const matched = new Set();
  // De-duplicated current titles → reassignment targets for orphaned graphics.
  const titleOpts = [];
  const seenSlug = new Set();
  rows.forEach((it) => {
    const s = entitySlug(it.name);
    if (seenSlug.has(s)) return;
    seenSlug.add(s);
    titleOpts.push({ slug: s, label: `${it.name}${it.kind ? ` (${it.kind})` : ''}` });
  });
  const body = rows.map((it, i) => {
    const id = `eit-${i}`;
    const matches = entityGraphics(it.name);
    matches.forEach((g) => matched.add(g.path));
    total += matches.length;
    const slug = entitySlug(it.name);
    eitRegistry[id] = { sessionId, name: it.name, kind: it.kind || '', slug, path: '', desc: it.desc || '' };
    const lastPrompt = eitLastPrompt[`${sessionId}:${slug}`] || '';
    // Primary row: draft a prompt and generate an ADDITIONAL graphic. Multiple
    // graphics per entry are allowed (e.g. a picture and a map) — each new one
    // is a fresh title-slug file the index injector also attaches. The box
    // keeps the last prompt used for this entity (restored across reload).
    const primary = `<tr id="${id}-row" class="eit-entity-row">
      <td class="eit-name">${esc(it.name)}${it.kind ? `<br><small>${esc(it.kind)}</small>` : ''}</td>
      <td class="eit-art"><span class="eit-none">${matches.length ? `${matches.length} attached` : '— none —'}</span></td>
      <td><textarea id="${id}-prompt" class="eit-prompt" rows="3" placeholder="Prompt for a NEW graphic — Draft, tweak, then Add">${esc(lastPrompt)}</textarea></td>
      <td class="eit-actions">
        <button class="btn btn-sm" onclick="eitDraft('${id}')" title="Have the AI write a prompt for this entry">Draft prompt</button>
        ${sizeSel(id)}
        <button class="btn btn-sm btn-primary" onclick="eitGenerate('${id}', false)" title="Generate an additional graphic (GM-only); filename is the title slug so Regenerate Index attaches it">${matches.length ? '+ Add graphic' : 'Generate'}</button>
        <div class="eit-status" id="${id}-status"></div>
      </td>
    </tr>`;
    // One sub-row per matched file — full per-file management.
    const fileRows = matches.map((g, j) => {
      const fid = `${id}-f${j}`;
      eitRegistry[fid] = { sessionId, name: it.name, kind: it.kind || '', slug: entitySlug(it.name), path: g.path, desc: it.desc || '' };
      return `<tr id="${fid}-row" class="eit-file-row">
        <td class="eit-sub">↳</td>
        <td class="eit-art">
          <a href="${esc(assetVer(g))}" target="_blank" rel="noopener"><img src="${esc(assetVer(g))}" alt="${esc(g.file)}" loading="lazy" class="eit-thumb"></a>
          <div class="eit-file">${esc(g.file)} <span class="vis-badge vis-${g.visibility === 'gm' ? 'gm' : 'player'}">${g.visibility === 'gm' ? 'GM' : 'Player'}</span></div>
        </td>
        <td><textarea id="${fid}-prompt" class="eit-prompt" rows="3" placeholder="This image's prompt">${esc(g.prompt || '')}</textarea></td>
        <td class="eit-actions">
          <button class="btn btn-sm" onclick="eitDraft('${fid}')" title="Rewrite this image's prompt with the AI">Draft</button>
          <button class="btn btn-sm" onclick="eitSavePrompt('${fid}')">Save prompt</button>
          ${sizeSel(fid)}
          <button class="btn btn-sm btn-primary" onclick="eitGenerate('${fid}', true)" title="Re-render this image in place, keeping its filename">Regenerate</button>
          <button class="btn btn-sm" onclick="eitToggleVis('${fid}')">${g.visibility === 'gm' ? 'Make Player' : 'Make GM'}</button>
          <button class="btn btn-sm" onclick="eitRename('${fid}')">Rename</button>
          <button class="btn btn-sm btn-danger" onclick="eitDelete('${fid}')">Delete</button>
          <div class="eit-status" id="${fid}-status"></div>
        </td>
      </tr>`;
    }).join('');
    return primary + fileRows;
  }).join('');
  // Orphaned graphics: in-scope gallery images whose filename prefix matches no
  // current index entry (a heading drifted on regeneration, or the file was
  // generated under an old title). Reassign by renaming the prefix to a chosen
  // current title's slug — the index injector then attaches it again.
  const orphans = scenarioGraphicFiles.filter((g) => !matched.has(g.path));
  const orphanSelect = (oid) => `<select id="${oid}-to" class="dice-select"><option value="">— choose current title —</option>${titleOpts.map((t) => `<option value="${esc(t.slug)}">${esc(t.label)}</option>`).join('')}</select>`;
  const orphanBody = orphans.map((g, k) => {
    const oid = `eito-${k}`;
    eitRegistry[oid] = { sessionId, path: g.path };
    return `<tr id="${oid}-row" class="eit-file-row">
        <td class="eit-sub">⚠</td>
        <td class="eit-art">
          <a href="${esc(assetVer(g))}" target="_blank" rel="noopener"><img src="${esc(assetVer(g))}" alt="${esc(g.file)}" loading="lazy" class="eit-thumb"></a>
          <div class="eit-file">${esc(g.file)} <span class="vis-badge vis-${g.visibility === 'gm' ? 'gm' : 'player'}">${g.visibility === 'gm' ? 'GM' : 'Player'}</span></div>
        </td>
        <td>${orphanSelect(oid)}</td>
        <td class="eit-actions">
          <button class="btn btn-sm btn-primary" onclick="eitReassign('${oid}')" title="Rename this file's prefix to the chosen title so Regenerate Index re-attaches it">Reassign</button>
          <button class="btn btn-sm" onclick="eitRename('${oid}')">Rename…</button>
          <button class="btn btn-sm btn-danger" onclick="eitDelete('${oid}')">Delete</button>
          <div class="eit-status" id="${oid}-status"></div>
        </td>
      </tr>`;
  }).join('');
  const orphanTable = orphans.length ? `
      <div class="eit-orphan-head">Unmatched graphics — ${orphans.length} not tied to any current index entry</div>
      <div class="table-scroll">
        <table class="eit">
          <thead><tr><th></th><th>Graphic</th><th>Reassign to</th><th>Actions</th></tr></thead>
          <tbody>${orphanBody}</tbody>
        </table>
      </div>` : '';
  return `<details class="card entity-img-table" style="margin-top:1rem">
      <summary><strong>Index image manager</strong> — ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}, ${total} graphic${total === 1 ? '' : 's'}${orphans.length ? `, ${orphans.length} unmatched` : ''}. Draft a prompt, tweak, Generate; files are named after the title so “Regenerate Index” attaches them. Add more than one per entry (e.g. a picture and a map).</summary>
      <div class="table-scroll">
        <table class="eit">
          <thead><tr><th>Index entry</th><th>Artifact</th><th>Prompt</th><th>Actions / Generate</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${orphanTable}
    </details>`;
}

function eitStatus(id, msg, cls) {
  const s = el(`${id}-status`);
  if (s) { s.textContent = msg || ''; s.className = `eit-status${cls ? ' ' + cls : ''}`; }
}

async function eitDraft(id) {
  const r = eitRegistry[id];
  if (!r) return;
  if (eitBusy) { eitStatus(id, 'An AI task is already running.', 'error'); return; }
  eitBusy = true;
  llmPendingBegin('Draft image prompt');
  eitStatus(id, 'Drafting prompt…');
  try {
    const out = await api.generateEntityGraphicPrompt(r.sessionId, { name: r.name, kind: r.kind, description: r.desc });
    const ta = el(`${id}-prompt`);
    if (ta && out && out.prompt) ta.value = out.prompt;
    eitStatus(id, 'Prompt drafted — tweak then Generate.', 'saved');
  } catch (e) {
    eitStatus(id, e.message || 'Could not draft a prompt', 'error');
  } finally {
    eitBusy = false;
    llmPendingEnd();
  }
}
window.eitDraft = eitDraft;

async function eitSavePrompt(id) {
  const r = eitRegistry[id];
  if (!r || !r.path) { eitStatus(id, 'Generate the image first.', 'error'); return; }
  const ta = el(`${id}-prompt`);
  try {
    await api.saveSessionFilePrompt(r.sessionId, r.path, ta ? ta.value : '');
    eitStatus(id, 'Prompt saved.', 'saved');
  } catch (e) {
    eitStatus(id, e.message || 'Save failed', 'error');
  }
}
window.eitSavePrompt = eitSavePrompt;

function eitToggleVis(id) {
  const r = eitRegistry[id];
  if (!r || !r.path) return;
  const cur = scenarioGraphicFiles.find((g) => g.path === r.path);
  toggleAssetVisibility(r.sessionId, r.path, cur && cur.visibility === 'gm' ? 'player' : 'gm');
}
window.eitToggleVis = eitToggleVis;

function eitRename(id) {
  const r = eitRegistry[id];
  if (r && r.path) efRenameFile(r.sessionId, r.path);
}
window.eitRename = eitRename;

function eitDelete(id) {
  const r = eitRegistry[id];
  if (r && r.path) efDeleteFile(r.sessionId, r.path);
}
window.eitDelete = eitDelete;

// Reassign an orphaned graphic: rename its prefix to the chosen current
// title's slug so the index injector attaches it again on Regenerate Index.
async function eitReassign(oid) {
  const r = eitRegistry[oid];
  if (!r || !r.path) return;
  const sel = el(`${oid}-to`);
  const slug = sel ? sel.value : '';
  if (!slug) { eitStatus(oid, 'Pick a current title first.', 'error'); return; }
  try {
    await api.renameSessionFile(r.sessionId, { path: r.path, name: slug });
    eitStatus(oid, 'Reassigned — run Regenerate Index to attach it.', 'saved');
    await reloadCurrentSessionPanel();
  } catch (e) {
    eitStatus(oid, e.message || 'Reassign failed', 'error');
  }
}
window.eitReassign = eitReassign;

// Generate (or Regenerate in place) an entity's artifact via ComfyUI, then save
// it. Mirrors the GM-chat handout flow but writes a title-slug filename so the
// deterministic index injector attaches it.
async function eitGenerate(id, replace) {
  const r = eitRegistry[id];
  if (!r) return;
  if (eitBusy) { eitStatus(id, 'An AI task is already running.', 'error'); return; }
  const ta = el(`${id}-prompt`);
  let promptText = ta ? ta.value.trim() : '';
  const sizeSel = el(`${id}-size`);
  const size = sizeSel ? sizeSel.value : 'portrait';
  eitBusy = true;
  llmPendingBegin(replace ? 'Regenerate image' : 'Generate image');
  try {
    if (!promptText) {
      eitStatus(id, 'Drafting prompt…');
      const out = await api.generateEntityGraphicPrompt(r.sessionId, { name: r.name, kind: r.kind, description: r.desc });
      promptText = out && out.prompt ? out.prompt : '';
      if (ta) ta.value = promptText;
    }
    if (!promptText) throw new Error('No prompt to generate from.');
    // Persist the prompt at the moment Generate is pressed — not only on a
    // successful save 10+ min later. Keep it in the entity box across reload,
    // and for an existing file write its sidecar now so it survives even if
    // the image generation fails.
    eitLastPrompt[`${r.sessionId}:${r.slug}`] = promptText;
    if (r.path) {
      try { await api.saveSessionFilePrompt(r.sessionId, r.path, promptText); } catch (_) { /* best-effort */ }
    }
    eitStatus(id, 'Generating image…');
    const q = await api.generateHandout(r.sessionId, promptText, size);
    if (q && q.node_errors && Object.keys(q.node_errors).length) throw new Error('ComfyUI rejected the workflow.');
    const promptId = q && q.prompt_id;
    if (!promptId) throw new Error('ComfyUI returned no prompt_id.');
    const started = Date.now();
    let entry = null;
    while (Date.now() - started < 10 * 60 * 1000) {
      await new Promise((res) => setTimeout(res, 2000));
      const h = await fetch(`/api/portrait/history/${encodeURIComponent(promptId)}`, { credentials: 'same-origin' });
      if (h.ok) {
        const e = (await h.json())[promptId];
        if (e && e.status && e.status.completed) { entry = e; break; }
        if (e && e.status && e.status.status_str === 'error') throw new Error('ComfyUI reported an error.');
      }
    }
    if (!entry) throw new Error('Timed out waiting for ComfyUI.');
    const outputs = entry.outputs || {};
    const node = outputs['10'] || Object.values(outputs).find((o) => o && o.images);
    const img = node && node.images && node.images[0];
    if (!img) throw new Error('ComfyUI finished but returned no image.');
    eitStatus(id, 'Saving…');
    const saveBody = { filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output', prompt: promptText };
    if (replace && r.path) saveBody.replace_path = r.path;
    else saveBody.name = r.slug;
    await api.saveHandout(r.sessionId, saveBody);
    eitStatus(id, replace ? 'Regenerated.' : 'Generated (GM-only).', 'saved');
    eitBusy = false;
    await reloadCurrentSessionPanel();
    return;
  } catch (e) {
    eitStatus(id, e.message || 'Generation failed', 'error');
  } finally {
    eitBusy = false;
    llmPendingEnd();
  }
}
window.eitGenerate = eitGenerate;

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

function renderScenarioEntry(entry, fallbackTitle = 'Entry', anchorId = '') {
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
    'known_by', 'visible_to', 'access', 'gm_only', 'gmOnly', 'media', 'sources', 'presentation', 'portrait']);
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
    <div class="card scenario-entry-card"${anchorId ? ` id="${esc(anchorId)}"` : ''}>
      <div class="card-header">
        <div>
          <div class="card-title">${esc(title)}</div>
          ${meta.length ? `<div class="card-sub">${esc(meta.join(' | '))}</div>` : ''}
        </div>
      </div>
      ${(() => {
        // Prefer the read-time DB portrait (NPCs.sheet.portrait / sheets.data.portrait)
        // attached by the server; fall back to a Gallery file via entityPortraitPath
        // so any custom GM-uploaded picture without a backing sheet still works.
        const fromDb = (data && typeof data.portrait === 'string' && data.portrait) ? data.portrait : '';
        const pp = fromDb ? '' : entityPortraitPath(title);
        const src = fromDb || (pp ? scenarioAssetUrl(pp) : '');
        const fig = src ? `<figure class="scenario-figure sf-left" style="--sf-w:30%"><img src="${esc(src)}" alt="${esc(title)}" loading="lazy"></figure>` : '';
        return (fig || bodyHtml) ? `<div class="scenario-body">${fig}${bodyHtml}</div>` : '';
      })()}
      ${blocks.join('')}
      ${renderScenarioMedia(data.media)}
      ${renderScenarioSources(data.sources)}
    </div>`;
}

// Deterministic {entry,title,id} list for a section. Pure — calling it again
// with the same inputs yields the same anchor ids, so a page can build a
// combined top index that matches the cards renderScenarioSection emits.
function scenarioSectionItems(title, entries, sectionId = '') {
  const list = scenarioArray(entries);
  const baseSlug = `sec-${String(sectionId || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
  const used = {};
  return list.map((entry, i) => {
    const d = entry && typeof entry === 'object' ? entry : {};
    const t = d.name || d.title || d.character || d.deliverable || `${title} ${i + 1}`;
    return { entry, title: t, id: `${baseSlug}-${mdSlug(String(t), used)}` };
  });
}

function scenarioJumpNav(items, ariaLabel) {
  if (!items || items.length < 2) return '';
  return `<nav class="scenario-jump" aria-label="${esc(ariaLabel || 'index')}">${
    items.map((it) => `<a href="#${esc(it.id)}" onclick="scrollToAnchor(event,'${esc(it.id)}')">${esc(it.title)}</a>`).join('')
  }</nav>`;
}

function scenarioGroupedJumpIndex(groups) {
  const html = (groups || []).map(([label, rawItems]) => {
    const items = (rawItems || []).filter((it) => it && it.id && it.title);
    if (!items.length) return '';
    const links = items.map((it) => {
      const onclick = it.gmBrief
        ? `gmInfoSelectCharAndScroll(event,'${esc(it.gmBrief)}')`
        : `scrollToAnchor(event,'${esc(it.id)}')`;
      return `<a href="#${esc(it.id)}" onclick="${onclick}">${esc(it.title)}</a>`;
    }).join('');
    return `<div class="scenario-jump-group"><span class="scenario-jump-label">${esc(label)}</span><nav class="scenario-jump">${links}</nav></div>`;
  }).filter(Boolean).join('');
  return html ? `<div class="scenario-jump-all">${html}</div>` : '';
}

function renderScenarioSection(title, entries, emptyText, sectionId = '', inlineIndex = true) {
  const list = scenarioArray(entries);
  const items = scenarioSectionItems(title, entries, sectionId);
  return `
    <section class="scenario-section">
      <div class="scenario-section-header">
        <h3>${esc(title)}</h3>
        ${renderScenarioSectionActions(sectionId)}
      </div>
      ${inlineIndex ? scenarioJumpNav(items, `${title} index`) : ''}
      ${list.length
        ? `<div class="scenario-grid">${items.map((it) => renderScenarioEntry(it.entry, title, it.id)).join('')}</div>`
        : `<div class="empty scenario-empty"><p>${esc(emptyText)}</p></div>`}
    </section>`;
}

// GM-only page-level regenerate button. `sectionsCsv` lists the section ids the
// page shows; an empty string means "all sections" (the bulk path).
function scenarioPageButton(sectionsCsv, label) {
  if (State.user.role !== 'gm') return '';
  return `<button class="btn btn-primary js-regen" onclick="regenerateScenarioPage(this, '${esc(sectionsCsv || '')}', '${esc(label)}')">${esc(label)}</button>`;
}

function scenarioIndexButton(sectionsCsv) {
  if (State.user.role !== 'gm') return '';
  return `<button class="btn" onclick="regenerateScenarioIndex(this, '${esc(sectionsCsv || '')}')">Regenerate Index</button>`;
}

function scenarioPageActions(sectionsCsv, label) {
  if (State.user.role !== 'gm') return '';
  return `<div class="scenario-section-actions">${scenarioIndexButton(sectionsCsv)}${scenarioPageButton(sectionsCsv, label)}</div>`;
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
    // Standalone images are handled line-by-line. If the model inlined one
    // inside a paragraph, surface a marker (diagnostic) rather than silently
    // dropping it, so "model didn't emit" vs "emitted but misplaced" is clear.
    .replace(/!\[[^\]]*\]\(([^)]*)\)/g, ' ⟦inline image: $1 — move to its own line⟧ ')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
}

function cleanMarkdownImageRef(src) {
  let value = String(src || '').trim().replace(/^<|>$/g, '');
  const token = value.match(/^(?:db:)?portrait:(.+)$/i) || value.match(/^db:(.+)$/i);
  if (token) value = token[1].trim();
  return value;
}

function markdownImageLookupKeys(src) {
  const cleaned = cleanMarkdownImageRef(src);
  if (!cleaned || /^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return [];
  const noQuery = cleaned.split(/[?#]/)[0].replace(/^\/+/, '');
  let decoded = noQuery;
  try { decoded = decodeURIComponent(noQuery); } catch (_) {}
  const base = decoded.split('/').pop();
  const stem = base.replace(/\.[a-z0-9]+$/i, '');
  const unportrait = stem.replace(/[-_.]?portrait$/i, '');
  return Array.from(new Set([
    cleaned.toLowerCase(),
    noQuery.toLowerCase(),
    decoded.toLowerCase(),
    base.toLowerCase(),
    imgKey(stem),
    imgKey(unportrait),
    `${imgKey(unportrait)}-portrait`,
    `${imgKey(unportrait)}.png`,
    `${imgKey(unportrait)}-portrait.png`,
    `${imgKey(unportrait)}.jpg`,
    `${imgKey(unportrait)}-portrait.jpg`
  ].filter(Boolean)));
}

function resolveMarkdownImage(src) {
  const raw = String(src || '').trim();
  if (!raw) return null;
  if (/^(?:https?|file|data|javascript|vbscript):/i.test(raw)) return null;
  const keys = markdownImageLookupKeys(raw);
  for (const key of keys) {
    const repoPath = scenarioImageMap[key];
    if (repoPath) return { url: scenarioAssetUrl(repoPath), layoutName: key, source: 'file' };
  }
  for (const key of keys) {
    const dbSrc = scenarioDbImageMap[key];
    if (dbSrc) return { url: dbSrc, layoutName: key, source: 'db' };
  }
  return null;
}

function renderMissingMarkdownImage(src, caption) {
  return `<div class="scenario-figure-missing">image not available to this view: <code>${esc(src)}</code>${caption ? ` - ${esc(caption)}` : ''}</div>`;
}

let _markdownIt = null;
function getMarkdownIt() {
  if (_markdownIt) return _markdownIt;
  const factory = (typeof window !== 'undefined') ? window.markdownit : null;
  if (typeof factory !== 'function') return null;
  const md = factory({
    html: false,
    xhtmlOut: false,
    breaks: true,
    linkify: false,
    typographer: false
  });
  const renderToken = md.renderer.renderToken.bind(md.renderer);
  const mappedHeadingTag = (tag) => {
    const level = Number(String(tag || '').replace(/^h/i, '')) || 2;
    if (level <= 2) return 'h4';
    if (level === 3) return 'h5';
    return 'h6';
  };
  const paragraphOnlyImage = (tokens, idx) => {
    const inline = tokens[idx + 1];
    const children = inline && inline.type === 'inline' ? (inline.children || []) : [];
    return children.length > 0 && children.every((child) => (
      child.type === 'image' ||
      child.type === 'softbreak' ||
      (child.type === 'text' && !String(child.content || '').trim())
    ));
  };

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const inline = tokens[idx + 1];
    const level = Number(String(token.tag || '').replace(/^h/i, '')) || 2;
    const text = inline && inline.type === 'inline' ? inline.content.trim() : '';
    const used = env.usedHeadings || (env.usedHeadings = {});
    const id = `${env.anchorPrefix || 'md'}-${mdSlug(text, used)}`;
    if (text) env.headings.push({ id, text, level });
    token.attrSet('id', id);
    token.attrJoin('class', `summary-h summary-h${level}`);
    token.tag = mappedHeadingTag(token.tag);
    return renderToken(tokens, idx, options);
  };
  md.renderer.rules.heading_close = (tokens, idx, options) => {
    tokens[idx].tag = mappedHeadingTag(tokens[idx].tag);
    return renderToken(tokens, idx, options);
  };
  md.renderer.rules.paragraph_open = (tokens, idx, options) => (
    paragraphOnlyImage(tokens, idx) ? '' : renderToken(tokens, idx, options)
  );
  md.renderer.rules.paragraph_close = (tokens, idx, options) => (
    paragraphOnlyImage(tokens, idx - 2) ? '' : renderToken(tokens, idx, options)
  );
  md.renderer.rules.bullet_list_open = (tokens, idx, options) => {
    tokens[idx].attrJoin('class', 'summary-points');
    return renderToken(tokens, idx, options);
  };
  md.renderer.rules.ordered_list_open = (tokens, idx, options) => {
    tokens[idx].attrJoin('class', 'summary-points');
    return renderToken(tokens, idx, options);
  };
  md.renderer.rules.table_open = (tokens, idx, options) => {
    tokens[idx].attrJoin('class', 'markdown-table');
    return `<div class="markdown-table-wrap">${renderToken(tokens, idx, options)}`;
  };
  md.renderer.rules.table_close = (tokens, idx, options) => `${renderToken(tokens, idx, options)}</div>`;
  md.renderer.rules.image = (tokens, idx, options, env) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    const caption = token.content || token.attrGet('alt') || '';
    const resolved = resolveMarkdownImage(src);
    if (!resolved) return renderMissingMarkdownImage(src, caption);
    const lay = scenarioFigureLayout(resolved.layoutName || src);
    const figStyle = lay.style ? ` style="${lay.style}"` : '';
    const capHtml = caption ? `<figcaption>${md.renderInline(caption, env)}</figcaption>` : '';
    return `<figure class="scenario-figure ${lay.cls}"${figStyle}><img src="${esc(resolved.url)}" alt="${esc(caption || src)}" loading="lazy">${capHtml}</figure>`;
  };
  const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet('href') || '';
    if (/^https?:/i.test(href)) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  _markdownIt = md;
  return _markdownIt;
}

function renderMarkdownItHtml(source, anchorPrefix) {
  const md = getMarkdownIt();
  if (!md) return null;
  const env = { anchorPrefix, headings: [], usedHeadings: {} };
  return { html: md.render(String(source == null ? '' : source), env), headings: env.headings };
}

function markdownToHtml(md, anchorPrefix) {
  return renderMarkdownItHtml(md, anchorPrefix) || legacyMarkdownToHtml(md, anchorPrefix);
}

function legacyMarkdownToHtml(md, anchorPrefix) {
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
      const resolved = resolveMarkdownImage(imageLine[2]);
      if (resolved) {
        const lay = scenarioFigureLayout(resolved.layoutName || imageLine[2]);
        out.push(`<figure class="scenario-figure ${lay.cls}"${lay.style ? ` style="${lay.style}"` : ''}><img src="${esc(resolved.url)}" alt="${esc(cap || imageLine[2])}" loading="lazy">${cap ? `<figcaption>${mdInline(esc(cap))}</figcaption>` : ''}</figure>`);
      } else {
        // Diagnostic: the model emitted an image ref but the filename is not
        // in the viewer's in-scope set (wrong name, not a Player Handout, or
        // not regenerated since). Shown so this is visible, not silent.
        out.push(renderMissingMarkdownImage(imageLine[2], cap));
      }
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

function structuredSummaryMarkdown(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.body === 'string' && /[#*\->]/.test(obj.body)) return obj.body;
  return '';
}

function structuredSummaryHeadingItems(obj, anchorPrefix) {
  const md = structuredSummaryMarkdown(obj);
  if (!md) return [];
  return markdownToHtml(md, anchorPrefix).headings
    .filter((h) => h.level <= 3)
    .map((h) => ({ id: h.id, title: h.text }));
}

function presentationBadge(p) {
  const mode = p === 'player' ? 'player' : (p === 'scene' ? 'scene' : (p === 'location' ? 'location' : ''));
  if (!mode) return '';
  const label = mode === 'player' ? 'Per-player threads' : (mode === 'location' ? 'Location index' : 'Scene timeline');
  return `<span class="presentation-badge pb-${mode}">${label}</span>`;
}

function scrollToAnchor(ev, id) {
  if (ev) ev.preventDefault();
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.scrollToAnchor = scrollToAnchor;

// Renders a structured-summary object: { title?, presentation?, content(md), sources? }.
// Falls back to legacy { body|summary } prose if no Markdown content is present.
function renderStructuredSummary(obj, anchorPrefix, showIndex = true) {
  if (!obj || typeof obj !== 'object') {
    return `<div class="scenario-body">${renderScenarioText(obj)}</div>`;
  }
  const md = typeof obj.content === 'string' ? obj.content
    : (typeof obj.body === 'string' && /[#*\->]/.test(obj.body) ? obj.body : '');
  if (md) {
    const { html, headings } = markdownToHtml(md, anchorPrefix);
    return `${presentationBadge(obj.presentation)}
      ${showIndex ? renderSummaryIndex(headings) : ''}
      <div class="summary-content">${html}</div>
      ${renderScenarioSources(obj.sources)}`;
  }
  return `${presentationBadge(obj.presentation)}
    <div class="scenario-body">${renderScenarioText(obj.body || obj.summary || obj)}</div>
    ${renderScenarioSources(obj.sources)}`;
}

function renderWhatHappenedSection(whatHappened, showIndex = true) {
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
      <div class="card scenario-summary-card" id="case-summary-main">
        ${renderStructuredSummary(whatHappened, 'wh', showIndex)}
      </div>
    </section>`;
}

function renderSessionAnalysis(entries, showIndex = true) {
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
          <div class="card scenario-summary-card session-analysis-card" id="session-summary-${i + 1}">
            <div class="session-analysis-title">${esc((entry && (entry.title || entry.name)) || `Session ${i + 1}`)}</div>
            ${renderStructuredSummary(entry, `s${i + 1}`, showIndex)}
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

function gmInfoSelectCharAndScroll(ev, slug) {
  if (ev) ev.preventDefault();
  gmInfoSelectChar(slug);
  window.setTimeout(() => scrollToAnchor(null, `gmbrief_${slug}`), 0);
}
window.gmInfoSelectCharAndScroll = gmInfoSelectCharAndScroll;

function gmActionItems(actions) {
  return scenarioArray(actions).slice()
    .sort((a, b) => gmPriorityRank(a && a.priority) - gmPriorityRank(b && b.priority))
    .map((entry, i) => {
      const title = entry && (entry.title || entry.name) || 'Action';
      return { entry, title, id: `gm-action-${i + 1}-${gmSlug(title)}` };
    });
}

function renderGmActions(actions) {
  const list = gmActionItems(actions);
  if (!list.length) return '<div class="empty scenario-empty"><p>No GM actions generated yet.</p></div>';
  return `<div class="gm-actions">${list.map((it) => {
    const a = it.entry || {};
    return `
    <div class="card gm-action-card gm-prio-${esc(gmSlug(a.priority || 'normal'))}" id="${esc(it.id)}">
      <div class="gm-action-head">
        <div class="card-title">${esc(it.title)}</div>
        ${gmPill('priority', a.priority)}
      </div>
      ${renderRichText(a.content || a.description || a)}
    </div>`;
  }).join('')}</div>`;
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
  const progressItems = progress.map((entry, i) => {
    const title = entry && (entry.title || entry.name) || `Pacing ${i + 1}`;
    return { entry, title, id: `gm-progress-${i + 1}-${gmSlug(title)}` };
  });
  const actionItems = gmActionItems(analysis.gm_actions);
  const topIndex = scenarioGroupedJumpIndex([
    ['Pacing', progressItems],
    ['Actions', actionItems],
    ['Briefs', chars.map((c) => {
      const slug = gmSlug(c.name);
      return { id: `gmbrief_${slug}`, title: c.name, gmBrief: slug };
    })]
  ]);
  const briefsButton = scenarioPageButton('gm.plans_by_player,gm.next_deliverables,gm.fairness_engagement,gm.quiet_players', 'Regenerate Briefs');

  const pacing = `
    <section class="scenario-section">
      <div class="scenario-section-header">
        <h3>Scenario Pacing</h3>
        ${renderScenarioSectionActions('gm.scenario_progress')}
      </div>
      ${progressItems.length
        ? progressItems.map((it, i) => `<div class="card scenario-summary-card" id="${esc(it.id)}">${it.title ? `<div class="session-analysis-title">${esc(it.title)}</div>` : ''}${renderStructuredSummary(it.entry, `gp${i + 1}`)}</div>`).join('')
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

  return `<div class="gm-private-analysis">${topIndex}${pacing}${actionsSection}${briefsSection}</div>`;
}

function renderScenarioSourceEditor(sources) {
  const markdownSources = scenarioArray(sources.markdown_sources);
  if (State.user.role !== 'gm') {
    return `
      <div class="card scenario-summary-card">
        <div class="card-title">Handouts</div>
        ${markdownSources.length ? markdownSources.map((source) => `
          <div class="scenario-subtitle">${esc(source.relative_path || source.path || 'Source')}</div>
          <div class="scenario-body">${renderScenarioText(source.content || '')}</div>
        `).join('') : '<p class="card-sub">No player-visible source files are available.</p>'}
      </div>
      ${assetFilesPanelHtml(sources, false)}`;
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
              <button class="btn btn-danger" onclick="efDeleteSelected(${State.currentSession})" title="Delete this file permanently">Delete</button>
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
function assetFilesPanelHtml(sources, editable = true) {
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
              ${editable ? `
                <button class="btn btn-sm" onclick="toggleAssetVisibility(${State.currentSession}, '${esc(f.path)}', '${player ? 'gm' : 'player'}')">${player ? 'Make GM Only' : 'Make Player Handout'}</button>
                <a class="btn btn-sm" href="${esc(url)}?download=1" download>Download</a>
                <button class="btn btn-sm" onclick="efReplaceFile(${State.currentSession}, '${esc(f.path)}')">Replace</button>
                <button class="btn btn-sm" onclick="efRenameFile(${State.currentSession}, '${esc(f.path)}')">Rename</button>
                <button class="btn btn-sm btn-danger" onclick="efDeleteFile(${State.currentSession}, '${esc(f.path)}')">Delete</button>
              ` : `<a class="btn btn-sm" href="${esc(url)}?download=1" download>Download</a>`}
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
  setScenarioDbImages(info);
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
    const editable = State.user.role === 'gm';
    setScenarioImages(sources && sources.source_files);
    setScenarioDbImages(null);
    // The Edit Files page holds no AI-generated artifacts, so its action is the
    // full bulk regenerate (empty section list = all sections).
    tab.innerHTML = `
      <div class="page-header">
        <div>
          <h2>${editable ? 'Edit Files' : 'Handouts'}</h2>
          <p class="card-sub">${editable ? 'Edit player-visible source files and GM-only source files separately.' : 'Player-visible case files, maps, and handouts.'}</p>
        </div>
        ${editable ? scenarioPageActions('', 'Bulk Regenerate') : ''}
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
      ${scenarioPageActions('gm.scenario_progress,gm.plans_by_player,gm.next_deliverables,gm.fairness_engagement,gm.quiet_players,gm.gm_actions', 'Regenerate Page')}
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
  const sessions = scenarioArray(summary.session_summaries);
  const summaryItems = structuredSummaryHeadingItems(whatHappened, 'wh');
  const sessionIndexGroups = sessions.map((entry, i) => [
    (entry && (entry.title || entry.name)) || `Session ${i + 1}`,
    structuredSummaryHeadingItems(entry, `s${i + 1}`)
  ]);
  // One grouped index drives both the visible top index and the image-manager
  // table — built as the index is assembled, not re-parsed from disk.
  const indexGroups = [['Summary', summaryItems], ...sessionIndexGroups];
  const topIndex = info.generated === false ? '' : scenarioGroupedJumpIndex(indexGroups);
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>Case Info</h2>
        ${info.generated_at ? `<p class="card-sub">Generated ${esc(new Date(info.generated_at).toLocaleString('en-GB'))}</p>` : ''}
      </div>
      ${scenarioPageActions('player.summary.what_has_happened,player.summary.session_summaries', 'Regenerate Page')}
    </div>
    <div id="scenario-alert"></div>
    ${info.error ? `<div class="alert alert-danger">${esc(info.error)}</div>` : ''}
    ${info.generated === false
      ? `<div class="card scenario-summary-card"><div class="card-title">No case information generated yet</div><p class="card-sub">A GM can run the scenario regeneration to populate this from the session sources.</p></div>`
      : `${topIndex}
         ${renderWhatHappenedSection(whatHappened, false)}
         ${renderSessionAnalysis(sessions, false)}
         ${renderEntityImageManager(sessionId, eitFromIndex(indexGroups))}`}`;
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
        <div><h2>Player Stories</h2><p class="card-sub">Come up to speed: what you did, why, what's in flight, and what's planned${viewerNames.length ? ` — ${esc(viewerNames.join(', '))}` : ''}.</p></div>
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

  const pageButton = scenarioPageActions('player.entities.characters', 'Regenerate Page');
  if (!players.length) {
    tab.innerHTML = `
      <div class="page-header"><div><h2>Player Stories</h2></div>${pageButton}</div>
      <div id="scenario-alert"></div>
      <div class="empty"><div class="empty-icon">👥</div><p>No players assigned to this session yet.</p></div>`;
    return;
  }

  tab.innerHTML = `
    <div class="page-header">
      <div><h2>Player Stories</h2><p class="card-sub">Select a player to see exactly what they see — what they did, why, what's in flight, what's planned.</p></div>
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
  setScenarioDbImages(info);
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
  tab.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading Places/NPC/Things…</p>';
  let info;
  try {
    info = await loadScenarioInfo(sessionId);
  } catch (e) {
    tab.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const entities = info.entities || {};
  const groups = [
    ['Places', entities.locations || info.locations, 'No places have been generated yet.', 'player.entities.locations'],
    ['NPCs', entities.npcs || info.npcs, 'No NPCs have been generated yet.', 'player.entities.npcs'],
    ['Things', entities.items || info.items, 'No notable things have been generated yet.', 'player.entities.items']
  ];
  // One combined index at the very top, grouped, so anything further down the
  // page (NPCs, Things) is reachable from the top — not just Places.
  // Build the grouped index once; the same items drive the visible top index
  // AND the image-manager table (no separate on-disk re-derivation).
  const indexGroups = groups.map(([t, e, , sid]) => [t, scenarioSectionItems(t, e, sid)]);
  const topIndex = scenarioGroupedJumpIndex(indexGroups);
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>Places/NPC/Things</h2>
        ${info.generated_at ? `<p class="card-sub">Generated ${esc(new Date(info.generated_at).toLocaleString('en-GB'))}</p>` : ''}
      </div>
      ${scenarioPageActions('player.entities.locations,player.entities.npcs,player.entities.items', 'Regenerate Page')}
    </div>
    <div id="scenario-alert"></div>
    ${info.error ? `<div class="alert alert-danger">${esc(info.error)}</div>` : ''}
    ${info.generated === false
      ? `<div class="card scenario-summary-card"><div class="card-title">Nothing generated yet</div><p class="card-sub">A GM can run the scenario regeneration to populate places, NPCs, and notable things.</p></div>`
      : `${topIndex}
         ${groups.map(([t, e, empty, sid]) => renderScenarioSection(t, e, empty, sid, false)).join('')}
         ${renderEntityImageManager(sessionId, eitFromIndex(indexGroups))}`}`;
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

async function efDeleteFile(sessionId, assetPath) {
  if (!assetPath) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  const label = String(assetPath).split('/').slice(-1)[0];
  if (!confirm(`Delete "${label}" permanently? This also removes its saved prompt.`)) return;
  try {
    await api.deleteSessionFile(sessionId, assetPath);
    showAlert(`Deleted ${label}.`, 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message || 'Delete failed', 'danger', 'scenario-alert');
  }
}
window.efDeleteFile = efDeleteFile;

function efDeleteSelected(sessionId) {
  const src = efSelectedSource();
  if (!src) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  efDeleteFile(sessionId, src.path);
}
window.efDeleteSelected = efDeleteSelected;

async function reloadCurrentSessionPanel() {
  if (!State.currentSession) return;
  await switchSessionPanel(State.currentSession, State.currentSessionPanel || 'case-info');
}

// Shared streaming regenerate. The authoritative stop path is server-side
// (/llm/cancel); the local controller only closes this browser's stream.
async function runStreamingRegen(btn, label, url, body) {
  if (State.activeRegen || State.llmCanCancel) { stopActiveRegen(); return; }
  if (!State.currentSession) return;
  if (State.llmBusy) {
    showAlert('A generation is already running — wait for it to finish.', 'danger', 'scenario-alert');
    return;
  }
  const original = btn.textContent;
  const controller = new AbortController();
  State.activeRegen = { controller, label, status: `Stop · ${label}` };
  btn.dataset.regenOriginal = original;
  applyLlmBusyUI({ busy: true, last_section: label });
  llmPendingBegin(label);
  const errors = [];
  let cancelled = false;
  const setStatus = (s) => {
    if (State.activeRegen) {
      State.activeRegen.status = `Stop · ${s}`;
      applyLlmBusyUI({ busy: true, last_section: State.activeRegen.label });
    }
  };
  const handle = (obj) => {
    const progressName = obj.item_label || obj.item || obj.id;
    if (obj.type === 'start') setStatus(`${obj.id} ${obj.index}/${obj.total}…`);
    else if (obj.type === 'progress') {
      const m = obj.metrics;
      if (m) setStatus(`${progressName} prefill=${m.prompt_eval_count ?? '?'} out=${m.eval_count ?? '?'} ${m.tok_per_s ?? '?'}t/s ctx=${m.num_ctx ?? '?'}`);
      else if (obj.chars != null) setStatus(`${progressName} ${obj.chars}c ${Math.round((obj.elapsedMs || 0) / 1000)}s`);
      else if (obj.item_label && obj.item_index && obj.item_total) setStatus(`${obj.item_label} ${obj.item_index}/${obj.item_total}…`);
    }
    else if (obj.type === 'done') setStatus(`${obj.id} ✓ ${obj.ms}ms`);
    else if (obj.type === 'error') errors.push(`${obj.id}: ${obj.error}`);
    else if (obj.type === 'cancelled') cancelled = true;
    else if (obj.type === 'fatal') errors.push(obj.error || 'failed');
    else if (obj.type === 'complete') {
      (obj.errors || []).forEach((e) => errors.push(`${e.section_id}: ${e.error}`));
    }
  };
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify(body || {}),
      signal: controller.signal
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
      if (res.status === 404) msg = 'Endpoint not found — restart the server to pick up streaming regen.';
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const drain = (line) => { const t = line.trim(); if (!t) return; let o; try { o = JSON.parse(t); } catch { return; } handle(o); };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { drain(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
    }
    drain(buffer);
    if (cancelled) showAlert('Stopped.', 'danger', 'scenario-alert');
    else if (errors.length) showAlert(`Finished with errors — ${errors.join('; ')}`, 'danger', 'scenario-alert');
    else showAlert('Regenerated.', 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    if (e.name === 'AbortError') showAlert('Stopped.', 'danger', 'scenario-alert');
    else showAlert(e.message || 'Regeneration failed', 'danger', 'scenario-alert');
  } finally {
    State.activeRegen = null;
    delete btn.dataset.stopBtn;
    delete btn.dataset.regenOriginal;
    btn.disabled = false;
    btn.textContent = original;
    applyLlmBusyUI({ busy: State.llmLocalPending > 0, last_section: null });
    llmPendingEnd();
  }
}

function regenerateScenarioSection(sectionId, btn) {
  return runStreamingRegen(
    btn, sectionId,
    `/api/sessions/${State.currentSession}/scenario-info/sections/${encodeURIComponent(sectionId)}/regenerate`,
    {}
  );
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

async function regenerateScenarioIndex(btn, sectionsCsv) {
  if (!State.currentSession) return;
  const sections = String(sectionsCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Regenerating index...';
  try {
    await api.refreshScenarioIndex(State.currentSession, sections.length ? { sections } : {});
    showAlert('Index and images refreshed.', 'success', 'scenario-alert');
    await reloadCurrentSessionPanel();
  } catch (e) {
    showAlert(e.message || 'Could not regenerate index', 'danger', 'scenario-alert');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
window.regenerateScenarioIndex = regenerateScenarioIndex;

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
function regenerateScenarioPage(btn, sectionsCsv, label) {
  const sections = String(sectionsCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  return runStreamingRegen(
    btn, label || 'scenario',
    `/api/sessions/${State.currentSession}/scenario-info/regenerate`,
    sections.length ? { sections } : {}
  );
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
            <button class="btn btn-sm" onclick="openNpcSheetView(${npc.id})"${npc.sheet ? '' : ' disabled'}>Edit sheet</button>
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
        <p class="card-sub">NPCs surfaced in this case. The sheet is shared everywhere this NPC appears.</p>
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

// Editable sheet view for an NPC surfaced in this case. The sheet itself is the
// central NPC sheet; this case only supplies portrait style context and whether
// the NPC is surfaced here.
function openNpcSheetView(npcId) {
  const npc = State.npcs.find((entry) => entry.id === npcId);
  if (!npc) return;
  const sessionId = State.currentSession;
  modal(`
    <h3>${esc(npc.name)} — Character Sheet</h3>
    <p class="card-sub" style="margin:0 0 0.5rem">This is the shared NPC sheet used in every case where the NPC is surfaced.</p>
    <div id="npc-sheet-area"></div>
    <div class="sheet-actions">
      <button class="btn btn-primary" id="npc-case-save" onclick="saveCaseNpc(${sessionId}, ${npcId}, this)">Save NPC</button>
      <button class="btn" onclick="exportPdf()">Export PDF</button>
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Close</button>
      <span class="save-status" id="npc-case-status"></span>
    </div>`, async (root) => {
    const modalEl = root.querySelector('.modal');
    if (modalEl) { modalEl.style.maxWidth = '1100px'; modalEl.style.maxHeight = '92vh'; modalEl.style.overflowY = 'auto'; }
    const area = root.querySelector('#npc-sheet-area');
    area.innerHTML = '';
    SheetForm.setRuleset('rol');
    SheetForm.setSessionId(sessionId);
    SheetForm.setPortraitAi(true);
    SheetForm.render(area, npc.sheet || {}, false);
  });
}
window.openNpcSheetView = openNpcSheetView;

async function saveCaseNpc(sessionId, npcId, btn) {
  const status = el('npc-case-status');
  const npc = State.npcs.find((entry) => entry.id === npcId) || {};
  const sheet = SheetForm.collect();
  const name = String(sheet.name || npc.name || '').trim();
  if (!name) {
    if (status) { status.textContent = '✕ Enter the NPC name'; status.className = 'save-status error'; }
    return;
  }
  btn.disabled = true;
  if (status) { status.textContent = 'Saving…'; status.className = 'save-status'; }
  try {
    const payload = {
      name,
      role: sheet.occupation || npc.role || '',
      status: npc.status || '',
      location: npc.location || '',
      summary: npc.summary || '',
      notes: npc.notes || '',
      sheet
    };
    await api.updateNpc(npcId, payload);
    State.npcs = await api.getNpcs(sessionId);
    if (status) { status.textContent = '✓ Saved NPC'; status.className = 'save-status ok'; }
  } catch (e) {
    if (status) { status.textContent = `✕ ${e.message}`; status.className = 'save-status error'; }
  } finally {
    btn.disabled = false;
  }
}
window.saveCaseNpc = saveCaseNpc;

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
    SheetForm.setSessionId(null);
    // Central pool: no case ⇒ no style context, so hide the AI portrait
    // buttons here (manual upload/camera/clear stay).
    SheetForm.setPortraitAi(false);
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
    const settings = await Promise.all(sessions.map((s) => api.getSessionSettings(s.id).catch(() => ({ advantage_mode: 'rol', ruleset: 'rol', portrait_style: '' }))));
    sessions.forEach((s, i) => {
      s._adv = (settings[i] && settings[i].advantage_mode) || 'rol';
      s._ruleset = (settings[i] && settings[i].ruleset) || 'rol';
      s._style = (settings[i] && settings[i].portrait_style) || '';
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
    </table></div></div>

    <div class="card">
      <div class="card-header"><div>
        <div class="card-title">Portrait style (per case)</div>
        <div class="card-sub">The art-style half of the auto-generated portrait prompt. Leave blank to use the built-in default (Art Nouveau / Mucha). Try e.g. <em>“photorealistic studio headshot, soft lighting”</em> or <em>“loose graphite pencil sketch on toned paper”</em>. Character framing (bust, headroom) and quality safeguards are kept automatically.</div>
      </div></div>
      ${sessions.map((s) => `<div class="form-group" style="max-width:720px">
        <label>${esc(s.name)}</label>
        <textarea id="case-style-${s.id}" rows="2" spellcheck="false" placeholder="Default: Art Nouveau / Mucha painterly illustration">${esc(s._style || '')}</textarea>
        <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.4rem">
          <button class="btn btn-sm btn-primary" onclick="saveCasePortraitStyle(${s.id}, this)">Save</button>
          <button class="btn btn-sm" onclick="saveCasePortraitStyle(${s.id}, this, true)">Reset to default</button>
        </div>
      </div>`).join('')}
    </div>` : '<div class="empty"><p>No GM case files yet.</p></div>'}`;
}

async function saveCasePortraitStyle(sessionId, btn, reset) {
  const ta = el(`case-style-${sessionId}`);
  const style = reset ? '' : ((ta && ta.value) || '').trim();
  btn.disabled = true;
  try {
    const r = await api.setSessionSettings(sessionId, { portrait_style: style });
    if (ta) ta.value = r.portrait_style || '';
    showAlert(reset ? 'Reset to the default portrait style.' : 'Portrait style saved.', 'success', 'cases-alert');
  } catch (e) {
    showAlert(e.message, 'danger', 'cases-alert');
  } finally {
    btn.disabled = false;
  }
}
window.saveCasePortraitStyle = saveCasePortraitStyle;

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
  let svc;
  try {
    info = await api.getLlmModels();
  } catch (e) {
    host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  try {
    svc = await api.getLlmServices();
  } catch {
    svc = { ollama: { url: '', default: '' }, comfyui: { url: '', default: '' } };
  }
  let cm;
  try {
    cm = await api.getComfyModels();
  } catch {
    cm = { models: [], image: { current: '', default: '' }, edit: { current: '', default: '' }, error: 'Could not reach ComfyUI' };
  }
  const cmModels = Array.isArray(cm.models) ? cm.models : [];
  const comfySelect = (id, kind, match) => {
    const cur = (cm[kind] && cm[kind].current) || '';
    const dft = (cm[kind] && cm[kind].default) || '';
    let opts = cmModels.filter((m) => match.test(m));
    if (cur && !opts.includes(cur)) opts = [cur, ...opts];
    return opts.length
      ? `<select id="${id}">${opts.map((m) => `<option value="${esc(m)}"${m === cur ? ' selected' : ''}>${esc(m)}${m === dft ? ' (default)' : ''}</option>`).join('')}</select>`
      : `<input type="text" id="${id}" value="${esc(cur)}" placeholder="default: ${esc(dft)}" spellcheck="false" autocomplete="off">`;
  };
  // Server now returns [{ name, context }] (filtered to >=64K). Normalise and
  // always include the current model even if Ollama didn't list it.
  const models = (Array.isArray(info.models) ? info.models : [])
    .map((m) => (typeof m === 'string' ? { name: m, context: null } : m))
    .filter((m) => m && m.name);
  const current = info.current || '';
  const def = info.default || '';
  const options = models.slice();
  if (current && !options.some((m) => m.name === current)) options.unshift({ name: current, context: null });
  const ctxLabel = (c) => (c == null ? '? ctx' : (c >= 1024 ? `${Math.round(c / 1024)}K` : String(c)));
  const ctx = info.context || {};
  const ctxCurrent = Number(ctx.current || ctx.effective || 0);
  const ctxEffective = Number(ctx.effective || ctxCurrent || 0);
  const ctxModelMax = Number(ctx.model_max);
  const ctxAll = (Array.isArray(ctx.all_options) && ctx.all_options.length ? ctx.all_options : [131072, 262144])
    .map(Number).filter((n) => Number.isFinite(n));
  const ctxSupported = Array.isArray(ctx.options) ? ctx.options.map(Number) : ctxAll;
  const contextButtons = ctxAll.map((n) => {
    const supported = ctxSupported.includes(n);
    const selected = n === ctxCurrent || (!ctxAll.includes(ctxCurrent) && n === ctxEffective);
    const title = supported ? `Use ${ctxLabel(n)} context` : `Not supported by ${current || 'the active model'}`;
    return `<button class="btn btn-sm${selected ? ' btn-primary' : ''}" onclick="saveAdminLlmContext(this, ${n})"${supported ? '' : ' disabled'} title="${esc(title)}">${ctxLabel(n)}</button>`;
  }).join('');
  const ctxSub = ctx.error
    ? `Could not read context metadata: ${esc(ctx.error)}`
    : `Model maximum: ${Number.isFinite(ctxModelMax) && ctxModelMax > 0 ? ctxLabel(ctxModelMax) : 'unknown'}. Active request: ${ctxLabel(ctxCurrent)}${ctxEffective && ctxEffective !== ctxCurrent ? `, effective ${ctxLabel(ctxEffective)}` : ''}.`;

  const selector = options.length
    ? `<select id="llm-model-select">
        ${options.map((m) => `<option value="${esc(m.name)}"${m.name === current ? ' selected' : ''}>${esc(m.name)} (${ctxLabel(m.context)})${m.name === def ? ' (default)' : ''}</option>`).join('')}
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
      <div class="form-group" style="max-width:520px">
        <label>LLM context</label>
        <div style="display:flex;gap:0.5rem;align-items:center">
          ${contextButtons}
          <span class="save-status" id="llm-context-status"></span>
        </div>
        <div class="card-sub" style="margin-top:0.35rem">${ctxSub}</div>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-primary" onclick="saveAdminLlmModel(this)">Save</button>
        ${def && current !== def ? `<button class="btn" onclick="saveAdminLlmModel(this, '${esc(def)}')">Reset to default</button>` : ''}
        <span class="save-status" id="llm-status"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div>
        <div class="card-title">Service endpoints</div>
        <div class="card-sub">Base URLs for the Ollama (language) and ComfyUI (image) hosts. Persists in <code>data/app-config.json</code>; leave blank to use the deploy default. Changes take effect immediately — no redeploy.</div>
      </div></div>
      <div id="svc-alert"></div>
      <div class="form-group" style="max-width:560px">
        <label>Ollama URL</label>
        <input type="text" id="svc-ollama" value="${esc(svc.ollama.url || '')}" placeholder="default: ${esc(svc.ollama.default || '')}" spellcheck="false" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group" style="max-width:560px">
        <label>ComfyUI URL</label>
        <input type="text" id="svc-comfyui" value="${esc(svc.comfyui.url || '')}" placeholder="default: ${esc(svc.comfyui.default || '')}" spellcheck="false" autocapitalize="none" autocomplete="off">
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-primary" onclick="saveAdminLlmServices(this)">Save</button>
        <button class="btn" onclick="saveAdminLlmServices(this, true)">Reset both to default</button>
        <span class="save-status" id="svc-status"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div>
        <div class="card-title">ComfyUI image models</div>
        <div class="card-sub">Which installed ComfyUI model drives each task. <strong>Generation</strong> = Random portrait &amp; GM handouts (text→image); <strong>Edit</strong> = “Style this picture” (image→image). Lists are filtered by name (“image” / “edit”); persists in <code>data/app-config.json</code>, effective immediately.</div>
      </div></div>
      ${cm.error ? `<div class="alert alert-danger">Couldn’t list models from ComfyUI (${esc(cm.error)}). You can still type a model filename below.</div>` : ''}
      <div id="cmodel-alert"></div>
      <div class="form-group" style="max-width:560px">
        <label>Image generation model</label>
        ${comfySelect('cmodel-image', 'image', /image/i)}
      </div>
      <div class="form-group" style="max-width:560px">
        <label>Image edit model</label>
        ${comfySelect('cmodel-edit', 'edit', /edit/i)}
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-primary" onclick="saveAdminComfyModels(this)">Save</button>
        <button class="btn" onclick="saveAdminComfyModels(this, true)">Reset both to default</button>
        <span class="save-status" id="cmodel-status"></span>
      </div>
    </div>`;
}

async function saveAdminComfyModels(btn, reset) {
  const image = reset ? '' : ((el('cmodel-image') && el('cmodel-image').value) || '').trim();
  const edit = reset ? '' : ((el('cmodel-edit') && el('cmodel-edit').value) || '').trim();
  btn.disabled = true;
  try {
    await api.setComfyModels({ image_model: image, edit_model: edit });
    showAlert(reset ? 'Both ComfyUI models reset to default.' : 'ComfyUI models saved.', 'success', 'cmodel-alert');
    await renderAdminLlm();
  } catch (e) {
    showAlert(e.message || 'Could not save the ComfyUI models', 'danger', 'cmodel-alert');
  } finally {
    btn.disabled = false;
  }
}
window.saveAdminComfyModels = saveAdminComfyModels;

async function saveAdminLlmServices(btn, reset) {
  const ollama = reset ? '' : ((el('svc-ollama') && el('svc-ollama').value) || '').trim();
  const comfyui = reset ? '' : ((el('svc-comfyui') && el('svc-comfyui').value) || '').trim();
  btn.disabled = true;
  try {
    await api.setLlmServices({ ollama_url: ollama, comfyui_url: comfyui });
    showAlert(reset ? 'Both service URLs reset to default.' : 'Service URLs saved.', 'success', 'svc-alert');
    await renderAdminLlm();
  } catch (e) {
    showAlert(e.message || 'Could not save the service URLs', 'danger', 'svc-alert');
  } finally {
    btn.disabled = false;
  }
}
window.saveAdminLlmServices = saveAdminLlmServices;

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

async function saveAdminLlmContext(btn, numCtx) {
  const status = el('llm-context-status');
  const label = Number(numCtx) >= 1024 ? `${Math.round(Number(numCtx) / 1024)}K` : String(numCtx);
  btn.disabled = true;
  if (status) { status.textContent = 'Saving...'; status.className = 'save-status'; }
  try {
    await api.setLlmContext(numCtx);
    if (status) { status.textContent = `${label} saved`; status.className = 'save-status saved'; }
    await renderAdminLlm();
  } catch (e) {
    if (status) { status.textContent = e.message || 'Could not save context'; status.className = 'save-status error'; }
    showAlert(e.message || 'Could not save context', 'danger', 'llm-alert');
  } finally {
    btn.disabled = false;
  }
}
window.saveAdminLlmContext = saveAdminLlmContext;

// ── About tab ────────────────────────────────────────────────────────────────
function loadAboutTab() {
  const tab = el('tab-about');
  if (!tab) return;
  const m = APP_METADATA;
  tab.innerHTML = `
    <div class="page-header"><h2>About The Folly</h2></div>

    <div class="card about-card">
      <section class="about-hero">
        <figure class="about-portrait-frame">
          <img class="about-portrait" src="${esc(m.authorPortrait)}" alt="Rivers of London – The Folly" />
        </figure>
        <div class="about-copy">
          <p>
            <strong>The Folly – Investigator Case Files</strong> is a fan-made companion
            for the <a class="about-inline-link" href="${esc(m.inspirationUrl)}" target="_blank" rel="noreferrer">Rivers of London</a>
            tabletop RPG. It keeps a gaming group's character sheets, NPCs, scenario
            notes and dice rolls in one shared place so the GM and players can focus
            on the story instead of the paperwork.
          </p>
          <p>
            It grew out of running the game at home: tracking sheets across scraps of
            paper never lasted past the first session. This pulls everything together —
            multi-user GM/Player roles, an embedded rulebook, the solo Domestic
            adventure, AI portrait generation, and one-click export to the printed
            character sheet PDF.
          </p>
          <p>
            Rivers of London is © Ben Aaronovitch and the game is published by Chaosium /
            Just Crunch Games. This project is an unofficial aid and is not affiliated
            with or endorsed by the rights holders.
          </p>
        </div>
      </section>

      <div class="about-links">
        <a class="btn btn-primary about-link-button" href="${esc(m.donationUrl)}" target="_blank" rel="noreferrer">Make a donation</a>
        <a class="btn about-link-button" href="${esc(m.repositoryUrl)}" target="_blank" rel="noreferrer">GitHub repository</a>
      </div>

      <div class="card about-meta-card">
        <div class="card-title">Project</div>
        <ul class="about-meta-list">
          <li><span>License</span><strong>${esc(m.licenseName)}</strong></li>
          <li><span>Repository</span><a class="about-inline-link" href="${esc(m.repositoryUrl)}" target="_blank" rel="noreferrer">${esc(m.repositoryLabel)}</a></li>
          <li><span>Build</span><code>${esc(m.buildRef)}</code></li>
          <li><span>Date</span><time datetime="${esc(m.buildDate)}">${esc(m.buildDate)}</time></li>
        </ul>
      </div>
    </div>`;
}

// ── Rules tab ────────────────────────────────────────────────────────────────
async function loadRulesTab() {
  const tab = el('tab-rules');
  if (!tab) return;

  if (!State.rulesIndex) {
    try {
      State.rulesIndex = await api.getRules();
    } catch (e) {
      tab.innerHTML = `
        <div class="page-header"><h2>Rules Library</h2></div>
        <div class="alert alert-danger">${esc(e.message)}</div>`;
      return;
    }
  }
  const idx = State.rulesIndex;

  tab.innerHTML = `
    <div class="page-header rules-print-actions">
      <h2>${esc(idx.title || 'Rules Library')}</h2>
      <button class="btn btn-primary" type="button" onclick="printRulesTab()">Print rules</button>
    </div>
    <article class="rules-document">
      <div class="print-cover"><h1>${esc(idx.title || 'Rivers of London Compact Rules Reference')}</h1></div>
      <div class="print-section">${idx.html || '<p>(no rule files found)</p>'}</div>
    </article>`;
}

function printRulesTab() {
  const doc = document.querySelector('#tab-rules .rules-document');
  if (doc) doc.classList.add('print-doc');
  document.body.classList.add('rules-print-mode');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('rules-print-mode');
    if (doc) doc.classList.remove('print-doc');
  }, 500);
}
window.printRulesTab = printRulesTab;

function rulesChatLogHtml() {
  const st = State.rulesChat;
  if (!st.messages.length) {
    return '<div class="empty" style="padding:1.5rem"><p>Ask about a mechanic, a roll, character creation, skills, Luck, or magic. This chat is grounded in the compact rules only.</p></div>';
  }
  return st.messages.map((m) => {
    const who = m.role === 'user' ? 'You' : 'Assistant';
    const markdownBody = m.role === 'assistant';
    let body = markdownBody ? renderAiMarkdown(m.content || '') : esc(m.content || '');
    if (m.streaming) body += '<span class="gmchat-caret">▍</span>';
    if (m.error) body += `<div class="gmchat-error">Error: ${esc(m.error)}</div>`;
    return `<div class="gmchat-msg gmchat-${m.role}"><div class="gmchat-who">${who}</div><div class="gmchat-body${markdownBody ? ' gmchat-markdown-body' : ''}">${body || '<em style="color:var(--text2)">...</em>'}</div></div>`;
  }).join('');
}

function renderRulesChatLog() {
  const log = el('rules-chat-log');
  if (!log) return;
  log.innerHTML = rulesChatLogHtml();
  log.scrollTop = log.scrollHeight;
}

function setRulesChatStreaming(on) {
  const send = el('rules-chat-send');
  const stop = el('rules-chat-stop');
  const text = el('rules-chat-text');
  if (send) send.style.display = on ? 'none' : '';
  if (stop) stop.style.display = on ? '' : 'none';
  if (text) text.disabled = on;
}

function rulesChatKey(ev) {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    sendRulesChat();
  }
}
window.rulesChatKey = rulesChatKey;

async function sendRulesChat() {
  const st = State.rulesChat;
  if (st.streaming) return;
  const textEl = el('rules-chat-text');
  const text = (textEl && textEl.value || '').trim();
  if (!text) return;
  textEl.value = '';
  st.messages.push({ role: 'user', content: text });
  const reply = { role: 'assistant', content: '', streaming: true };
  st.messages.push(reply);
  renderRulesChatLog();
  await runRulesStream(reply);
}
window.sendRulesChat = sendRulesChat;

async function runRulesStream(reply) {
  const st = State.rulesChat;
  const cut = st.messages.indexOf(reply);
  const payload = st.messages.slice(0, cut < 0 ? st.messages.length : cut)
    .map(({ role, content }) => ({ role, content }));
  reply.content = '';
  reply.error = null;
  reply.streaming = true;
  st.controller = new AbortController();
  st.streaming = true;
  setRulesChatStreaming(true);
  llmPendingBegin('Rules Chat');
  renderRulesChatLog();
  try {
    const res = await fetch('/api/rules/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ messages: payload, sessionId: State.currentSession || null }),
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
      if (obj.delta) { reply.content += obj.delta; renderRulesChatLog(); }
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
    else reply.error = e.message || 'Rules chat failed';
  } finally {
    reply.streaming = false;
    if (!reply.content && !reply.error) st.messages = st.messages.filter((m) => m !== reply);
    st.streaming = false;
    st.controller = null;
    setRulesChatStreaming(false);
    llmPendingEnd();
    renderRulesChatLog();
  }
}

function stopRulesChat() {
  const st = State.rulesChat;
  if (st.controller) st.controller.abort();
}
window.stopRulesChat = stopRulesChat;

function clearRulesChat() {
  const st = State.rulesChat;
  if (st.streaming) return;
  st.messages = [];
  renderRulesChatLog();
}
window.clearRulesChat = clearRulesChat;

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
  SheetForm.setSessionId(State.currentSession);
  SheetForm.setPortraitAi(true);
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
      <div style="display:flex;gap:.5rem;align-items:center">
        <a class="btn" href="/api/admin/backup" title="Download a .zip of the entire data folder — SQLite DB, case files, galleries, config">⤓ Data backup (.zip)</a>
        <button class="btn btn-primary" onclick="openCreateUser()">+ New account</button>
      </div>
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
window.loadAboutTab = loadAboutTab;
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
