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
  npcChat: { sessionId: null, slug: null, name: '', messages: [], streaming: false, controller: null },
  npcPersonasCache: {},  // sessionId -> [{slug,name}]
  aiSupportMode: {},  // per-session AI Support mode: 'gm' | 'rules' | 'npc'
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
  llmCloud: false,        // cloud model → AI busy/cancel state is browser-local
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
    ...(d.expert_skills || []),
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
  // If the debounced autosave is still pending, persist it synchronously
  // before we drop the in-memory sheet — otherwise the user's last edit
  // disappears when we reload from localStorage on the way back in.
  if (State.domesticSaveTimer) {
    clearTimeout(State.domesticSaveTimer);
    State.domesticSaveTimer = null;
    if (State.domesticSheet) {
      try { api.saveDomesticSheet(State.domesticSheet); } catch {}
    }
  }
  if (!preserveAdventure) State.domesticAdventure = null;
  State.domesticCurrentStep = null;
  State.domesticSavedStep = null;
  State.domesticProgressLoaded = false;
  State.domesticSheet = null;
  State.domesticSheetLoaded = false;
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
        <span id="nav-capture-status" class="llm-status" hidden title="Live session capture is recording">
          <span class="llm-dot" style="background:#e33"></span><span class="cap-text">Recording…</span>
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
  if (status && typeof status.cloud === 'boolean') State.llmCloud = status.cloud;
  // With a cloud model there is no shared GPU, so a busy server says nothing about
  // *this* browser: ignore the server-global busy/cancel and track only local work.
  const serverBusy = State.llmCloud ? false : !!(status && status.busy);
  const busy = serverBusy || State.llmLocalPending > 0;
  State.llmBusy = busy;
  const serverCanCancel = State.llmCloud ? false : !!(status && status.can_cancel && status.kind !== 'image');
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
    // Cloud: aborting this browser's stream (below) is the whole cancel — the
    // global /llm/cancel would stop every other user's generation too.
    if (!State.llmCloud) await api.cancelLlm();
  } catch (e) {
    showAlert(e.message || 'Could not stop the language model', 'danger', 'scenario-alert');
  } finally {
    if (active && active.controller) {
      try { active.controller.abort(); } catch (_) {}
    }
    if (!State.llmCloud) pollLlmStatusOnce();
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
  // Cloud mode owns busy state in the browser, so there is nothing to poll the
  // server for — the local pending count drives the indicator directly.
  if (State.llmCloud) return;
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
      <div class="sheet-tab" data-session-panel="player-info" onclick="switchSessionPanel(${sessionId}, 'player-info')">Character Stories</div>
      <div class="sheet-tab" data-session-panel="entities" onclick="switchSessionPanel(${sessionId}, 'entities')">Places/NPC/Things</div>
      ${isGM ? `<div class="sheet-tab" data-session-panel="gm-info" onclick="switchSessionPanel(${sessionId}, 'gm-info')">GM Info</div>` : ''}
      ${isGM ? `<div class="sheet-tab" data-session-panel="raw-data" onclick="switchSessionPanel(${sessionId}, 'raw-data')">Edit Files</div>` : ''}
      ${isGM ? `<div class="sheet-tab" data-session-panel="case-settings" onclick="switchSessionPanel(${sessionId}, 'case-settings')">Settings</div>` : ''}
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
    else if (panel === 'case-settings') await renderSessionSettings(sessionId);
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
  const isGM = State.user.role === 'gm';
  const b = (m, label) => `<button type="button" class="btn btn-sm${mode === m ? ' active' : ''}" onclick="setAiSupportMode(${sessionId}, '${m}')">${label}</button>`;
  return `<div class="gmchat-mode" role="group" aria-label="AI Support mode">
    ${isGM ? b('gm', '💬 GM Chat') : ''}
    ${b('rules', '📖 Rules')}
    ${b('npc', '🎭 NPCs')}
  </div>`;
}

function setAiSupportMode(sessionId, mode) {
  const next = ['gm', 'rules', 'npc'].includes(mode) ? mode : 'gm';
  // Leaving the NPC sub-tab ends the carried-over conversation.
  if (next !== 'npc' && State.aiSupportMode[sessionId] === 'npc') resetNpcChat();
  State.aiSupportMode[sessionId] = next;
  renderSessionAiSupport(sessionId);
}
window.setAiSupportMode = setAiSupportMode;

async function renderSessionAiSupport(sessionId) {
  const isGM = State.user.role === 'gm';
  const mode = State.aiSupportMode[sessionId] || 'gm';
  if (mode === 'npc') {
    return renderSessionNpcChat(sessionId);
  }
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
        ${aiSupportToggleHtml(sessionId, 'rules')}
        <button class="btn btn-sm" onclick="clearRulesChat()">Clear</button>
      </div>
    </div>
    <div id="rules-chat-alert"></div>
    <div class="gmchat-wrap">
      <div class="gmchat-log" id="rules-chat-log"></div>
      <div class="gmchat-compose gmchat-compose-inline">
        <textarea id="rules-chat-text" rows="3" placeholder="Ask how a rule works, or how it applies${isGM ? ' to a character' : ' to your character'}…" onkeydown="rulesChatKey(event)"></textarea>
        <div class="gmchat-actions gmchat-actions-side">
          ${chatMicBtnHtml('rules-chat-mic')}
          <button class="btn btn-primary" id="rules-chat-send" onclick="sendRulesChat()">Send</button>
          <button class="btn" id="rules-chat-stop" onclick="stopRulesChat()" style="display:none">Stop</button>
        </div>
      </div>
    </div>`;
  renderRulesChatLog();
  setRulesChatStreaming(State.rulesChat.streaming);
  wireChatMic('rules-chat-mic', 'rules-chat-text', sessionId);
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
          ${chatMicBtnHtml('gmchat-mic')}
          <button class="btn btn-primary" id="gmchat-send" onclick="sendGmChat(${sessionId})">Send</button>
          <button class="btn" id="gmchat-stop" onclick="stopGmChat(${sessionId})" style="display:none">Stop</button>
        </div>
      </div>
    </div>`;
  renderGmChatLog(sessionId);
  setGmChatStreaming(st.streaming);
  wireChatMic('gmchat-mic', 'gmchat-text', sessionId);
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
        SheetForm.setRulesTier('advanced');
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

// Shared player + NPC characters panel. Used by both Case Files → Characters
// (sessionId set ⇒ list is filtered to that case's scope, "+ Assign player"
// and skill-roll buttons appear) and Admin → Characters (sessionId null ⇒
// every player/NPC sheet is visible regardless of scope). The same editor,
// save path (PUT /character-sheets/:id) and owner picker apply to both.
const CharacterPanel = (() => {
  const _ctx = {
    host: null,
    sessionId: null,
    sessionName: null,
    ruleset: 'rol',
    rulesTier: 'basic',
    preferredCharId: null,
    preferredUserId: null,
    characters: [],
    users: [],
    assignedPlayers: []
  };

  async function render(host, opts) {
    _ctx.host = host;
    _ctx.sessionId = (opts && opts.sessionId) || null;
    _ctx.sessionName = (opts && opts.sessionName) || null;
    _ctx.ruleset = (opts && opts.ruleset) || 'rol';
    _ctx.rulesTier = (opts && opts.rulesTier) === 'advanced' ? 'advanced' : 'basic';
    _ctx.preferredCharId = (opts && opts.preferredCharId) || null;
    _ctx.preferredUserId = (opts && opts.preferredUserId) || null;
    await refresh();
  }

  async function refresh() {
    const { host, sessionId } = _ctx;
    if (!host) return;
    host.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading characters…</p>';
    try {
      const charFilter = sessionId ? { caseId: sessionId } : {};
      const [chars, users, players] = await Promise.all([
        api.getCharacters(charFilter),
        api.getUsers().catch(() => []),
        sessionId ? api.getSessionPlayers(sessionId).catch(() => []) : Promise.resolve([])
      ]);
      _ctx.characters = chars;
      _ctx.users = users;
      _ctx.assignedPlayers = players;
      // Mirror onto State so other code (case-allocation modal, etc.) keeps
      // the same lookups it had under the legacy renderAdminCharacters /
      // renderGMSessionView functions.
      State.characters = chars;
      State.npcs = chars.filter((c) => c.owner === 'NPC');
      State.users = users;
    } catch (e) {
      host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
      return;
    }
    paint();
  }

  function paint() {
    const { host, sessionId, characters, assignedPlayers } = _ctx;
    const playerChars = characters.filter((c) => c.owner !== 'NPC');
    const npcs = characters.filter((c) => c.owner === 'NPC');

    // In case mode, weave session-assigned players who don't yet have a sheet
    // into the player strip as "empty" tabs. Filling and saving one creates a
    // new character_sheets row scoped to this case.
    const charByUser = new Map(
      playerChars.filter((c) => c.user_id != null).map((c) => [Number(c.user_id), c])
    );
    let playerTabs;
    if (sessionId) {
      const fromAssigned = assignedPlayers.map((p) => {
        const existing = charByUser.get(Number(p.id));
        return existing
          ? { kind: 'char', char: existing }
          : { kind: 'new', userId: p.id, username: p.username };
      });
      // Edge case: a player's character is in this case's scope but the
      // session_players row was removed. Still surface so the GM can edit.
      const orphan = playerChars
        .filter((c) => c.user_id != null && !assignedPlayers.some((p) => Number(p.id) === Number(c.user_id)))
        .map((c) => ({ kind: 'char', char: c }));
      playerTabs = fromAssigned.concat(orphan);
    } else {
      playerTabs = playerChars.map((c) => ({ kind: 'char', char: c }));
    }

    const playerStripBody = playerTabs.length
      ? `<div class="sheet-tabs" id="cp-player-tabs" style="flex:1 1 auto">${playerTabs.map(tabHtml).join('')}</div>`
      : `<p class="card-sub" style="margin:0">${sessionId ? 'No players assigned to this case.' : 'No player character sheets yet.'}</p>`;
    const assignBtn = sessionId
      ? `<button class="btn btn-sm" onclick="openAssignPlayer(${sessionId})">+ Assign player</button>`
      : '';

    const npcStripBody = npcs.length
      ? `<div class="sheet-tabs" id="cp-npc-tabs" style="flex:1 1 auto">${npcs.map((n) =>
          `<div class="sheet-tab" id="cpn_${n.id}" onclick="CharacterPanel.select('char',${n.id})">${esc(n.name || '(no name)')}</div>`
        ).join('')}</div>`
      : `<p class="card-sub" style="margin:0">${sessionId ? 'No NPCs allocated to this case.' : 'No NPCs yet.'}</p>`;

    host.innerHTML = `
      ${sessionId ? '' : '<div class="page-header"><h2>Characters</h2></div>'}
      <div id="cp-alert"></div>
      <div style="color:var(--text2);font-size:0.85rem;margin:0 0 0.35rem">Player characters</div>
      <div style="margin-bottom:1rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
        ${playerStripBody}
        ${assignBtn}
      </div>
      <div style="color:var(--text2);font-size:0.85rem;margin:0 0 0.35rem">NPCs</div>
      <div style="margin-bottom:1rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
        ${npcStripBody}
        ${sessionId ? `<button class="btn btn-sm" onclick="openAddNpcToCase(${sessionId})">+ Add existing NPC</button>` : ''}
        <button class="btn btn-sm btn-primary" onclick="openNpcSheet()">+ New NPC</button>
      </div>
      <div style="margin-bottom:1rem;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
        <span id="cp-viewing-label" style="color:var(--text2);font-size:0.88rem"></span>
        <span id="cp-tab-actions"></span>
      </div>
      <div id="cp-sheet-area"><p style="color:var(--text2);padding:1rem">Select a character above to view their sheet.</p></div>
    `;

    // Auto-select: caller's preferredCharId wins; else the GM's remembered
    // player for this case (preferredUserId); else first available tab.
    let initial = null;
    if (_ctx.preferredCharId) {
      const found = [...playerTabs, ...npcs.map((n) => ({ kind: 'char', char: n }))]
        .find((t) => t.kind === 'char' && t.char.id === _ctx.preferredCharId);
      if (found) initial = found;
    }
    if (!initial && _ctx.preferredUserId != null) {
      initial = playerTabs.find((t) =>
        (t.kind === 'char' && Number(t.char.user_id) === Number(_ctx.preferredUserId))
        || (t.kind === 'new' && Number(t.userId) === Number(_ctx.preferredUserId))
      );
    }
    if (!initial) initial = playerTabs[0] || (npcs.length ? { kind: 'char', char: npcs[0] } : null);
    if (initial) {
      if (initial.kind === 'char') select('char', initial.char.id);
      else select('new', initial.userId, initial.username);
    }
  }

  function tabHtml(t) {
    if (t.kind === 'new') {
      return `<div class="sheet-tab" id="cpu_${t.userId}" onclick="CharacterPanel.select('new',${t.userId},'${esc(t.username)}')">
        ${esc(t.username)} <span style="opacity:0.5;font-size:0.75rem">(empty)</span>
      </div>`;
    }
    const c = t.char;
    const label = c.name || (c.username ? `(${c.username})` : '(no name)');
    const sub = c.username && c.name ? ` <span style="opacity:0.6;font-size:0.75rem">(${esc(c.username)})</span>` : '';
    return `<div class="sheet-tab" id="cpc_${c.id}" onclick="CharacterPanel.select('char',${c.id})">${esc(label)}${sub}</div>`;
  }

  function clearActiveTabs() {
    document.querySelectorAll('#cp-player-tabs .sheet-tab, #cp-npc-tabs .sheet-tab')
      .forEach((t) => t.classList.remove('active'));
  }

  async function select(kind, id, username) {
    if (kind === 'new') return selectNew(id, username);
    return selectChar(id);
  }

  async function selectChar(charId) {
    const { sessionId, ruleset, rulesTier, characters, users } = _ctx;
    const char = characters.find((c) => c.id === charId);
    if (!char) return;
    _ctx.preferredCharId = charId;
    State.currentSheetUserId = char.user_id == null ? null : char.user_id;
    if (sessionId && char.user_id != null) storeGmPlayerId(sessionId, char.user_id);
    clearActiveTabs();
    const tab = el(`cpc_${charId}`) || el(`cpn_${charId}`);
    if (tab) tab.classList.add('active');

    const ownerTag = char.owner === 'NPC' ? 'NPC' : `Player${char.username ? ` — ${char.username}` : ''}`;
    el('cp-viewing-label').textContent = `Viewing: ${char.name || '(no name)'} (${ownerTag})`;

    const ownerOptions = [
      `<option value=""${char.user_id == null ? ' selected' : ''}>NPC (no owner)</option>`,
      ...(users || []).filter((u) => u && u.username).map((u) =>
        `<option value="${u.id}"${Number(char.user_id) === Number(u.id) ? ' selected' : ''}>${esc(u.username)}${u.role === 'gm' ? ' (GM)' : ''}</option>`)
    ].join('');
    const actions = [
      `<label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.85rem;color:var(--text2)">
        Owner: <select id="cp-owner-select" onchange="CharacterPanel.changeOwner(${charId}, this.value)">${ownerOptions}</select>
      </label>`,
      `<button class="btn btn-sm" onclick="openCharacterCases(${charId})">Cases…</button>`
    ];
    if (sessionId && char.owner !== 'NPC' && char.user_id != null) {
      actions.push(`<button class="btn btn-sm" onclick="removePlayerFromSession(${sessionId}, ${char.user_id})">Remove from session</button>`);
    }
    if (char.owner === 'NPC') {
      actions.push(`<button class="btn btn-sm btn-danger" onclick="CharacterPanel.deleteChar(${charId})">Delete</button>`);
    }
    el('cp-tab-actions').innerHTML = actions.join(' ');

    const area = el('cp-sheet-area');
    area.innerHTML = '';
    SheetForm.setRuleset((char.sheet && char.sheet.ruleset) || ruleset || 'rol');
    SheetForm.setRulesTier(char.owner === 'NPC' ? 'advanced' : (rulesTier || 'basic'));
    SheetForm.setGmEditor(!!(State.user && State.user.role === 'gm'));
    SheetForm.setSessionId(sessionId);
    SheetForm.setPortraitAi(true);
    SheetForm.render(area, char.sheet || {}, false);
    area.insertAdjacentHTML('beforeend', `
      <div class="sheet-actions">
        <button class="btn btn-primary" onclick="CharacterPanel.saveChar(${charId})">Save</button>
        <button class="btn" onclick="exportPdf()">Export PDF</button>
        <span class="save-status" id="save-status"></span>
      </div>`);
    if (sessionId) {
      // Skill-roll buttons are case-scoped; they'll migrate off characters in
      // a later pass. NPCs (user_id null) get them too but no rolls will
      // match, so the buttons render inert.
      try { attachSkillRollButtons(area, await buildSkillRollCtx(sessionId, char.user_id, true)); } catch {}
    }
    if (sessionId && char.name) { try { await appendCharacterFiles('cp-sheet-area', sessionId, char.name); } catch {} }
    if (sessionId && char.id) { try { await mountPersonalityEditor('cp-sheet-area', sessionId, char.id, char.name || '', true); } catch {} }
  }

  async function selectNew(userId, username) {
    const { sessionId, ruleset, rulesTier } = _ctx;
    _ctx.preferredCharId = null;
    _ctx.preferredUserId = userId;
    State.currentSheetUserId = userId;
    if (sessionId) storeGmPlayerId(sessionId, userId);
    clearActiveTabs();
    const tab = el(`cpu_${userId}`);
    if (tab) tab.classList.add('active');
    el('cp-viewing-label').textContent = `Viewing: ${username} (Player — empty)`;
    el('cp-tab-actions').innerHTML = sessionId
      ? `<button class="btn btn-sm" onclick="removePlayerFromSession(${sessionId}, ${userId})">Remove from session</button>`
      : '';
    const area = el('cp-sheet-area');
    area.innerHTML = '';
    SheetForm.setRuleset(ruleset || 'rol');
    SheetForm.setRulesTier(rulesTier || 'basic');
    SheetForm.setGmEditor(!!(State.user && State.user.role === 'gm'));
    SheetForm.setSessionId(sessionId);
    SheetForm.setPortraitAi(true);
    SheetForm.render(area, {}, false);
    area.insertAdjacentHTML('beforeend', `
      <div class="sheet-actions">
        <button class="btn btn-primary" onclick="CharacterPanel.createForUser(${userId})">Save</button>
        <button class="btn" onclick="exportPdf()">Export PDF</button>
        <span class="save-status" id="save-status"></span>
      </div>`);
    if (sessionId) {
      try { attachSkillRollButtons(area, await buildSkillRollCtx(sessionId, userId, true)); } catch {}
    }
  }

  async function saveChar(charId) {
    const status = el('save-status');
    if (status) { status.textContent = 'Saving…'; status.className = 'save-status'; }
    try {
      const char = (_ctx.characters || []).find((c) => c.id === charId) || {};
      const sheet = SheetForm.collect();
      const name = String(sheet.name || char.name || '').trim();
      if (!name) {
        if (status) { status.textContent = '✕ Enter the name (Personal Info → Name).'; status.className = 'save-status error'; }
        return;
      }
      // PUT /character-sheets/:id preserves existing owner and (per the
      // scope-explicit guard in the route) existing scope. Editing case
      // allocations is the dedicated job of openCharacterCases().
      const payload = { name, role: sheet.occupation || char.role || '', sheet };
      await api.updateNpc(charId, payload);
      if (status) { status.textContent = '✓ Saved'; status.className = 'save-status saved'; }
      const filter = _ctx.sessionId ? { caseId: _ctx.sessionId } : {};
      _ctx.characters = await api.getCharacters(filter);
      State.characters = _ctx.characters;
      State.npcs = _ctx.characters.filter((c) => c.owner === 'NPC');
    } catch (e) {
      if (status) { status.textContent = `✕ ${e.message}`; status.className = 'save-status error'; }
    }
  }

  async function createForUser(userId) {
    const { sessionName } = _ctx;
    const status = el('save-status');
    if (status) { status.textContent = 'Saving…'; status.className = 'save-status'; }
    try {
      const sheet = SheetForm.collect();
      const name = String(sheet.name || '').trim();
      if (!name) {
        if (status) { status.textContent = '✕ Enter the name (Personal Info → Name).'; status.className = 'save-status error'; }
        return;
      }
      const scope = sessionName ? [sessionName] : [];
      const created = await api.createNpc({
        name, role: sheet.occupation || '', sheet,
        owner: 'player', user_id: userId, scope
      });
      _ctx.preferredCharId = created.id;
      await refresh();
    } catch (e) {
      if (status) { status.textContent = `✕ ${e.message}`; status.className = 'save-status error'; }
    }
  }

  async function changeOwner(charId, rawValue) {
    const select = el('cp-owner-select');
    const previous = (_ctx.characters || []).find((c) => c.id === charId);
    const previousOwnerId = previous && previous.user_id != null ? String(previous.user_id) : '';
    const userId = String(rawValue || '').trim() === '' ? null : parseInt(rawValue, 10);
    if (rawValue !== '' && !Number.isInteger(userId)) {
      if (select) select.value = previousOwnerId;
      return;
    }
    if (select) select.disabled = true;
    try {
      await api.setCharacterOwner(charId, userId);
      _ctx.preferredCharId = charId;
      await refresh();
    } catch (e) {
      showAlert(e.message, 'danger', 'cp-alert');
      if (select) { select.disabled = false; select.value = previousOwnerId; }
    }
  }

  async function deleteChar(charId) {
    if (!confirm('Delete this character?')) return;
    try {
      await api.deleteNpc(charId);
      _ctx.preferredCharId = null;
      await refresh();
    } catch (e) {
      showAlert(e.message, 'danger', 'cp-alert');
    }
  }

  return { render, refresh, select, saveChar, createForUser, changeOwner, deleteChar };
})();
window.CharacterPanel = CharacterPanel;

async function renderGMSessionView(sessionId, preferredUserId = null) {
  let settings;
  try { settings = await api.getSessionSettings(sessionId); } catch { settings = { ruleset: 'rol', rules_tier: 'basic' }; }
  const session = (State.sessions || []).find((s) => Number(s.id) === Number(sessionId)) || {};
  await CharacterPanel.render(el('session-content'), {
    sessionId,
    sessionName: session.name || null,
    ruleset: (settings && settings.ruleset) || 'rol',
    rulesTier: (settings && settings.rules_tier) === 'advanced' ? 'advanced' : 'basic',
    preferredUserId
  });
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
  SheetForm.setRulesTier((sheet && sheet.rules_tier) === 'advanced' ? 'advanced' : 'basic');
  SheetForm.setGmEditor(!!(State.user && State.user.role === 'gm'));
  SheetForm.setSessionId(sessionId);
  SheetForm.setPortraitAi(true);
  SheetForm.render(el('sheet-form-area'), hasSheet ? sheet.data : {}, false);
  try { attachSkillRollButtons(el('sheet-form-area'), await buildSkillRollCtx(sessionId, State.user.id, false)); } catch (e) { /* non-fatal */ }
  try { await appendCharacterFiles('sheet-form-area', sessionId, (sheet && sheet.data && sheet.data.name) || ''); } catch { /* non-fatal */ }
  try { await mountPersonalityEditor('sheet-form-area', sessionId, sheet && sheet.id, (sheet && sheet.data && sheet.data.name) || '', true); } catch { /* non-fatal */ }
}

// Surface the character-specific Markdown files (persona, etc.) at the foot of
// a sheet — matched by filename root = character name, same association the rest
// of the app uses. Player view only sees player-visible files.
async function appendCharacterFiles(hostId, sessionId, charName) {
  const host = el(hostId);
  const want = String(charName || '').trim().toLowerCase();
  if (!host || !sessionId || !want) return;
  let sources;
  try { sources = await api.getSessionScenarioSources(sessionId); } catch { return; }
  const files = scenarioArray(sources && sources.markdown_sources).filter((f) => {
    const base = String(f.relative_path || f.path || '').split('/').pop().replace(/\.md$/i, '').toLowerCase();
    return base === want || base.startsWith(`${want} `) || base.startsWith(`${want}-`);
  });
  if (!files.length) return;
  const rows = files.map((f) => {
    const fname = String(f.relative_path || f.path || '').split('/').pop();
    const vis = f.visibility === 'gm' ? 'GM only' : 'Player';
    return `<li style="display:flex;justify-content:space-between;gap:0.5rem;align-items:center;padding:0.15rem 0"><span>${esc(fname)}</span><span style="font-size:0.7rem;color:var(--text2)">${vis}</span></li>`;
  }).join('');
  host.insertAdjacentHTML('beforeend', `
    <div class="card" style="margin-top:1rem">
      <div class="card-header"><div><div class="card-title">Character files</div><div class="card-sub">Markdown linked to ${esc(charName)} by filename.${State.user.role === 'gm' ? ' Edit them in the Edit Files tab.' : ''}</div></div></div>
      <ul style="list-style:none;margin:0;padding:0">${rows}</ul>
    </div>`);
}
window.appendCharacterFiles = appendCharacterFiles;

// Personality / background editor with toggle-to-dictate, generic over whichever
// character is in focus (a player's own sheet, or a GM's NPC). `canEdit` gates
// writing. The text is the same "<Name> - personality.md" handout the
// talk-to-character AI loads. Dictation uses VAD endpointing (the Home Assistant
// model): record continuously, transcribe each utterance at a speech pause, and
// insert it at the textarea cursor.
async function mountPersonalityEditor(hostId, sessionId, characterId, charName, canEdit) {
  const host = el(hostId);
  if (!host || !sessionId || !characterId) return;
  let initial = '';
  try { const r = await api.getCharacterPersonality(sessionId, characterId); initial = (r && r.content) || ''; }
  catch { return; }
  const secure = !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginTop = '1rem';
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Personality &amp; background${charName ? ` — ${esc(charName)}` : ''}</div>
        <div class="card-sub">Free text the AI loads when you talk to this character.</div>
      </div>
      ${canEdit ? `<button class="btn" id="pers-mic"${secure ? '' : ' disabled title="Microphone needs an HTTPS (secure) connection"'}>🎤 Dictate</button>` : ''}
    </div>
    <textarea id="pers-text" rows="8" spellcheck="true" style="width:100%;box-sizing:border-box;font:inherit;padding:0.6rem;border:1px solid var(--border,#ccc);border-radius:6px;resize:vertical"${canEdit ? '' : ' readonly'}></textarea>
    ${canEdit ? `<div style="display:flex;gap:0.6rem;align-items:center;margin-top:0.5rem">
      <button class="btn btn-primary" id="pers-save">Save</button>
      <span class="save-status" id="pers-status"></span>
    </div>` : ''}`;
  host.appendChild(card);
  const ta = card.querySelector('#pers-text');
  ta.value = initial;
  if (!canEdit) return;
  const status = card.querySelector('#pers-status');
  const saveBtn = card.querySelector('#pers-save');
  const norm = (s) => String(s || '').replace(/\r\n?/g, '\n');
  let saved = initial;
  const updateSave = () => { saveBtn.disabled = norm(ta.value) === norm(saved); };
  updateSave();
  ta.addEventListener('input', updateSave);
  saveBtn.addEventListener('click', async () => {
    status.textContent = 'Saving…'; status.className = 'save-status'; saveBtn.disabled = true;
    try {
      await api.saveCharacterPersonality(sessionId, characterId, ta.value);
      saved = ta.value;
      status.textContent = '✓ Saved'; status.className = 'save-status saved';
    } catch (e) { status.textContent = '✕ ' + e.message; status.className = 'save-status error'; }
    updateSave();
  });
  const mic = card.querySelector('#pers-mic');
  // Dictating into a character's personality also enrols the speaker's voice as
  // that character (label kept, audio discarded), so session capture auto-names them.
  if (mic && secure) wireDictation(mic, ta, sessionId, status, charName ? { enrollCharacter: charName } : undefined);
}
window.mountPersonalityEditor = mountPersonalityEditor;

// Toggle-to-dictate with browser-side VAD endpointing. While active we record a
// segment, and on each speech→silence transition we cut it, transcribe that
// utterance via the proxy, and insert the text at the cursor — then immediately
// record the next one. Click again to stop.
function wireDictation(btn, ta, sessionId, status, opts) {
  opts = opts || {};
  const speakerMode = !!opts.speakers; // session capture: identify + label speakers
  status = status || { textContent: '', className: '' }; // tolerate no status element
  let active = false, stream = null, ctx = null, analyser = null, buf = null;
  let recorder = null, chunks = [], speaking = false, silenceStart = 0, raf = 0;
  // Speaker-mode state: online voice clustering + auto block formatting.
  const speakers = []; // { label, centroid:[], count }
  let multi = false, lastSpeaker = null, firstSpeaker = null, firstTs = '', blockStart = null;

  function insertAtCursor(text) {
    const t = String(text || '').trim();
    if (!t) return;
    const pos = (ta.selectionStart != null) ? ta.selectionStart : ta.value.length;
    const before = ta.value.slice(0, pos), after = ta.value.slice(pos);
    const ins = (before && !/\s$/.test(before) ? ' ' : '') + t + (after && !/^\s/.test(after) ? ' ' : '');
    ta.value = before + ins + after;
    ta.selectionStart = ta.selectionEnd = pos + ins.length;
    ta.dispatchEvent(new Event('input', { bubbles: true })); // so Save-state listeners react to dictation
    ta.focus();
  }

  async function flush(blob) {
    if (!blob || blob.size < 1000) return;
    try {
      const b64 = await blobToBase64(blob);
      const payload = { audio_base64: b64, mime: blob.type || 'audio/webm' };
      if (opts.enrollCharacter) payload.enroll_character = opts.enrollCharacter;  // dictation doubles as voiceprint enrolment
      const r = await api.transcribeAudio(sessionId, payload);
      insertAtCursor(r && r.text);
    } catch (e) { status.textContent = '✕ ' + e.message; status.className = 'save-status error'; }
  }

  function startSegment() {
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      flush(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      if (active) startSegment();
    };
    recorder.start();
  }

  function monitor() {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length), now = performance.now();
    if (rms > 0.025) { speaking = true; silenceStart = 0; }
    else if (speaking) {
      if (!silenceStart) silenceStart = now;
      else if (now - silenceStart > 450) {
        speaking = false; silenceStart = 0;
        if (recorder && recorder.state === 'recording') recorder.stop(); // cut → transcribe + restart
      }
    }
    if (active) raf = requestAnimationFrame(monitor);
  }

  async function start() {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { status.textContent = '✕ Mic blocked: ' + e.message; status.className = 'save-status error'; return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
    buf = new Uint8Array(analyser.fftSize);
    ctx.createMediaStreamSource(stream).connect(analyser);
    active = true; speaking = false; silenceStart = 0;
    btn.classList.add('btn-danger'); btn.textContent = '⏹ Stop';
    status.textContent = '● Listening…'; status.className = 'save-status';
    startSegment();
    raf = requestAnimationFrame(monitor);
  }

  function stop() {
    active = false;
    cancelAnimationFrame(raf);
    if (recorder && recorder.state === 'recording') recorder.stop();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    stream = null; ctx = null; analyser = null;
    btn.classList.remove('btn-danger'); btn.textContent = '🎤 Dictate';
    if (status.textContent === '● Listening…') status.textContent = '';
  }

  btn.addEventListener('click', () => { active ? stop() : start(); });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// A compact 🎤 dictate button for a chat compose row, + post-render wiring that
// hooks the same VAD dictation engine to that chat's textarea. Disabled (with a
// reason) when the page isn't a secure context, since getUserMedia needs HTTPS.
function micSupported() {
  return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
function chatMicBtnHtml(id) {
  const ok = micSupported();
  return `<button class="btn" id="${id}" title="${ok ? 'Dictate' : 'Microphone needs an HTTPS (secure) connection'}"${ok ? '' : ' disabled'}>🎤</button>`;
}
function wireChatMic(micId, textId, sessionId) {
  const m = el(micId), t = el(textId);
  if (m && t && micSupported()) wireDictation(m, t, sessionId, null);
}

// ── Session capture (Part B) ────────────────────────────────────────────────
// Continuous recording sliced into ~5-min overlapping lumps → /diarize-chunk →
// canonical-voice-attributed segments, stitched by absolute-time dedup into
// "## Voice/Character  HH:MM" blocks. The voices panel lets the GM name each
// voice; renaming re-labels the whole transcript live and persists.
let _sessionCapture = null;

function renderEfVoicesPanel(voices, sessionId) {
  const host = el('ef-voices');
  if (!host) return;
  if (!voices || !voices.length) { host.innerHTML = ''; return; }   // no card until a capture finds voices
  const rows = (voices || []).map((v) => {
    const others = (voices || []).filter((o) => o.id !== v.id);
    const mergeCtl = others.length
      ? `<select title="This voice is really the same person as another — merge it in (combines the voiceprints, keeps one identity)" onchange="efMergeVoice(${sessionId}, '${esc(v.id)}', this)" style="padding:0.3rem;width:140px;flex:none">
           <option value="">merge into…</option>
           ${others.map((o) => `<option value="${esc(o.id)}">${esc(o.character || o.id)}</option>`).join('')}
         </select>`
      : '';
    return `
    <div style="display:flex;gap:0.5rem;align-items:center;padding:0.25rem 0">
      <strong style="min-width:2.2rem;flex:none">${esc(v.id)}</strong>
      <input value="${esc(v.character || '')}" placeholder="character name…" data-voice="${esc(v.id)}" data-prev="${esc(v.character || v.id)}" onchange="efNameVoice(${sessionId}, this)" style="width:150px;flex:none;padding:0.3rem 0.5rem">
      <button class="btn btn-sm" style="flex:none" title="Forget who this is: keeps the voiceprint (so it stays one voice) but clears the name and marks it unidentified" onclick="efUnidentifyVoice(${sessionId}, '${esc(v.id)}')">unidentify</button>
      ${mergeCtl}
      <button class="btn btn-sm" style="flex:none" title="Delete this voice — only for a genuinely spurious/noise voice. If it's really the same person as another, use ‘merge into’ instead." onclick="efDeleteVoice(${sessionId}, '${esc(v.id)}')">delete</button>
      <span style="font-size:0.78rem;color:var(--text2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">×${v.count} — ${esc(v.sample || '')}</span>
    </div>`;
  }).join('');
  host.innerHTML = `
    <div class="card" style="margin-top:1rem">
      <div class="card-header"><div>
        <div class="card-title">Session voices${voices && voices.length ? ` (${voices.length})` : ''}</div>
        <div class="card-sub">Each distinct voice the capture hears appears here — type a character name to label it everywhere (persists for future sessions). If one person was split into two, use <strong>merge into</strong>; <strong>delete</strong> only a spurious voice.</div>
      </div></div>
      ${rows || '<div class="card-sub" style="padding:0.4rem 0">No voices yet — start a capture and they appear as speakers are heard.</div>'}
    </div>`;
}

async function efNameVoice(sessionId, input) {
  const id = input.dataset.voice, name = input.value.trim();
  const prev = input.dataset.prev || id, next = name || id;
  try { await api.setVoiceCharacter(sessionId, id, name); }
  catch (e) { showAlert(e.message, 'danger', 'scenario-alert'); return; }
  input.dataset.prev = next;
  // Relabel the transcript headers directly in the editor text, so it works
  // whether a capture is running, stopped, or reloaded. Headers carry either the
  // stable voice id ("## v1") or a previously-applied name ("## Tim"); match both.
  const ta = el('scenario-source-editor');
  if (ta) relabelHeaders(ta, [id, prev], next);
  // Keep a running capture's in-memory labels in sync so its next auto-render agrees.
  if (_sessionCapture && _sessionCapture.sessionId === sessionId) {
    if (name) _sessionCapture.voiceName[id] = name; else delete _sessionCapture.voiceName[id];
    if (_sessionCapture.relabelBase) _sessionCapture.relabelBase([id, prev], next);  // keep the preserved prefix in sync
  }
}
window.efNameVoice = efNameVoice;

// GM remedy for a mis-enrolled/mislabelled voice: clear the name but KEEP the
// voiceprint, so the speaker stays a single voice (deleting would re-enrol them
// under a new number). Relabels the transcript headers back to the voice id.
function efUnidentifyVoice(sessionId, voiceId) {
  const host = el('ef-voices');
  const sel = 'input[data-voice="' + (window.CSS && CSS.escape ? CSS.escape(voiceId) : voiceId) + '"]';
  const input = host && host.querySelector(sel);
  if (!input) return;
  input.value = '';
  efNameVoice(sessionId, input);
}
window.efUnidentifyVoice = efUnidentifyVoice;

// Merge a falsely-split voice into another (same person heard as two). Combines the
// voiceprints server-side, then relabels this voice's transcript headers to the target.
async function efMergeVoice(sessionId, fromId, sel) {
  const into = sel && sel.value;
  if (!into) return;
  let voices = [];
  try { const r = await api.mergeVoice(sessionId, fromId, into); voices = (r && r.voices) || []; }
  catch (e) { showAlert(e.message, 'danger', 'scenario-alert'); if (sel) sel.value = ''; return; }
  const target = voices.find((x) => x.id === into);
  const next = (target && target.character) || into;
  const ta = el('scenario-source-editor');
  if (ta) relabelHeaders(ta, [fromId], next);
  if (_sessionCapture && _sessionCapture.sessionId === sessionId) {
    delete _sessionCapture.voiceName[fromId];
    if (_sessionCapture.relabelBase) _sessionCapture.relabelBase([fromId], next);
    if (_sessionCapture.remapVoice) _sessionCapture.remapVoice(fromId, into);
  }
  renderEfVoicesPanel(voices, sessionId);
  applyVoiceNamesToEditor(voices);
}
window.efMergeVoice = efMergeVoice;

// Delete a genuinely spurious voice. Its transcript headers fall back to the
// "speaker pending" marker (…). Prefer merge for a real-but-split speaker.
async function efDeleteVoice(sessionId, voiceId) {
  if (!confirm('Delete voice ' + voiceId + '?\n\nUse “merge into” instead if this is really the same person as another voice.')) return;
  let voices = [];
  try { const r = await api.deleteVoice(sessionId, voiceId); voices = (r && r.voices) || []; }
  catch (e) { showAlert(e.message, 'danger', 'scenario-alert'); return; }
  const ta = el('scenario-source-editor');
  if (ta) relabelHeaders(ta, [voiceId], '…');
  if (_sessionCapture && _sessionCapture.sessionId === sessionId) {
    delete _sessionCapture.voiceName[voiceId];
    if (_sessionCapture.remapVoice) _sessionCapture.remapVoice(voiceId, null);
  }
  renderEfVoicesPanel(voices, sessionId);
}
window.efDeleteVoice = efDeleteVoice;

// Replace transcript headers "## <oldLabel>  …" with "## <next>  …" for any of
// the given old labels (voice id and/or prior name). Marks the editor dirty.
function relabelHeadersStr(text, oldLabels, next) {
  let v = text;
  for (const o of [...new Set(oldLabels.filter((x) => x && x !== next))]) {
    const e = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    v = v.replace(new RegExp('(^|\\n)## ' + e + '(?=\\s)', 'g'), '$1## ' + next);
  }
  return v;
}
function relabelHeaders(ta, oldLabels, next) {
  const v = relabelHeadersStr(ta.value, oldLabels, next);
  if (v !== ta.value) { ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); }
}

// When a captured file opens, apply any names already mapped in the registry so
// the displayed transcript matches (e.g. saved "## v1" → "## Tim").
function applyVoiceNamesToEditor(voices) {
  const ta = el('scenario-source-editor');
  if (!ta || !voices) return;
  for (const v of voices) if (v.character) relabelHeaders(ta, [v.id], v.character);
}

function wireSessionCapture(initialBtn, ta, sessionId) {
  // Two independent layers:
  //  (1) LIVE transcription — VAD-segmented utterances are transcribed and printed
  //      the instant you speak, and KEPT verbatim. These words ARE the transcript;
  //      nothing ever re-writes or removes them (that visual feedback matters).
  //  (2) DIARIZATION — a separate labelling pass over a BIG window (≥ DIAR_MIN, cut
  //      at a sentence-ending full stop). It only attaches the `## speaker` heading
  //      to words layer (1) already wrote; a big window keeps each voice one identity.
  // Audio is streamed to a server buffer (SLICE_SEC) for the diarization pass.
  const SLICE_SEC = 5;          // stream this much audio per upload
  const LIVE_MAX_SEC = 7;       // emit a live chunk after this much unbroken speech (keeps subtitles flowing)
  const DIAR_MIN_SEC = 30;      // diarize incrementally: first labels ~30s in, then
  const DIAR_MAX_SEC = 75;      // every ~30-75s — small windows = no timeout/GPU stall,
                                //   yet enough audio to keep each voice one identity.
  const DIAR_WINDOW_MAX_SEC = 90; // hard cap per call (matches server); but we prefer
                                //   to end the window EARLIER on a real pause so no
                                //   speaker straddles the cut (which fragments voices).
  let btn = initialBtn;   // re-bindable: the editor DOM is recreated on tab navigation,
                          // so a running capture re-attaches to the fresh button (attach()).
  let active = false, stream = null, ctx = null, proc = null, srcNode = null, sink = null;
  let rate = 16000, total = 0, recStartMs = 0;
  let basePrefix = '';    // existing file content captured at start — new transcript is appended below it
  let slice = [], sliceLen = 0, ingestChain = Promise.resolve(), uploading = 0;
  let liveSpk = false, liveSil = 0, liveBuf = [], liveLen = 0, liveStartAbs = 0;
  let diarBusy = false, diarFlushing = false, lastDiarEndSec = 0, statusTimer = null;
  const liveSegs = [];    // {abs,end,text,voice?} live utterances — the kept transcript
  const turns = [];       // {start,end,voice} every diarization turn — for the stop-time label reconcile
  const voiceName = {};   // voiceId -> character

  const pad = (n) => String(n).padStart(2, '0');
  const clockOf = (absSec) => { const d = new Date(recStartMs + absSec * 1000); return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };

  function concatF32(chunks, len) {
    const out = new Float32Array(len); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  function encodeWav(f32, sr) {
    const n = f32.length, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); wr(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) { let s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([ab], { type: 'audio/wav' });
  }
  function f32ToInt16Blob(f32) {     // raw little-endian PCM (no WAV header) for streaming
    const n = f32.length, ab = new ArrayBuffer(n * 2), v = new DataView(ab);
    for (let i = 0, o = 0; i < n; i++, o += 2) { let s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([ab]);
  }
  function rerender() {
    const ta = el('scenario-source-editor');   // look up live: the editor node is recreated on tab nav
    if (!ta) return;                            // editor not mounted now — liveSegs still holds the transcript
    let out = '', last = null, lastEnd = 0;
    const PARA_GAP = 1.5;   // same-speaker pause (s) → paragraph break
    for (const u of liveSegs) {
      const t = (u.text || '').trim();
      if (!t) continue;
      const label = u.voice ? (voiceName[u.voice] || u.voice) : '…';   // '…' = speaker not diarized yet
      if (label !== last) { out += (out ? '\n\n' : '') + `## ${label}  ${clockOf(u.abs)}\n${t}`; last = label; }
      else out += ((u.abs - lastEnd) > PARA_GAP ? '\n\n' : ' ') + t;
      lastEnd = u.end || u.abs;
    }
    // Append this capture's transcript to whatever was already in the file, so a
    // session can be built up across multiple captures (breaks, etc.) without wiping it.
    const pre = basePrefix.replace(/\s+$/, '');
    const followBottom = ta.scrollHeight - ta.scrollTop - ta.clientHeight < 80;  // only autoscroll if already following
    ta.value = pre + (pre && out ? '\n\n' : '') + out;
    if (followBottom) ta.scrollTop = ta.scrollHeight;   // keep incoming speech in view
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Recording status lives in the top nav pill (next to "AI working…"), not on the
  // button — so the button keeps a fixed label and the toolbar never jumps.
  let finishing = false;
  function status() {
    const pill = el('nav-capture-status');
    if (!pill) return;
    if (!active && !finishing) { pill.hidden = true; return; }
    const txt = pill.querySelector('.cap-text');
    if (txt) {
      const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.max(0, Math.floor(s % 60))).padStart(2, '0');
      txt.textContent = finishing ? 'finishing…'
        : `Recording ${mmss(total / rate)} — click to stop` + (diarBusy ? ' · transcribing…' : '') + (uploading ? ' · uploading' : '');
    }
    pill.hidden = false;
    pill.style.cursor = 'pointer';                       // the pill is also the stop control, from any tab
    pill.title = 'Click to stop the live session capture';
    pill.onclick = () => { if (active && !finishing) stop(); };
  }
  let errAt = 0;
  function noteError(msg) {     // surface speech-service failures at the top of the screen (throttled)
    if (Date.now() - errAt > 20000) { errAt = Date.now(); showAlert(msg, 'danger', 'scenario-alert'); }
  }

  // Stream the pending slice to the server, serialised in capture order.
  function flushSlice() {
    if (!sliceLen) return ingestChain;
    const f32 = concatF32(slice, sliceLen); slice = []; sliceLen = 0;
    ingestChain = ingestChain.then(async () => {
      uploading++; status();
      try { await api.ingestAudio(sessionId, await blobToBase64(f32ToInt16Blob(f32))); }
      catch (e) { /* a dropped slice is non-fatal to the running stream */ }
      finally { uploading--; status(); }
    });
    return ingestChain;
  }

  // Diarization result = speaker turns. We use only their times+voice to LABEL the
  // live words we already wrote (the diarized text itself is discarded). Each word's
  // speaker is cached once, so rerender stays cheap and labels never disturb words.
  function mergeResult(r) {
    const newTurns = (r.segments || []).map((s) => ({ start: s.start, end: s.end, voice: s.voice }));
    for (const tn of newTurns) turns.push(tn);
    const upto = (typeof r.cursor_sec === 'number') ? r.cursor_sec
      : (newTurns.length ? newTurns[newTurns.length - 1].end : lastDiarEndSec);
    for (const u of liveSegs) {
      if (u.voice) continue;                       // already labelled
      const mid = (u.abs + (u.end || u.abs)) / 2;
      if (mid > upto + 0.5) continue;              // not yet inside a diarized window
      let pick = null, bg = 1e9;
      for (const tn of newTurns) {
        const g = mid < tn.start ? tn.start - mid : (mid > tn.end ? mid - tn.end : 0);
        if (g < bg) { bg = g; pick = tn.voice; }
      }
      if (pick) u.voice = pick;
    }
    if (typeof r.cursor_sec === 'number') lastDiarEndSec = r.cursor_sec;
    for (const v of (r.voices || [])) if (v.character) voiceName[v.id] = v.character;
    renderEfVoicesPanel(r.voices || [], sessionId);
    rerender();
  }
  // On stop, leave no `## …`: give every still-unlabelled word a speaker — its nearest
  // diarized turn, then carry the adjacent speaker into any tail no window ever covered.
  function reconcileLabels() {
    for (const u of liveSegs) {
      if (u.voice || !turns.length) continue;
      const mid = (u.abs + (u.end || u.abs)) / 2;
      let pick = null, bg = 1e9;
      for (const tn of turns) { const g = mid < tn.start ? tn.start - mid : (mid > tn.end ? mid - tn.end : 0); if (g < bg) { bg = g; pick = tn.voice; } }
      if (pick) u.voice = pick;
    }
    let prev = null;
    for (const u of liveSegs) { if (u.voice) prev = u.voice; else if (prev) u.voice = prev; }          // carry forward
    let next = null;
    for (let i = liveSegs.length - 1; i >= 0; i--) { if (liveSegs[i].voice) next = liveSegs[i].voice; else if (next) liveSegs[i].voice = next; }  // and backward
    rerender();
  }
  // Diarize ONE bounded window, ending at `untilSec` (a real pause) if given.
  // Returns whether the server still has a backlog.
  async function runDiar(final, untilSec) {
    if (diarBusy) return false;
    diarBusy = true; status();
    let more = false;
    try { const r = await api.diarizeWindow(sessionId, final, untilSec); if (r && !r.pending) { mergeResult(r); more = !!r.more; } }
    catch (e) {
      // Diarization only LABELS the kept transcript, so a failure never loses
      // words. On the final flush (stop) the session is already captured, so a
      // busy/flaky speech box must not throw an alarming error at the user —
      // note it quietly; reconcileLabels still assigns speakers from prior turns.
      if (final) console.warn('Final diarization window failed; some speaker labels may be missing:', (e && e.message) || e);
      else noteError('Diarization failed — is the speech service up? ' + (e && e.message || e));
    }
    finally { diarBusy = false; status(); }
    return more;
  }
  // Preferred window end: the LATEST real pause within the hard cap, so no speaker
  // straddles the cut (a mid-turn cut is what fragments one voice into many). 0 = let
  // the server fall back to total/cap (only if there's no pause at all in range).
  function diarCutSec() {
    const from = lastDiarEndSec, cap = from + DIAR_WINDOW_MAX_SEC;
    let best = 0;
    for (const u of liveSegs) { const e = u.end || u.abs; if (u.gap && e > from + 1 && e <= cap) best = e; }
    return best;
  }
  // Ship pending audio, then drain the diarization backlog in bounded windows (one
  // session may be hours long — never a single block), each cut on a pause. Mid-session
  // we stop once the un-diarized tail drops below the minimum, so a few seconds aren't
  // diarized as their own fragment; `final` (stop) flushes the tail so nothing is lost.
  async function runDiarFlush(final) {
    if (diarFlushing) return;
    diarFlushing = true;
    try {
      await flushSlice();
      for (let i = 0; i < 1000; i++) {
        if (!(await runDiar(true, diarCutSec()))) break;             // caught up
        if (!final && (total / rate - lastDiarEndSec) < DIAR_MIN_SEC) break;  // leave a sub-minimum tail
      }
    } finally { diarFlushing = false; }
  }

  async function liveTranscribe(f32, absStart, absEnd, gap) {
    if (f32.length < rate * 0.3) return;            // <0.3s, skip
    // Encode once; the audio is already in hand, so a transient failure should be
    // RETRIED rather than silently dropping this utterance's words. Only after a
    // few attempts do we surface an error (the box is genuinely down).
    const payload = { audio_base64: await blobToBase64(encodeWav(f32, rate)), mime: 'audio/wav' };
    let r = null, lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { r = await api.transcribeAudio(sessionId, payload); lastErr = null; break; }
      catch (e) { lastErr = e; if (attempt < 2) await new Promise((res) => setTimeout(res, 400 * (attempt + 1))); }
    }
    if (lastErr) { noteError('Live transcription failed after retries — is the speech service up? ' + (lastErr && lastErr.message || lastErr)); return; }
    const t = (r && r.text || '').trim();
    if (t) { liveSegs.push({ abs: absStart, end: absEnd, text: t, gap: !!gap }); rerender(); maybeDiarize(t, gap); }
  }
  // Kick off the diarization drain once enough speech has built up — preferring a
  // real pause that ends a sentence; or unconditionally once we hit the soft max.
  function maybeDiarize(lastText, gap) {
    if (diarFlushing || diarBusy) return;
    const undiarized = total / rate - lastDiarEndSec;
    const cleanEnd = gap && /[.!?]["'”’)\]]?\s*$/.test(lastText);
    if ((undiarized >= DIAR_MIN_SEC && cleanEnd) || undiarized >= DIAR_MAX_SEC) runDiarFlush(false);
  }

  function onaudio(e) {
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    const startAbs = total; total += d.length;
    // stream tier: accumulate a slice and ship it as soon as it fills (for diarization)
    slice.push(d); sliceLen += d.length;
    if (sliceLen >= SLICE_SEC * rate) flushSlice();
    // live tier: VAD-segment each utterance and transcribe it the instant it ends —
    // those words are the transcript and are kept; diarization later only labels them.
    let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / d.length);
    if (rms > 0.02) {
      if (!liveSpk) { liveSpk = true; liveStartAbs = startAbs; liveBuf = []; liveLen = 0; }
      liveSil = 0; liveBuf.push(d); liveLen += d.length;
      if (liveLen >= LIVE_MAX_SEC * rate) {       // unbroken speech too long — emit so subtitles keep up
        const u = concatF32(liveBuf, liveLen); const a0 = liveStartAbs;
        liveBuf = []; liveLen = 0; liveStartAbs = total;   // continue a fresh run from here
        liveTranscribe(u, a0 / rate, total / rate, false);  // forced cut, NOT a real pause
      }
    } else if (liveSpk) {
      liveBuf.push(d); liveLen += d.length; liveSil += d.length / rate;
      if (liveSil > 0.4) {                          // shorter pause → words appear sooner
        liveSpk = false; liveSil = 0;
        const u = concatF32(liveBuf, liveLen); const a0 = liveStartAbs, a1 = liveStartAbs + liveLen;
        liveBuf = []; liveLen = 0;
        liveTranscribe(u, a0 / rate, a1 / rate, true);      // ended on a real pause
      }
    }
  }
  async function start() {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { showAlert('Mic blocked: ' + e.message, 'danger', 'scenario-alert'); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    try { await ctx.resume(); } catch (e) { /* may already be running */ }
    rate = ctx.sampleRate; recStartMs = Date.now();
    basePrefix = ((el('scenario-source-editor') || {}).value) || '';  // preserve existing content; append below it
    total = 0; lastDiarEndSec = 0; liveSegs.length = 0; turns.length = 0;
    slice = []; sliceLen = 0; ingestChain = Promise.resolve();
    liveSpk = false; liveSil = 0; liveBuf = []; liveLen = 0; diarFlushing = false;
    try { await api.liveStart(sessionId, rate); }
    catch (e) {
      showAlert('Capture start failed: ' + e.message, 'danger', 'scenario-alert');
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
      return;
    }
    srcNode = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = onaudio;
    sink = ctx.createGain(); sink.gain.value = 0;     // silent sink (no mic playback)
    srcNode.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
    active = true; finishing = false; bindBtn(btn); status();
    statusTimer = setInterval(status, 500);
    _sessionCapture = { sessionId, voiceName, rerender, stop, active: true, pendingRestore: false,
      attach: (b) => { bindBtn(b); rerender(); status(); },   // re-connect to a freshly-rendered editor/button
      relabelBase: (oldLabels, next) => { basePrefix = relabelHeadersStr(basePrefix, oldLabels, next); },
      remapVoice: (from, into) => { for (const u of liveSegs) if (u.voice === from) u.voice = into; rerender(); } };
  }
  async function stop() {
    active = false;
    if (_sessionCapture) _sessionCapture.active = false;
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (proc) proc.disconnect();
    if (srcNode) srcNode.disconnect();
    if (sink) sink.disconnect();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    bindBtn(btn);                                        // back to idle label
    finishing = true; status();                          // pill shows "finishing…"; button stays put
    // Bound every wait so a dead/restarting server can never wedge finishing/the tab.
    const cap = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
    try {
      await cap(flushSlice(), 8000);                     // ship the final slice (give up after 8s)
      for (let i = 0; i < 30 && (diarBusy || diarFlushing); i++) await new Promise((r) => setTimeout(r, 200));  // let an in-flight drain settle
      await cap(runDiarFlush(true), 120000);             // stop: drain everything, incl. a short tail
    } catch { /* never let cleanup hang the UI */ }
    reconcileLabels();                                   // resolve any leftover `## …` to a speaker
    finishing = false; status();                         // always hide the pill
    // If we stopped from the nav pill while the editor wasn't on screen, the transcript
    // hasn't been painted anywhere — flag it so re-opening Edit Files restores it once.
    if (_sessionCapture) _sessionCapture.pendingRestore = !el('scenario-source-editor');
  }
  // (Re)bind the capture button — the editor (and its button) is recreated on tab nav,
  // so a running capture points itself at whatever button is currently on screen.
  function bindBtn(b) {
    if (!b) return;
    btn = b;
    btn.classList.toggle('btn-danger', active);
    btn.textContent = active ? '⏹ Stop' : '🎙 Capture session';
    btn.onclick = () => active ? stop() : start();
  }
  bindBtn(initialBtn);
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

// Add an *existing* central-pool NPC to this case by unioning this case into
// the NPC's scope (preserving its other allocations). Mirrors "+ Assign player".
async function openAddNpcToCase(sessionId) {
  let all;
  try { all = await api.getNpcs(); } catch (e) { return showAlert(e.message, 'danger', 'cp-alert'); }
  const available = (all || []).filter((n) => !(n.session_ids || []).map(Number).includes(Number(sessionId)));
  if (!available.length) {
    alert('No other NPCs are available to add. Every existing NPC is already in this case — use "+ New NPC" to create one.');
    return;
  }
  State._addNpcList = available;
  modal(`
    <h3>Add an existing NPC to this case</h3>
    <div id="modal-alert"></div>
    <div class="form-group">
      <label>NPC</label>
      <select id="m-npc-sel">
        ${available.map((n) => `<option value="${n.id}">${esc(n.name || '(no name)')}</option>`).join('')}
      </select>
      <div class="card-sub" style="margin-top:0.35rem">Adds this case to the NPC's allocations; their other cases are unaffected.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="addNpcToCase(${sessionId},this)">Add to case</button>
    </div>`);
}
window.openAddNpcToCase = openAddNpcToCase;

async function addNpcToCase(sessionId, btn) {
  const id = Number(el('m-npc-sel').value);
  const npc = (State._addNpcList || []).find((n) => Number(n.id) === id);
  if (!npc) return;
  btn.disabled = true;
  try {
    const ids = Array.from(new Set([...(npc.session_ids || []).map(Number), Number(sessionId)]));
    await api.setNpcSessions(id, ids);
    btn.closest('.modal-backdrop').remove();
    State._addNpcList = null;
    if (window.CharacterPanel && CharacterPanel.refresh) await CharacterPanel.refresh();
    else await openSession(sessionId);
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.addNpcToCase = addNpcToCase;

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
          <button class="btn btn-sm" onclick="eitAiEdit('${fid}')" title="Edit this picture with an AI prompt (e.g. make it a nighttime scene) — saves a new copy">AI Edit</button>
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
          <button class="btn btn-sm" onclick="eitAiEdit('${oid}')" title="Edit this picture with an AI prompt (e.g. make it a nighttime scene) — saves a new copy">AI Edit</button>
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

// Poll a queued ComfyUI prompt to completion and return its first output image
// ref ({ filename, subfolder, type }). Shared by Generate/Regenerate and AI Edit.
async function comfyWaitForImage(promptId, timeoutMs = 10 * 60 * 1000, shouldCancel = null) {
  const started = Date.now();
  const cancelled = () => {
    if (shouldCancel && shouldCancel()) { const e = new Error('cancelled'); e.cancelled = true; throw e; }
  };
  while (Date.now() - started < timeoutMs) {
    cancelled();
    await new Promise((res) => setTimeout(res, 2000));
    cancelled();
    const h = await fetch(`/api/portrait/history/${encodeURIComponent(promptId)}`, { credentials: 'same-origin' });
    if (!h.ok) continue;
    const e = (await h.json())[promptId];
    if (e && e.status && e.status.status_str === 'error') throw new Error('ComfyUI reported an error.');
    if (e && e.status && e.status.completed) {
      const outputs = e.outputs || {};
      const node = outputs['10'] || Object.values(outputs).find((o) => o && o.images);
      const img = node && node.images && node.images[0];
      if (!img) throw new Error('ComfyUI finished but returned no image.');
      return img;
    }
  }
  throw new Error('Timed out waiting for ComfyUI.');
}

// AI Edit image (img2img): take ANY existing graphic as the basis and apply a
// free-text edit instruction (e.g. "make this a nighttime scene"). Opens an
// interactive modal — type the change, pick how closely to keep the original,
// Generate, then Retry until happy and only then Keep (saves a NEW copy so the
// original is always preserved; Cancel/Discard writes nothing). Works on
// title-matched index graphics, unmatched/orphan graphics, and the plain image
// list in Edit Files — anywhere a picture is shown.
//   slug      → filename stem for the new copy; '' derives it from the source
//               file (so an untitled image's edit lands beside it).
//   statusId  → an eit-status cell to write the final outcome into; '' falls
//               back to the page-level scenario-alert banner.
async function aiEditImage(sessionId, relPath, { slug = '', statusId = '' } = {}) {
  if (!relPath) return;
  // Default save name = the source file's stem minus any trailing -timestamp, so
  // repeated edits don't chain "-2026-..-2026-.." and the copy reads as a sibling.
  const base = String(relPath).split('/').pop().replace(/\.[^.]+$/, '').replace(/-\d{4}-\d{2}-\d{2}-\d{6}$/, '');
  const saveName = slug || base;
  const report = (msg, cls) => {
    if (statusId) { eitStatus(statusId, msg, cls); return; }
    if (!msg) return;
    showAlert(msg, cls === 'error' ? 'danger' : (cls === 'saved' ? 'success' : 'info'), 'scenario-alert');
  };
  const sourceUrl = scenarioAssetUrl(relPath); // the picture being edited (before)
  // Pre-fill the box with the source image's saved prompt (its .prompt.txt
  // sidecar), so the prompt that produced it is visible, editable and re-usable.
  const srcMeta = (scenarioGraphicFiles || []).find((g) => g.path === relPath);
  const sourcePrompt = (srcMeta && srcMeta.prompt) || '';

  let lastImg = null; // the most recent generation; only this is saved on Keep
  modal(`
    <h3 style="margin-top:0">AI Edit image</h3>
    <p style="margin:.25rem 0 .6rem;opacity:.75">Describe the change, Generate, and Retry until you like it. The original is never altered — Keep saves a new copy, Cancel writes nothing.</p>
    <div class="form-group" style="margin-bottom:.5rem">
      <textarea id="aiedit-prompt" rows="2" spellcheck="true" placeholder='e.g. "make this a nighttime scene", "add fog and rain"'>${esc(sourcePrompt)}</textarea>
    </div>
    <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.6rem;flex-wrap:wrap">
      <button class="btn btn-primary" id="aiedit-gen">Generate</button>
      <span id="aiedit-status" style="font-size:.85em;opacity:.8"></span>
    </div>
    <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-start">
      <figure style="flex:1 1 45%;min-width:150px;margin:0;text-align:center">
        <figcaption style="font-size:.72em;opacity:.7;margin-bottom:.25rem">Source</figcaption>
        <a href="${esc(sourceUrl)}" target="_blank" rel="noopener" title="Click to view full size"><img src="${esc(sourceUrl)}" alt="Source image" style="max-width:100%;max-height:45vh;border-radius:6px;cursor:zoom-in"></a>
      </figure>
      <figure style="flex:1 1 45%;min-width:150px;margin:0;text-align:center">
        <figcaption style="font-size:.72em;opacity:.7;margin-bottom:.25rem">Result</figcaption>
        <div id="aiedit-preview" style="min-height:120px;display:flex;align-items:center;justify-content:center;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.4rem">
          <span style="opacity:.6;font-size:.85em">Generate to preview</span>
        </div>
      </figure>
    </div>
    <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
      <button class="btn" id="aiedit-cancel">Cancel</button>
      <button class="btn btn-primary" id="aiedit-keep" disabled>Keep this copy</button>
    </div>`, (root) => {
    const promptEl = root.querySelector('#aiedit-prompt');
    const genBtn = root.querySelector('#aiedit-gen');
    const keepBtn = root.querySelector('#aiedit-keep');
    const cancelBtn = root.querySelector('#aiedit-cancel');
    const previewEl = root.querySelector('#aiedit-preview');
    const statusEl = root.querySelector('#aiedit-status');
    const setStatus = (m) => { if (statusEl) statusEl.textContent = m || ''; };

    let running = false;        // a generation is in flight
    let cancelled = false;      // the GM hit Stop
    let generatedOnce = false;
    let currentPromptId = '';   // ComfyUI prompt_id of the in-flight job, for interrupt
    // While running the Generate/Redo button becomes a red Stop, matching the
    // other AI start buttons — clicking it aborts the wait so the GM can bail.
    const setRunning = (on) => {
      running = on;
      genBtn.textContent = on ? 'Stop' : (generatedOnce ? 'Redo' : 'Generate');
      genBtn.classList.toggle('btn-danger', on);
      genBtn.classList.toggle('btn-primary', !on);
    };

    const generate = async () => {
      const instruction = (promptEl.value || '').trim();
      if (!instruction) { setStatus('Enter a description first.'); promptEl.focus(); return; }
      if (eitBusy) { setStatus('An AI task is already running.'); return; }
      eitBusy = true;
      cancelled = false;
      currentPromptId = '';
      setRunning(true);
      keepBtn.disabled = true;
      llmPendingBegin('AI edit image');
      setStatus('Editing… (can take ~1 min on first run)');
      try {
        const q = await api.editGraphic(sessionId, { path: relPath, prompt: instruction });
        if (cancelled) { const e = new Error('cancelled'); e.cancelled = true; throw e; }
        if (q && q.node_errors && Object.keys(q.node_errors).length) throw new Error('ComfyUI rejected the workflow.');
        const promptId = q && q.prompt_id;
        if (!promptId) throw new Error('ComfyUI returned no prompt_id.');
        currentPromptId = promptId;
        const img = await comfyWaitForImage(promptId, 10 * 60 * 1000, () => cancelled);
        lastImg = img;
        generatedOnce = true;
        const params = new URLSearchParams();
        params.set('filename', img.filename);
        if (img.subfolder) params.set('subfolder', img.subfolder);
        params.set('type', img.type || 'output');
        const previewUrl = `/api/portrait/view?${params.toString()}`;
        // Click the preview to open it full size in a new tab — the inline copy
        // is necessarily small, so this is how the GM judges the result.
        previewEl.innerHTML = `<a href="${esc(previewUrl)}" target="_blank" rel="noopener" title="Click to view full size"><img src="${esc(previewUrl)}" alt="AI edit result" style="max-width:100%;max-height:45vh;border-radius:6px;cursor:zoom-in"></a>`;
        keepBtn.disabled = false;
        setStatus('Click a picture to view full size. Keep it, or tweak and Redo.');
      } catch (e) {
        // On cancel the Stop handler owns the status message (it reports whether
        // ComfyUI actually confirmed the interrupt), so don't overwrite it here.
        if (!(e && e.cancelled)) setStatus(e.message || 'AI edit failed');
      } finally {
        eitBusy = false;
        setRunning(false);
        llmPendingEnd();
      }
    };

    genBtn.addEventListener('click', async () => {
      if (!running) { generate(); return; }
      // Stop: abort the client wait AND really interrupt the GPU job. Report
      // honestly if ComfyUI doesn't confirm — don't imply it stopped if it may not have.
      cancelled = true;
      setStatus('Stopping…');
      try {
        const r = await api.interruptComfy({ promptId: currentPromptId });
        setStatus(r && r.ok ? 'Stopped.' : 'Stopped waiting — but ComfyUI didn’t confirm the interrupt; the job may still finish.');
      } catch (_) {
        setStatus('Stopped waiting — but couldn’t reach ComfyUI to stop the job.');
      }
    });
    cancelBtn.addEventListener('click', () => { root.remove(); report('Discarded — nothing was saved.'); });
    keepBtn.addEventListener('click', async () => {
      if (!lastImg) return;
      keepBtn.disabled = true; genBtn.disabled = true;
      setStatus('Saving…');
      try {
        await api.saveHandout(sessionId, {
          filename: lastImg.filename, subfolder: lastImg.subfolder || '', type: lastImg.type || 'output',
          prompt: (promptEl.value || '').trim(), name: saveName
        });
        root.remove();
        report('AI-edited copy saved (GM-only).', 'saved');
        await reloadCurrentSessionPanel();
      } catch (e) {
        setStatus(e.message || 'Save failed');
        keepBtn.disabled = false; genBtn.disabled = false;
      }
    });
    promptEl.focus();
  });
}
window.aiEditImage = aiEditImage;

// Registry-backed wrapper for the Index image manager rows (title-matched and
// orphan alike). Orphans carry no slug, so the copy keeps the source file stem.
function eitAiEdit(id) {
  const r = eitRegistry[id];
  if (!r || !r.path) { eitStatus(id, 'Generate or attach an image first.', 'error'); return; }
  aiEditImage(r.sessionId, r.path, { slug: r.slug || '', statusId: id });
}
window.eitAiEdit = eitAiEdit;

// ── Diagram editor (vendored Excalidraw) ─────────────────────────────────────
// The 8.7MB editor bundle is loaded lazily on first use (not on every page) and
// talks to us only through window.ROLExcalidraw.open(); see
// scripts/excalidraw/entry.jsx. The asset path must be set before host.js runs.
let _excalidrawLoad = null;
function ensureExcalidraw() {
  if (window.ROLExcalidraw) return Promise.resolve(window.ROLExcalidraw);
  if (_excalidrawLoad) return _excalidrawLoad;
  _excalidrawLoad = (async () => {
    window.EXCALIDRAW_ASSET_PATH = '/vendor/excalidraw/';
    if (!document.querySelector('link[data-excalidraw]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/vendor/excalidraw/host.css';
      link.setAttribute('data-excalidraw', '');
      document.head.appendChild(link);
    }
    await import('/vendor/excalidraw/host.js');
    if (!window.ROLExcalidraw) throw new Error('Diagram editor failed to load.');
    return window.ROLExcalidraw;
  })();
  _excalidrawLoad = _excalidrawLoad.catch((e) => { _excalidrawLoad = null; throw e; });
  return _excalidrawLoad;
}

// Open the diagram editor. With relPath, reopens an existing editor-made diagram
// (loads its scene) and overwrites it on save; without, creates a new GM-only
// diagram in the case gallery. The saved PNG slots into the graphics manager.
async function openDiagramEditor(sessionId, { relPath = '', title = 'Diagram', scene = null, name = 'diagram', definition = null } = {}) {
  let editor;
  try {
    editor = await ensureExcalidraw();
  } catch (e) {
    alert(e.message || 'Could not load the diagram editor.');
    return;
  }
  // Precedence: an explicit pre-built scene (the letter composer) wins; else
  // reopen an existing diagram by path; else a blank canvas.
  if (!scene && relPath) {
    try { scene = await api.getDiagramScene(sessionId, relPath); }
    catch { scene = null; } // missing/older diagram → start from a blank canvas
  }
  editor.open({
    title,
    scene,
    onSave: async ({ sceneJson, blob }) => {
      const png = await blobToDataUrl(blob);
      await api.saveDiagram(sessionId, {
        png,
        scene: sceneJson,
        name: relPath ? '' : name,
        replace_path: relPath || undefined,
        // For letters, persist the compose-form definition (JSON) in the prompt
        // sidecar so the letter can be reopened in the composer pre-filled.
        prompt: definition ? JSON.stringify(definition) : undefined
      });
      await reloadCurrentSessionPanel();
    }
  });
}
window.openDiagramEditor = openDiagramEditor;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the exported image.'));
    r.readAsDataURL(blob);
  });
}

// ── Letter composer ──────────────────────────────────────────────────────────
// A letter is just an Excalidraw scene: the composer collects header (company
// logo + address), body (typed or AI-drafted) and tail (sign-off + signature),
// assembles a scene, and opens it in the editor where the GM finishes/exports.
// Companies and signatories come from the global, reusable letterhead library.

async function imageUrlToDataUrl(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load image (HTTP ${res.status}).`);
  return blobToDataUrl(await res.blob());
}

function loadImageSize(dataUrl) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 });
    im.onerror = () => resolve({ w: 0, h: 0 });
    im.src = dataUrl;
  });
}

// Knock the white field out of an ink image (a Qwen signature is black ink on
// pure white) so the magnolia paper shows through. Luminance ramps the alpha:
// near-white → transparent, ink → opaque, with a soft edge so strokes feather
// onto the paper instead of leaving a hard halo. Returns the original on any
// failure (e.g. a tainted canvas). Same-origin data URLs are not tainted.
function makeWhiteTransparent(dataUrl, { hi = 240, lo = 200 } = {}) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      if (!c.width || !c.height) { resolve(dataUrl); return; }
      const ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0);
      let img;
      try { img = ctx.getImageData(0, 0, c.width, c.height); }
      catch { resolve(dataUrl); return; }
      const px = img.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        let a;
        if (lum >= hi) a = 0;
        else if (lum <= lo) a = 255;
        else a = Math.round((255 * (hi - lum)) / (hi - lo));
        if (a < px[i + 3]) px[i + 3] = a; // never make a pixel more opaque
      }
      ctx.putImageData(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    im.onerror = () => resolve(dataUrl);
    im.src = dataUrl;
  });
}

// Greedy word-wrap to an approximate column count (the editor lets the GM
// reflow afterwards; this just avoids one runaway line).
function wrapTextLines(text, maxChars) {
  const out = [];
  for (const para of String(text || '').split(/\n/)) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line && (line.length + 1 + word.length) > maxChars) { out.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out;
}

let _exSeq = 0;
function exId(p) { return `rol-${p}-${Date.now().toString(36)}-${_exSeq++}`; }
function exBase(over) {
  return Object.assign({
    angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null,
    roundness: null, seed: Math.floor(Math.random() * 2 ** 31), version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31), isDeleted: false, boundElements: null,
    updated: Date.now(), link: null, locked: false
  }, over);
}
function exText(text, x, y, { fontSize = 16, width = null, align = 'left' } = {}) {
  const lineHeight = 1.25;
  const str = String(text);
  const rows = str.split('\n');
  const longest = rows.reduce((m, l) => Math.max(m, l.length), 0);
  const w = width || Math.max(40, Math.round(longest * fontSize * 0.55));
  const h = Math.round(rows.length * fontSize * lineHeight);
  return exBase({
    id: exId('t'), type: 'text', x, y, width: w, height: h, text: str, fontSize, fontFamily: 2,
    textAlign: align, verticalAlign: 'top', containerId: null, originalText: str, lineHeight,
    baseline: Math.round(fontSize * lineHeight)
  });
}
function exImageFile(files, dataUrl) {
  const fid = exId('f');
  files[fid] = { mimeType: 'image/png', id: fid, dataURL: dataUrl, created: Date.now(), lastRetrieved: Date.now() };
  return fid;
}
function exImage(fileId, x, y, w, h) {
  return exBase({ id: exId('i'), type: 'image', x, y, width: w, height: h, strokeColor: 'transparent', status: 'saved', fileId, scale: [1, 1] });
}
function exRect(x, y, w, h, over = {}) {
  return exBase(Object.assign({ id: exId('r'), type: 'rectangle', x, y, width: w, height: h, roundness: null }, over));
}

// Lay the letter parts onto an A4-ish portrait page (~794×1123 @96dpi). The
// result feeds Excalidraw initialData; the GM nudges anything before export.
async function buildLetterScene({ company, logoDataUrl, dateStr, recipient, body, signoff, signatureDataUrl, signatory }) {
  const L = 60, R = 734, CONTENT_W = R - L;
  const elements = [];
  const files = {};

  // Lay a warm magnolia "page" with a ruled border behind everything, so the
  // exported PNG reads as a real sheet of headed notepaper rather than a stark
  // white screen. These go first so they sit at the bottom of the z-order.
  const PAGE_W = 794, PAGE_H = 1123, PAPER = '#f6f1e3', FRAME = '#b8a888';
  elements.push(exRect(0, 0, PAGE_W, PAGE_H, { backgroundColor: PAPER, fillStyle: 'solid', strokeColor: 'transparent' }));
  elements.push(exRect(24, 24, PAGE_W - 48, PAGE_H - 48, { backgroundColor: 'transparent', strokeColor: FRAME, strokeWidth: 2 }));

  // Centred masthead: a large logo over the company name and address, closed by
  // a rule — proper letterhead stationery, rather than a small corner mark.
  const CX = PAGE_W / 2;
  let y = 52;

  if (logoDataUrl) {
    const fid = exImageFile(files, logoDataUrl);
    const sz = await loadImageSize(logoDataUrl);
    const ratio = sz.h ? Math.min(160 / sz.h, 380 / (sz.w || 1)) : 1;
    const w = Math.round((sz.w || 200) * ratio) || 200;
    const h = Math.round((sz.h || 160) * ratio) || 160;
    elements.push(exImage(fid, Math.round(CX - w / 2), y, w, h));
    y += h + 14;
  }
  if (company && company.name) {
    const t = exText(company.name, L, y, { fontSize: 24, width: CONTENT_W, align: 'center' });
    elements.push(t); y += t.height + 6;
  }
  if (company && company.address) {
    const t = exText(company.address, L, y, { fontSize: 14, width: CONTENT_W, align: 'center' });
    elements.push(t); y += t.height + 14;
  }
  // Thin rule under the masthead.
  elements.push(exRect(L, y, CONTENT_W, 2, { backgroundColor: FRAME, fillStyle: 'solid', strokeColor: 'transparent' }));
  y += 30;

  if (dateStr) { const t = exText(dateStr, L, y, { fontSize: 16 }); elements.push(t); y += t.height + 20; }
  if (recipient) { const t = exText(recipient, L, y, { fontSize: 16, width: CONTENT_W }); elements.push(t); y += t.height + 20; }
  if (body) {
    const t = exText(wrapTextLines(body, 78).join('\n'), L, y, { fontSize: 16, width: CONTENT_W });
    elements.push(t); y += t.height + 28;
  }
  if (signoff) { const t = exText(signoff, L, y, { fontSize: 16 }); elements.push(t); y += t.height + 12; }
  if (signatureDataUrl) {
    const fid = exImageFile(files, signatureDataUrl);
    const sz = await loadImageSize(signatureDataUrl);
    const ratio = sz.h ? Math.min(70 / sz.h, 280 / (sz.w || 1)) : 1;
    const w = Math.round((sz.w || 220) * ratio) || 220;
    const h = Math.round((sz.h || 70) * ratio) || 70;
    elements.push(exImage(fid, L, y, w, h)); y += h + 6;
  }
  const nameBlock = [signatory && signatory.name, signatory && signatory.title].filter(Boolean).join('\n');
  if (nameBlock) { elements.push(exText(nameBlock, L, y, { fontSize: 15, width: CONTENT_W })); }

  return { elements, files, appState: { viewBackgroundColor: '#f6f1e3' } };
}

// Generate-or-upload image control, reused for company logos and signatures.
// Returns { get() } yielding the chosen image as a PNG data URL (or '').
function letterImagePicker(host, { sessionId, size = 'square', label = 'image', placeholder = '', initialUrl = '' }) {
  let pending = '';
  host.innerHTML = `
    <div class="lh-preview" style="min-height:70px;display:flex;align-items:center;justify-content:center;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.3rem;font-size:.8em;opacity:.7">none yet</div>
    <textarea class="lh-prompt" rows="3" placeholder="${esc(placeholder)}" style="width:100%;margin-top:.4rem;resize:vertical"></textarea>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-top:.4rem">
      <button type="button" class="btn btn-sm lh-gen">Generate</button>
      <label class="btn btn-sm" style="margin:0;cursor:pointer">Upload<input type="file" accept="image/*" class="lh-up" hidden></label>
      <span class="lh-status" style="font-size:.78em;opacity:.8"></span>
    </div>`;
  const preview = host.querySelector('.lh-preview');
  const promptEl = host.querySelector('.lh-prompt');
  const genBtn = host.querySelector('.lh-gen');
  const upEl = host.querySelector('.lh-up');
  const statusEl = host.querySelector('.lh-status');
  const setPreview = (url) => { preview.innerHTML = url ? `<img src="${url}" style="max-height:70px;max-width:100%">` : 'none yet'; };
  // Editing an existing record: show its current image. `pending` stays '' so
  // get() returns '' ("keep what's stored") unless the GM generates/uploads anew.
  if (initialUrl) { setPreview(initialUrl); statusEl.textContent = 'Current image — Generate or Upload to replace it.'; }

  upEl.addEventListener('change', async () => {
    const f = upEl.files && upEl.files[0];
    if (!f) return;
    pending = await blobToDataUrl(f);
    setPreview(pending);
    statusEl.textContent = 'Uploaded.';
  });
  genBtn.addEventListener('click', async () => {
    const prompt = (promptEl.value || '').trim();
    if (!prompt) { statusEl.textContent = 'Describe it first.'; return; }
    if (eitBusy) { statusEl.textContent = 'An AI task is already running.'; return; }
    eitBusy = true; genBtn.disabled = true; statusEl.textContent = 'Generating… (~1 min first run)';
    llmPendingBegin(`Letter ${label}`);
    try {
      const q = await api.generateHandout(sessionId, prompt, size);
      const pid = q && q.prompt_id;
      if (!pid) throw new Error('ComfyUI returned no prompt_id.');
      const img = await comfyWaitForImage(pid);
      const params = new URLSearchParams();
      params.set('filename', img.filename);
      if (img.subfolder) params.set('subfolder', img.subfolder);
      params.set('type', img.type || 'output');
      pending = await imageUrlToDataUrl(`/api/portrait/view?${params.toString()}`);
      setPreview(pending);
      statusEl.textContent = 'Generated — tweak the prompt and Generate again, or Upload your own.';
    } catch (e) {
      statusEl.textContent = e.message || 'Generation failed';
    } finally {
      eitBusy = false; genBtn.disabled = false; llmPendingEnd();
    }
  });
  return {
    get: () => pending,
    // Let callers seed the prompt box (e.g. an AI-suggested letterhead brief).
    setPrompt: (text) => { promptEl.value = String(text || ''); },
    getPrompt: () => (promptEl.value || '').trim()
  };
}

// `existing` (a company view) turns this into an edit dialog.
function newCompanyDialog(sessionId, onCreated, existing = null) {
  modal(`
    <h3 style="margin-top:0">${existing ? 'Edit company' : 'New company'}</h3>
    <div class="form-group"><label>AI suggest <span style="opacity:.6;font-weight:400">(optional)</span></label>
      <div style="display:flex;gap:.4rem;align-items:flex-start"><textarea id="lhc-hint" rows="2" placeholder="Steer it, e.g. &quot;the Folly&quot; or &quot;a shady antiques dealer&quot; — or leave blank" style="flex:1;resize:vertical"></textarea>
      <button class="btn btn-sm" id="lhc-ai">AI Generate</button></div>
      <div style="font-size:.78em;opacity:.7;margin-top:.2rem">Invents a plausible name, London address and a letterhead-style logo brief from this case's notes.</div></div>
    <div class="form-group"><label>Name</label><input id="lhc-name" type="text" placeholder="e.g. The Folly"></div>
    <div class="form-group"><label>Address</label><textarea id="lhc-addr" rows="3" placeholder="Postal address — one line per row"></textarea></div>
    <div class="form-group"><label>Logo</label><div id="lhc-logo"></div></div>
    <div class="save-status" id="lhc-status"></div>
    <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
      <button class="btn" id="lhc-cancel">Cancel</button>
      <button class="btn btn-primary" id="lhc-save">${existing ? 'Save changes' : 'Save company'}</button>
    </div>`, (root) => {
    root.querySelector('.modal').classList.add('modal-wide');
    const picker = letterImagePicker(root.querySelector('#lhc-logo'), {
      sessionId, size: 'square', label: 'logo',
      placeholder: 'e.g. "an engraved letterpress crest for a magical police unit, single ink on cream"',
      initialUrl: (existing && existing.has_logo) ? api.companyLogoUrl(existing.id) : ''
    });
    const status = root.querySelector('#lhc-status');
    if (existing) {
      root.querySelector('#lhc-name').value = existing.name || '';
      root.querySelector('#lhc-addr').value = existing.address || '';
      if (existing.ai_hint) root.querySelector('#lhc-hint').value = existing.ai_hint;
      if (existing.logo_prompt) picker.setPrompt(existing.logo_prompt);
    }
    root.querySelector('#lhc-ai').addEventListener('click', async () => {
      if (eitBusy) { status.textContent = 'An AI task is already running.'; return; }
      const btn = root.querySelector('#lhc-ai'); btn.disabled = true;
      status.textContent = 'Inventing a sender…';
      eitBusy = true; llmPendingBegin('Company details');
      try {
        const out = await api.draftCompany(sessionId, { hint: (root.querySelector('#lhc-hint').value || '').trim() });
        if (out.name) root.querySelector('#lhc-name').value = out.name;
        if (out.address) root.querySelector('#lhc-addr').value = out.address;
        if (out.logo_prompt) picker.setPrompt(out.logo_prompt);
        status.textContent = 'Suggested — edit anything, then Generate the logo and Save.';
      } catch (e) {
        status.textContent = e.message || 'Could not generate details';
      } finally {
        eitBusy = false; btn.disabled = false; llmPendingEnd();
      }
    });
    root.querySelector('#lhc-cancel').addEventListener('click', () => root.remove());
    root.querySelector('#lhc-save').addEventListener('click', async () => {
      const name = (root.querySelector('#lhc-name').value || '').trim();
      if (!name) { status.textContent = 'A name is required.'; return; }
      const btn = root.querySelector('#lhc-save'); btn.disabled = true; status.textContent = 'Saving…';
      try {
        const address = root.querySelector('#lhc-addr').value;
        // Keep the prompt boxes' content so the Edit dialog can repopulate them.
        const fields = {
          name, address,
          logo_prompt: picker.getPrompt(),
          ai_hint: (root.querySelector('#lhc-hint').value || '').trim()
        };
        const c = existing
          ? await api.updateCompany(existing.id, fields)
          : await api.createCompany(fields);
        const logo = picker.get();
        if (logo) await api.saveCompanyLogo(c.id, logo);
        root.remove();
        if (onCreated) onCreated(c.id);
      } catch (e) { status.textContent = e.message || 'Save failed'; btn.disabled = false; }
    });
  });
}

// `existing` (a signatory view) turns this into an edit dialog.
function newSignatoryDialog(sessionId, onCreated, existing = null) {
  modal(`
    <h3 style="margin-top:0">${existing ? 'Edit signatory' : 'New signatory'}</h3>
    <div class="form-group"><label>NPC voice <span style="opacity:.6;font-weight:400">(optional)</span></label>
      <select id="lhs-npc"><option value="">— not an NPC (neutral draft) —</option></select>
      <div style="font-size:.78em;opacity:.7;margin-top:.2rem">Back this signatory with an NPC so AI drafts are written in that character's voice — just like chatting with them in AI Support.</div></div>
    <div class="form-group"><label>Name</label><input id="lhs-name" type="text" placeholder="e.g. T. Nightingale"></div>
    <div class="form-group"><label>Title</label><input id="lhs-title" type="text" placeholder="e.g. Detective Chief Inspector"></div>
    <div class="form-group"><label>Sign-off</label><input id="lhs-signoff" type="text" placeholder="e.g. Yours sincerely,"></div>
    <div class="form-group"><label>Signature</label><div id="lhs-sig"></div></div>
    <div class="save-status" id="lhs-status"></div>
    <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
      <button class="btn" id="lhs-cancel">Cancel</button>
      <button class="btn btn-primary" id="lhs-save">${existing ? 'Save changes' : 'Save signatory'}</button>
    </div>`, (root) => {
    root.querySelector('.modal').classList.add('modal-wide');
    const picker = letterImagePicker(root.querySelector('#lhs-sig'), {
      sessionId, size: 'landscape', label: 'signature',
      placeholder: 'e.g. "a flowing handwritten ink signature, black ink on pure white"',
      initialUrl: (existing && existing.has_signature) ? api.signatureUrl(existing.id) : ''
    });
    const status = root.querySelector('#lhs-status');
    const npcSel = root.querySelector('#lhs-npc');
    const nameEl = root.querySelector('#lhs-name');
    if (existing) {
      nameEl.value = existing.name || '';
      root.querySelector('#lhs-title').value = existing.title || '';
      root.querySelector('#lhs-signoff').value = existing.signoff || '';
      if (existing.signature_prompt) picker.setPrompt(existing.signature_prompt);
    }
    // Populate the NPC list from the same source as AI Support; picking one
    // pre-fills the name so the signatory and the persona stay in step.
    api.getNpcPersonas(sessionId).then((r) => {
      for (const n of (r && r.npcs) || []) {
        const o = document.createElement('option');
        o.value = n.slug; o.textContent = n.name;
        npcSel.appendChild(o);
      }
      if (existing && existing.persona_slug) npcSel.value = existing.persona_slug;
    }).catch(() => { /* leave neutral-only */ });
    npcSel.addEventListener('change', () => {
      const opt = npcSel.options[npcSel.selectedIndex];
      if (npcSel.value && !nameEl.value.trim()) nameEl.value = opt.textContent;
    });
    root.querySelector('#lhs-cancel').addEventListener('click', () => root.remove());
    root.querySelector('#lhs-save').addEventListener('click', async () => {
      const name = (nameEl.value || '').trim();
      if (!name) { status.textContent = 'A name is required.'; return; }
      const btn = root.querySelector('#lhs-save'); btn.disabled = true; status.textContent = 'Saving…';
      try {
        const fields = {
          name, title: root.querySelector('#lhs-title').value, persona_slug: npcSel.value || '',
          signature_prompt: picker.getPrompt(), signoff: (root.querySelector('#lhs-signoff').value || '').trim()
        };
        const s = existing
          ? await api.updateSignatory(existing.id, fields)
          : await api.createSignatory(fields);
        const sig = picker.get();
        if (sig) await api.saveSignature(s.id, sig);
        root.remove();
        if (onCreated) onCreated(s.id);
      } catch (e) { status.textContent = e.message || 'Save failed'; btn.disabled = false; }
    });
  });
}

// `existing` (optional) reopens a saved letter pre-filled from its definition
// and overwrites that file on save, instead of creating a new one.
async function composeLetter(sessionId, existing = null) {
  const def = (existing && existing.definition) || null;
  let companies = [];
  let signatories = [];
  try {
    companies = (await api.listCompanies()).companies || [];
    signatories = (await api.listSignatories()).signatories || [];
  } catch (e) {
    showAlert(e.message || 'Could not load the letterhead library.', 'danger', 'scenario-alert');
    return;
  }
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const opt = (arr, ph) => ['<option value="">— ' + ph + ' —</option>']
    .concat(arr.map((o) => `<option value="${o.id}">${esc(o.name)}${o.title ? ' (' + esc(o.title) + ')' : ''}${o.persona_slug ? ' · NPC voice' : ''}</option>`)).join('');

  const root = modal(`
    <h3 style="margin-top:0">${def ? 'Edit letter' : 'Compose letter'}</h3>
    <p style="margin:.2rem 0 .8rem;opacity:.75">Builds the letter, then opens it in the editor to finish and export. Players see the exported picture — like a scanned page.</p>
    <div class="form-group"><label>From (company)</label>
      <div style="display:flex;gap:.4rem"><select id="lt-company" style="flex:1">${opt(companies, 'choose a company')}</select>
      <button class="btn btn-sm" id="lt-newco">New…</button>
      <button class="btn btn-sm" id="lt-editco" title="Edit the selected company">Edit…</button>
      <button class="btn btn-sm btn-danger" id="lt-delco" title="Delete the selected company from the library">Delete</button></div></div>
    <div style="display:flex;gap:.8rem">
      <div class="form-group" style="flex:1;margin-bottom:0"><label>To (recipient)</label><input id="lt-to" type="text" placeholder="e.g. Detective Constable Peter Grant"></div>
      <div class="form-group" style="flex:0 0 190px;margin-bottom:0"><label>Date</label><input id="lt-date" type="text" value="${esc(today)}"></div>
    </div>
    <div class="form-group"><label>Body</label>
      <div style="display:flex;gap:.4rem;margin-bottom:.35rem;align-items:flex-start"><textarea id="lt-brief" rows="2" placeholder="AI brief: what should the letter say?" style="flex:1;resize:vertical"></textarea><button class="btn btn-sm" id="lt-draft">Draft with AI</button></div>
      <textarea id="lt-body" rows="8" placeholder="Type the body, or draft it with AI above"></textarea></div>
    <div class="form-group"><label>Signed by <span style="opacity:.6;font-weight:400">(carries its own sign-off)</span></label>
      <div style="display:flex;gap:.4rem"><select id="lt-sig" style="flex:1">${opt(signatories, 'choose a signatory')}</select>
      <button class="btn btn-sm" id="lt-newsig">New…</button>
      <button class="btn btn-sm" id="lt-editsig" title="Edit the selected signatory">Edit…</button>
      <button class="btn btn-sm btn-danger" id="lt-delsig" title="Delete the selected signatory from the library">Delete</button></div></div>
    <div class="save-status" id="lt-status"></div>
    <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
      <button class="btn" id="lt-cancel">Cancel</button>
      <button class="btn btn-primary" id="lt-open">Open in editor</button>
    </div>`, (r) => {
    r.querySelector('.modal').classList.add('modal-wide');
    const status = r.querySelector('#lt-status');
    const coSel = r.querySelector('#lt-company');
    const sigSel = r.querySelector('#lt-sig');
    const refill = (sel, arr, ph, pick) => { sel.innerHTML = opt(arr, ph); if (pick) sel.value = String(pick); };

    // Reopening a saved letter: re-seed the form. A company/signatory that has
    // since been deleted from the library just stays unselected.
    if (def) {
      if (def.company_id) coSel.value = String(def.company_id);
      if (def.signatory_id) sigSel.value = String(def.signatory_id);
      r.querySelector('#lt-to').value = def.recipient || '';
      if (def.date) r.querySelector('#lt-date').value = def.date;
      r.querySelector('#lt-body').value = def.body || '';
      if (def.brief) r.querySelector('#lt-brief').value = def.brief;
    }

    r.querySelector('#lt-cancel').addEventListener('click', () => r.remove());
    const picked = (arr, sel) => arr.find((o) => o.id === Number(sel.value)) || null;
    const reloadCompanies = async (id) => { companies = (await api.listCompanies()).companies || []; refill(coSel, companies, 'choose a company', id); };
    const reloadSignatories = async (id) => { signatories = (await api.listSignatories()).signatories || []; refill(sigSel, signatories, 'choose a signatory', id); };

    r.querySelector('#lt-newco').addEventListener('click', () => newCompanyDialog(sessionId, reloadCompanies));
    r.querySelector('#lt-editco').addEventListener('click', () => {
      const c = picked(companies, coSel);
      if (!c) { status.textContent = 'Pick a company to edit first.'; return; }
      newCompanyDialog(sessionId, reloadCompanies, c);
    });
    r.querySelector('#lt-delco').addEventListener('click', async () => {
      const c = picked(companies, coSel);
      if (!c) { status.textContent = 'Pick a company to delete first.'; return; }
      if (!confirm(`Delete the company "${c.name}" from the letterhead library? Letters you've already saved keep their look.`)) return;
      try { await api.deleteCompany(c.id); await reloadCompanies(); status.textContent = 'Company deleted.'; }
      catch (e) { status.textContent = e.message || 'Delete failed'; }
    });

    r.querySelector('#lt-newsig').addEventListener('click', () => newSignatoryDialog(sessionId, reloadSignatories));
    r.querySelector('#lt-editsig').addEventListener('click', () => {
      const s = picked(signatories, sigSel);
      if (!s) { status.textContent = 'Pick a signatory to edit first.'; return; }
      newSignatoryDialog(sessionId, reloadSignatories, s);
    });
    r.querySelector('#lt-delsig').addEventListener('click', async () => {
      const s = picked(signatories, sigSel);
      if (!s) { status.textContent = 'Pick a signatory to delete first.'; return; }
      if (!confirm(`Delete the signatory "${s.name}" from the letterhead library? Letters you've already saved keep their look.`)) return;
      try { await api.deleteSignatory(s.id); await reloadSignatories(); status.textContent = 'Signatory deleted.'; }
      catch (e) { status.textContent = e.message || 'Delete failed'; }
    });

    r.querySelector('#lt-draft').addEventListener('click', async () => {
      const brief = (r.querySelector('#lt-brief').value || '').trim();
      if (!brief) { status.textContent = 'Enter a brief first.'; return; }
      if (eitBusy) { status.textContent = 'An AI task is already running.'; return; }
      const company = companies.find((c) => c.id === Number(coSel.value)) || null;
      const signatory = signatories.find((s) => s.id === Number(sigSel.value)) || null;
      const slug = (signatory && signatory.persona_slug) || '';
      const btn = r.querySelector('#lt-draft'); btn.disabled = true;
      status.textContent = slug ? `Drafting in ${signatory.name}'s voice…` : 'Drafting…';
      eitBusy = true; llmPendingBegin('Letter draft');
      try {
        const out = await api.draftLetter(sessionId, {
          intent: brief, sender: company && company.name, recipient: (r.querySelector('#lt-to').value || '').trim(), slug
        });
        r.querySelector('#lt-body').value = out.body || '';
        status.textContent = out.voice ? `Drafted in ${out.voice}'s voice — edit as needed.` : 'Drafted — edit as needed.';
      } catch (e) {
        status.textContent = e.message || 'Draft failed';
      } finally {
        eitBusy = false; btn.disabled = false; llmPendingEnd();
      }
    });

    r.querySelector('#lt-open').addEventListener('click', async () => {
      const company = companies.find((c) => c.id === Number(coSel.value)) || null;
      const signatory = signatories.find((s) => s.id === Number(sigSel.value)) || null;
      const btn = r.querySelector('#lt-open'); btn.disabled = true; status.textContent = 'Assembling…';
      try {
        const logoDataUrl = (company && company.has_logo) ? await imageUrlToDataUrl(api.companyLogoUrl(company.id)) : '';
        let signatureDataUrl = (signatory && signatory.has_signature) ? await imageUrlToDataUrl(api.signatureUrl(signatory.id)) : '';
        // Drop the signature's white field so the paper colour shows through.
        if (signatureDataUrl) signatureDataUrl = await makeWhiteTransparent(signatureDataUrl);
        const dateStr = (r.querySelector('#lt-date').value || '').trim();
        const recipient = (r.querySelector('#lt-to').value || '').trim();
        const body = r.querySelector('#lt-body').value;
        // Sign-off now lives on the signatory (default if they have none set).
        const signoff = signatory ? (signatory.signoff || 'Yours sincerely,') : '';
        const scene = await buildLetterScene({
          company, logoDataUrl, dateStr, recipient, body, signoff, signatureDataUrl, signatory
        });
        // The definition rides the prompt sidecar so the letter can be reopened
        // in this form; an edit overwrites the original file in place.
        const definition = {
          _letter: 1,
          company_id: company ? company.id : null,
          signatory_id: signatory ? signatory.id : null,
          recipient, date: dateStr, body,
          brief: (r.querySelector('#lt-brief').value || '').trim()
        };
        r.remove();
        await openDiagramEditor(sessionId, {
          scene, definition,
          relPath: existing ? existing.relPath : '',
          title: 'Letter',
          name: company ? `${company.name} letter` : 'letter'
        });
      } catch (e) {
        status.textContent = e.message || 'Could not assemble the letter';
        btn.disabled = false;
      }
    });
  });
  return root;
}
window.composeLetter = composeLetter;

// Saved-letter definitions, keyed by file path, stashed during file-row render
// so the row's "Edit letter" button can reopen the composer pre-filled.
const letterDefRegistry = {};
function editLetter(sessionId, relPath) {
  composeLetter(sessionId, { relPath, definition: letterDefRegistry[relPath] || {} });
}
window.editLetter = editLetter;

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
    const img = await comfyWaitForImage(promptId);
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
    // Player view: the same file list + single panel as the GM Edit Files tab,
    // but read-only. Shares selectScenarioSource, which renders into this
    // read-only body when there's no editor textarea. GM-only files are already
    // stripped server-side (routes.js scenario-sources).
    const sourceName = (source) => String(source.relative_path || source.path || 'Source');
    if (!markdownSources.length) {
      return `
        <div class="card scenario-source-editor">
          <div class="card-header"><div><div class="card-title">Handouts</div></div></div>
          <p class="card-sub">No player-visible handouts are available yet.</p>
        </div>
        ${assetFilesPanelHtml(sources, false)}`;
    }
    State.scenarioSelectedSourceIndex = 0;
    return `
      <div class="card scenario-source-editor">
        <div class="card-header">
          <div>
            <div class="card-title">Handouts</div>
            <div class="card-sub">Case files shared with the players — select one to read it.</div>
          </div>
        </div>
        <div class="scenario-file-editor">
          <div class="scenario-file-list" role="list">
            ${markdownSources.map((source, i) => `
              <button type="button" data-source-index="${i}" class="${i === 0 ? 'active' : ''}" onclick="selectScenarioSource(${i})">
                <span>${esc(sourceName(source))}</span>
              </button>
            `).join('')}
          </div>
          <div class="scenario-file-panel">
            <div id="player-handout-body" class="scenario-body" data-source-index="0">${renderScenarioText(markdownSources[0].content || '')}</div>
          </div>
        </div>
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
              <small>${source.visibility === 'gm' ? 'GM Only' : 'Player Handout'}${source.seeded && !source.seed_identical ? ' · <span class="seed-modified">✎ edited</span>' : ''}</small>
            </button>
          `).join('')}
        </div>
        <div class="scenario-file-panel">
          ${preferredIndex ? `
            <div class="scenario-file-meta">
              <span id="scenario-source-visibility">${preferredIndex.visibility === 'gm' ? 'GM Only' : 'Player Handout'}</span>
            </div>
            <textarea id="scenario-source-editor" data-source-index="${preferredIndex.index}" rows="18">${esc(preferredIndex.content || '')}</textarea>
            <div class="scenario-source-actions">
              <button class="btn" id="ef-mic"${(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? '' : ' disabled title="Microphone needs an HTTPS (secure) connection"'}>🎤 Dictate</button>
              <button class="btn" id="ef-capture"${(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? '' : ' disabled title="Microphone needs an HTTPS (secure) connection"'} title="Record a live session; speakers are identified and labelled">🎙 Capture session</button>
              <button class="btn btn-primary" id="ef-save" onclick="saveSessionScenarioSources(${State.currentSession}, this)">Save file</button>
              <button class="btn" onclick="revertScenarioSourceEditor()">Revert</button>
              <span id="ef-visibility-action"></span>
              <button class="btn" onclick="efDownloadSelected(${State.currentSession})">Download</button>
              <button class="btn" onclick="efReplaceSelected(${State.currentSession})" title="Overwrite this file with one you upload">Replace</button>
              <button class="btn" onclick="efRenameSelected(${State.currentSession})" title="Rename this file (extension kept)">Rename</button>
              <span id="ef-seed-action"></span>
              <span class="save-status" id="scenario-source-status"></span>
            </div>
            <div id="ef-voices"></div>
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
  // Player view hides entirely when empty; the GM view always renders so the
  // "New diagram" action is reachable even before any graphic exists.
  if (!files.length && !editable) return '';

  // Player (read-only) view: a simple preview grid, Download only.
  if (!editable) {
    return `
    <div class="card scenario-source-editor" style="margin-top:1rem">
      <div class="card-header"><div>
        <div class="card-title">Graphics &amp; PDFs</div>
        <div class="card-sub">Image and PDF handouts shared with you in this case.</div>
      </div></div>
      <div class="asset-grid">
        ${files.map((f) => {
          const url = scenarioAssetUrl(f.path);
          const label = String(f.path || '').split('/').slice(-1)[0];
          const media = f.kind === 'pdf' ? '<div class="asset-pdf">PDF</div>' : `<img src="${esc(url)}" alt="${esc(label)}" loading="lazy">`;
          return `<div class="asset-card">
            <a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(f.path)}">${media}</a>
            <span>${esc(label)}</span>
            <a class="btn btn-sm" href="${esc(url)}?download=1" download>Download</a>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // GM view: the same row layout and shared verbs as the Case Info image
  // manager. This is the raw list (no title matching), so it omits the index
  // column and adds the file-management verbs (Download/Replace/Return to
  // Default); the shared verbs (Save prompt, AI Edit, Make Player/GM, Rename,
  // Delete) match the manager's labels and order.
  const sid = State.currentSession;
  const rows = files.map((f, i) => {
    const id = `efa-${i}`;
    const url = scenarioAssetUrl(f.path);
    const label = String(f.path || '').split('/').slice(-1)[0];
    const player = f.visibility !== 'gm';
    const isGraphic = f.kind === 'graphic';
    // A letter carries its compose-form definition; stash it so "Edit letter"
    // can reopen the composer pre-filled.
    if (f.letter) letterDefRegistry[f.path] = f.letter;
    const media = isGraphic
      ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(label)}" loading="lazy" class="eit-thumb"></a>`
      : `<a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(f.path)}"><span class="asset-pdf">PDF</span></a>`;
    const visBadge = `<span class="vis-badge vis-${player ? 'player' : 'gm'}">${player ? 'Player' : 'GM'}</span>`;
    const visBtn = f.visibility_fixed
      ? `<button class="btn btn-sm" disabled title="This file's visibility is fixed">${player ? 'Player (fixed)' : 'GM (fixed)'}</button>`
      : `<button class="btn btn-sm" onclick="toggleAssetVisibility(${sid}, '${esc(f.path)}', '${player ? 'gm' : 'player'}')">${player ? 'Make GM' : 'Make Player'}</button>`;
    // Same seed-aware action as markdown: seeded+diverged → Revert,
    // seeded+pristine → nothing (it re-seeds), non-seeded → Delete.
    const seedAction = !f.seeded
      ? `<button class="btn btn-sm btn-danger" onclick="efDeleteFile(${sid}, '${esc(f.path)}')">Delete</button>`
      : (f.seed_identical
          ? `<button class="btn btn-sm" disabled title="Matches its seeded original — nothing to restore">Return to Default</button>`
          : `<span class="seed-modified" title="Edited from its seeded original — hand-crafted changes">✎ Modified</span><button class="btn btn-sm" onclick="efRevertFile(${sid}, '${esc(f.relative_path || '')}')" title="Discard your changes and restore the seeded original">Return to Default</button>`);
    return `<tr class="eit-file-row">
      <td class="eit-art">
        ${media}
        <div class="eit-file">${esc(label)} ${visBadge}</div>
      </td>
      <td>${isGraphic
        ? `<textarea id="${id}-prompt" class="eit-prompt" rows="2" placeholder="This image's prompt">${esc(f.prompt || '')}</textarea>`
        : '<span class="eit-none">—</span>'}</td>
      <td class="eit-actions">
        ${isGraphic ? `<button class="btn btn-sm" onclick="efSaveAssetPrompt(${sid}, '${esc(f.path)}', '${id}-prompt')">Save prompt</button>` : ''}
        ${isGraphic ? `<button class="btn btn-sm" onclick="aiEditImage(${sid}, '${esc(f.path)}', {})" title="Edit this picture with an AI prompt (e.g. make it a nighttime scene) — saves a new copy">AI Edit</button>` : ''}
        ${f.letter ? `<button class="btn btn-sm" onclick="editLetter(${sid}, '${esc(f.path)}')" title="Reopen the Compose letter form pre-filled — change the wording, company or signatory and re-save">Edit letter</button>` : ''}
        ${f.scene ? `<button class="btn btn-sm" onclick="openDiagramEditor(${sid}, { relPath: '${esc(f.path)}', title: '${esc(label)}' })" title="Reopen this diagram or letter in the raw editor to nudge the layout, fonts or images by hand">Edit in editor</button>` : ''}
        ${visBtn}
        <a class="btn btn-sm" href="${esc(url)}?download=1" download>Download</a>
        <button class="btn btn-sm" onclick="efReplaceFile(${sid}, '${esc(f.path)}')">Replace</button>
        <button class="btn btn-sm" onclick="efRenameFile(${sid}, '${esc(f.path)}')">Rename</button>
        ${seedAction}
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="card scenario-source-editor entity-img-table" style="margin-top:1rem">
      <div class="card-header">
        <div>
          <div class="card-title">Graphics &amp; PDFs</div>
          <div class="card-sub">Every image/PDF in this case — the raw list (no title matching). Shared controls match the Case Info image manager.</div>
        </div>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-sm" onclick="composeLetter(${sid})" title="Compose a letter handout — pick a company letterhead, write the body, add a signature">New letter</button>
          <button class="btn btn-sm" onclick="openDiagramEditor(${sid}, {})" title="Draw a new diagram or map in the editor — saved as a GM-only graphic you can share">New diagram</button>
        </div>
      </div>
      ${files.length ? `<div class="table-scroll">
        <table class="eit">
          <thead><tr><th>Graphic</th><th>Prompt</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<div class="empty scenario-empty"><p>No graphics or PDFs yet. Use <strong>New diagram</strong> to draw one.</p></div>'}
    </div>`;
}

// Grey out the Save button unless the open file has unsaved edits.
function updateEfSaveButton() {
  const b = el('ef-save');
  if (b) b.disabled = !scenarioSourceEditorDirty();
}
window.updateEfSaveButton = updateEfSaveButton;

function scenarioSourceEditorDirty() {
  const area = el('scenario-source-editor');
  if (!area) return false;
  const index = Number(area.dataset.sourceIndex);
  const source = scenarioArray(State.scenarioSources && State.scenarioSources.markdown_sources)[index];
  if (!source) return false;
  // A <textarea> always reports \n line endings, but file content read off disk
  // may be \r\n — normalise both so an untouched CRLF file isn't seen as edited.
  const norm = (s) => String(s || '').replace(/\r\n?/g, '\n');
  return norm(area.value) !== norm(source.content);
}

// Shared by the GM Edit Files tab and the player Handouts tab. The GM target is
// the editable textarea (#scenario-source-editor); the player target is the
// read-only viewer (#player-handout-body). Behaviour differs only where it must:
// GM gets the unsaved-edits / mid-capture guards and editor buttons.
function selectScenarioSource(sourceIndex) {
  const area = el('scenario-source-editor');     // GM editor textarea (absent for players)
  const body = el('player-handout-body');         // player read-only viewer (absent for GM)
  const target = area || body;
  if (!target) return;
  // Re-selecting the file already open is a no-op — never prompt to discard or
  // reload over the live transcript.
  if (Number(target.dataset.sourceIndex) === Number(sourceIndex)) return;
  if (area) {
    // A running capture writes into whichever file is open, so don't let the GM
    // switch files mid-capture and misdirect the transcript — stop first.
    if (_sessionCapture && _sessionCapture.active && String(_sessionCapture.sessionId) === String(State.currentSession)) {
      showAlert('Stop the session capture before switching files.', 'danger', 'scenario-alert');
      return;
    }
    if (scenarioSourceEditorDirty() && !confirm('Discard unsaved edits to the current file?')) return;
  }
  const sources = scenarioArray(State.scenarioSources && State.scenarioSources.markdown_sources);
  const source = sources[Number(sourceIndex)];
  if (!source) return;
  State.scenarioSelectedSourceIndex = Number(sourceIndex);
  target.dataset.sourceIndex = String(sourceIndex);
  if (area) area.value = source.content || '';
  else body.innerHTML = renderScenarioText(source.content || '');
  const title = el('scenario-source-title');
  if (title) title.textContent = source.relative_path || source.path || 'Source';
  const visibility = el('scenario-source-visibility');
  if (visibility) visibility.textContent = source.visibility === 'gm' ? 'GM Only' : 'Player Handout';
  document.querySelectorAll('.scenario-file-list button').forEach((button) => button.classList.remove('active'));
  const selectedButton = document.querySelector(`.scenario-file-list button[data-source-index="${Number(sourceIndex)}"]`);
  if (selectedButton) selectedButton.classList.add('active');
  if (area) {
    updateSeedActionButton();
    updateVisibilityToggleButton();
    updateEfSaveButton();
  }
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
    // Reuse the personality-editor dictation engine to capture a live session
    // (e.g. session-03.md) straight into the open source file at the cursor.
    const efMic = el('ef-mic'), efTa = el('scenario-source-editor');
    if (efMic && efTa && window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      wireDictation(efMic, efTa, sessionId, el('scenario-source-status'));
    }
    if (efTa) efTa.addEventListener('input', updateEfSaveButton);
    const efCap = el('ef-capture');
    const sc = _sessionCapture;
    if (efCap && sc && sc.sessionId === sessionId && sc.attach && (sc.active || sc.pendingRestore)) {
      // A capture for this session is still running (or just stopped while we were on
      // another tab) — reconnect it to this freshly-rendered button + editor.
      sc.pendingRestore = false;
      sc.attach(efCap);
    } else if (efCap && efTa && window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      wireSessionCapture(efCap, efTa, sessionId);
    }
    try { api.getVoices(sessionId).then((r) => { const vs = (r && r.voices) || []; renderEfVoicesPanel(vs, sessionId); applyVoiceNamesToEditor(vs); }).catch(() => {}); } catch {}
    updateSeedActionButton();
    updateVisibilityToggleButton();
    updateEfSaveButton();
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
        <div><h2>Character Stories</h2><p class="card-sub">Come up to speed: what you did, why, what's in flight, and what's planned${viewerNames.length ? ` — ${esc(viewerNames.join(', '))}` : ''}.</p></div>
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
  // NPCs allocated to this case get their own selectable strip — the same
  // treatment player characters get (consistent with the Characters tab).
  let npcs = [];
  try { const r = await api.getNpcs(sessionId); npcs = Array.isArray(r) ? r : []; } catch { npcs = []; }
  State.charStoriesNpcs = npcs;
  // Caches the GM scenario info (incl. gm_analysis.npc_knowledge) for selection.
  try { await loadScenarioInfo(sessionId); } catch { /* selection handles empties */ }

  // Page regenerate covers both player-character stories and NPC knowledge.
  const pageButton = scenarioPageActions('player.entities.characters,gm.npc_knowledge', 'Regenerate Page');

  tab.innerHTML = `
    <div class="page-header">
      <div><h2>Character Stories</h2><p class="card-sub">Select a character — player or NPC — to see their story. Player stories show what that player sees; NPC entries are their GM-only case knowledge (players reach it through in-character AI chat).</p></div>
      ${pageButton}
    </div>
    <div id="scenario-alert"></div>
    <div style="color:var(--text2);font-size:0.85rem;margin:0 0 0.35rem">Player characters</div>
    <div style="margin-bottom:1rem">
      ${players.length
        ? `<div class="sheet-tabs" id="scenario-player-tabs">${players.map((p) => `<div class="sheet-tab" id="sptab_${p.id}" onclick="scenarioSelectPlayer(${sessionId}, ${p.id}, '${esc(p.username)}')">${esc(p.username)}</div>`).join('')}</div>`
        : '<p class="card-sub" style="margin:0">No players assigned to this case.</p>'}
    </div>
    <div style="color:var(--text2);font-size:0.85rem;margin:0 0 0.35rem">NPCs</div>
    <div style="margin-bottom:1rem">
      ${npcs.length
        ? `<div class="sheet-tabs" id="scenario-npc-tabs">${npcs.map((n) => `<div class="sheet-tab" id="sntab_${n.id}" onclick="scenarioSelectNpcStory(${sessionId}, ${n.id})">${esc(n.name || '(no name)')}</div>`).join('')}</div>`
        : '<p class="card-sub" style="margin:0">No NPCs allocated to this case.</p>'}
    </div>
    <div id="scenario-char-area"><p style="color:var(--text2);padding:0.5rem">Select a character above.</p></div>`;

  if (players.length) {
    const preferred = players.find((p) => p.id === readStoredGmPlayerId(sessionId)) || players[0];
    await scenarioSelectPlayer(sessionId, preferred.id, preferred.username);
  } else if (npcs.length) {
    await scenarioSelectNpcStory(sessionId, npcs[0].id);
  }
}

function clearCharStoryTabs() {
  document.querySelectorAll('#scenario-player-tabs .sheet-tab, #scenario-npc-tabs .sheet-tab')
    .forEach((t) => t.classList.remove('active'));
}

async function scenarioSelectPlayer(sessionId, userId, username) {
  storeGmPlayerId(sessionId, userId);
  clearCharStoryTabs();
  const tabBtn = el(`sptab_${userId}`);
  if (tabBtn) tabBtn.classList.add('active');
  const area = el('scenario-char-area');
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
    ${renderScenarioSection('Player Story', mine, 'No story for this player has been generated yet.', 'player.entities.characters')}`;
}
window.scenarioSelectPlayer = scenarioSelectPlayer;

// NPCs are selected the same way as players: their tab fills the shared bottom
// area with that NPC's GM-only case knowledge (gm.npc_knowledge entry).
async function scenarioSelectNpcStory(sessionId, npcId) {
  clearCharStoryTabs();
  const tabBtn = el(`sntab_${npcId}`);
  if (tabBtn) tabBtn.classList.add('active');
  const area = el('scenario-char-area');
  if (!area) return;
  const npc = (State.charStoriesNpcs || []).find((n) => Number(n.id) === Number(npcId));
  const name = npc ? (npc.name || '(no name)') : '';
  const know = scenarioArray(State.scenarioInfo && State.scenarioInfo.gm_analysis && State.scenarioInfo.gm_analysis.npc_knowledge);
  const want = String(name).toLowerCase();
  const mine = know.filter((e) => String((e && e.name) || '').toLowerCase() === want);
  area.innerHTML = `
    <div class="scenario-viewer">${esc(name)} — GM-only case knowledge (players reach it through in-character AI chat)</div>
    ${renderScenarioSection('NPC Knowledge', mine, 'No case knowledge generated for this NPC yet — use Regenerate (or Regenerate Page).', 'gm.npc_knowledge')}`;
}
window.scenarioSelectNpcStory = scenarioSelectNpcStory;

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

// Save a graphic's prompt sidecar from the Edit Files row (mirrors the Case Info
// manager's "Save prompt"). Reads the row's textarea by id.
async function efSaveAssetPrompt(sessionId, assetPath, taId) {
  const ta = el(taId);
  try {
    await api.saveSessionFilePrompt(sessionId, assetPath, ta ? ta.value : '');
    showAlert('Prompt saved.', 'success', 'scenario-alert');
  } catch (e) {
    showAlert(e.message || 'Save failed', 'danger', 'scenario-alert');
  }
}
window.efSaveAssetPrompt = efSaveAssetPrompt;

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

// Seeded files (from globaldata or a case's canonical original) are undeletable
// — re-seeded when missing — so their per-file action is Revert (not Delete):
// hidden when the case copy still matches the seed, "Revert" once it has diverged.
// Non-seeded files keep Delete.
function updateSeedActionButton() {
  const host = el('ef-seed-action');
  if (!host) return;
  const src = efSelectedSource();
  const sid = State.currentSession;
  if (!src) { host.innerHTML = ''; return; }
  if (!src.seeded) {
    host.innerHTML = `<button class="btn btn-danger" onclick="efDeleteSelected(${sid})" title="Delete this file permanently">Delete</button>`;
  } else if (src.seed_identical) {
    // seeded and unchanged — the action exists but there's nothing to restore.
    host.innerHTML = `<button class="btn" disabled title="This file matches its seeded original — nothing to restore">Return to Default</button>`;
  } else {
    // seeded but edited — flag it as hand-crafted and offer to restore the seed.
    host.innerHTML = `<span class="seed-modified" title="Edited away from its seeded original — this file has hand-crafted changes">✎ Modified</span><button class="btn" onclick="efRevertSelected(${sid})" title="Discard your changes and restore the seeded original">Return to Default</button>`;
  }
}

// Markdown-editor visibility toggle — same colour/text as the asset-card button,
// reflecting the selected file and flipping it GM <-> player on click.
function updateVisibilityToggleButton() {
  const host = el('ef-visibility-action');
  if (!host) return;
  const src = efSelectedSource();
  if (!src) { host.innerHTML = ''; return; }
  const player = src.visibility !== 'gm';
  if (src.visibility_fixed) {
    host.innerHTML = `<button class="btn btn-sm vis-badge vis-${player ? 'player' : 'gm'}" disabled title="This file's visibility is fixed">${player ? 'Player Handout' : 'GM Only'}</button>`;
    return;
  }
  host.innerHTML = `<button class="btn btn-sm vis-badge vis-${player ? 'player' : 'gm'}" onclick="toggleSelectedSourceVisibility(${State.currentSession})" title="Click to change visibility">${player ? 'Player Handout → GM' : 'GM Only → Player'}</button>`;
}
window.updateVisibilityToggleButton = updateVisibilityToggleButton;
window.updateSeedActionButton = updateSeedActionButton;

async function efRevertSelected(sessionId) {
  const src = efSelectedSource();
  if (!src) { showAlert('Select a file first.', 'danger', 'scenario-alert'); return; }
  await efRevertFile(sessionId, src.relative_path);
}
window.efRevertSelected = efRevertSelected;

// Revert any seeded file (markdown, image, pdf, txt) to its originally seeded
// version, by relative path. Used by both the markdown editor and asset cards.
async function efRevertFile(sessionId, relativePath) {
  if (!relativePath) { showAlert('No file selected.', 'danger', 'scenario-alert'); return; }
  if (!confirm(`Revert ${relativePath} to its originally seeded version? Your changes to this file will be lost.`)) return;
  try {
    await api.revertSessionFile(sessionId, relativePath);
    await reloadCurrentSessionPanel();
  } catch (e) { showAlert(e.message, 'danger', 'scenario-alert'); }
}
window.efRevertFile = efRevertFile;

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
    updateEfSaveButton();
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

// ── Characters (GM) ──────────────────────────────────────────────────────────
function npcCaseSummary(entry) {
  const names = (entry.sessions || []).map((s) => s.name);
  if (!names.length) return 'Unallocated';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

// Admin → Characters reuses the shared CharacterPanel with no case filter.
// In this mode every player and NPC sheet is visible regardless of scope.
async function renderAdminCharacters() {
  const host = el('admin-content');
  if (!host) return;
  await CharacterPanel.render(host, { sessionId: null, sessionName: null, ruleset: 'rol', rulesTier: 'advanced' });
}
window.renderAdminCharacters = renderAdminCharacters;

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
    SheetForm.setRulesTier('advanced');
    SheetForm.setGmEditor(!!(State.user && State.user.role === 'gm'));
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
    await renderAdminCharacters();
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
    await renderAdminCharacters();
  } catch (e) {
    showAlert(e.message, 'danger', 'characters-alert');
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

// Any character (player or NPC) can be allocated to any case, including The
// Domestic, so use the dedicated allocatable-cases list rather than the
// visible Case Files list. Lookup goes via State.characters (Admin) and falls
// back to State.npcs (case view's NPC tab).
async function openCharacterCases(charId) {
  const char = ((State.characters || []).find((entry) => entry.id === charId))
    || ((State.npcs || []).find((entry) => entry.id === charId));
  if (!char) return;
  let cases;
  try {
    cases = await api.getAllocatableCases();
    State.allocatableCases = cases;
  } catch (e) {
    return showAlert(e.message, 'danger', 'characters-alert');
  }
  const ownerLabel = char.owner === 'NPC' ? 'NPC' : 'player character';
  modal(`
    <h3>${esc(char.name || '(no name)')} — Cases</h3>
    <div id="modal-alert"></div>
    <p class="card-sub" style="margin-bottom:0.5rem">Allocate this ${ownerLabel} to any cases (or none).</p>
    ${caseCheckboxes(char.session_ids, cases)}
    <div class="modal-actions">
      <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCharacterCases(${char.id}, this)">Save</button>
    </div>`);
}
window.openCharacterCases = openCharacterCases;
// Back-compat alias — still referenced by the GM case view NPC tab.
window.openNpcCases = openCharacterCases;

async function saveCharacterCases(charId, btn) {
  const root = btn.closest('.modal-backdrop');
  btn.disabled = true;
  try {
    await api.setNpcSessions(charId, selectedCaseIds(root));
    root.remove();
    if (typeof renderAdminCharacters === 'function' && el('admin-content')) {
      await renderAdminCharacters();
    }
  } catch (e) {
    showAlert(e.message, 'danger', 'modal-alert');
    btn.disabled = false;
  }
}
window.saveCharacterCases = saveCharacterCases;
window.saveNpcCases = saveCharacterCases;

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
      <div class="sheet-tab" data-admin="characters" onclick="adminShow('characters')">Characters</div>
      <div class="sheet-tab" data-admin="llm" onclick="adminShow('llm')">LLM</div>
    </div>
    <div id="admin-content"><p style="color:var(--text2);padding:1rem">Loading…</p></div>`;
  await adminShow('accounts');
}
window.loadAdminTab = loadAdminTab;

async function adminShow(section) {
  document.querySelectorAll('[data-admin]').forEach((t) => t.classList.toggle('active', t.dataset.admin === section));
  if (section === 'characters') await renderAdminCharacters();
  else if (section === 'llm') await renderAdminLlm();
  else await renderAdminAccounts();
}
window.adminShow = adminShow;

// Per-case Settings tab (GM only): rules behaviour + portrait style for THIS
// case. Lives with the case (under Edit Files) rather than a central admin list.
async function renderSessionSettings(sessionId) {
  const host = el('session-content');
  if (!host) return;
  host.innerHTML = '<p style="color:var(--text2);padding:1rem">Loading…</p>';
  let s;
  try {
    s = await api.getSessionSettings(sessionId);
  } catch (e) {
    host.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const adv = s.advantage_mode === 'simple' ? 'simple' : 'rol';
  const ruleset = s.ruleset === 'coc' ? 'coc' : 'rol';
  const tier = s.rules_tier === 'advanced' ? 'advanced' : 'basic';
  // portrait_style is always concrete now (the data layer fills the built-in
  // default into the DB), so the field just shows the stored value — no UI-side
  // default substitution. portrait_style_default is only the Reset-to target.
  const def = s.portrait_style_default || '';
  const styleVal = s.portrait_style || def;
  host.innerHTML = `
    <div class="page-header"><h2>Settings</h2></div>
    <div id="session-settings-alert"></div>
    <div class="card">
      <div class="card-header"><div>
        <div class="card-title">Rules</div>
        <div class="card-sub">These apply to this case only.</div>
      </div></div>
      <div class="form-group" style="max-width:720px">
        <label>Advantage / disadvantage handling</label>
        <select onchange="saveCaseAdvantage(${sessionId}, this.value, this)">
          <option value="rol"${adv !== 'simple' ? ' selected' : ''}>RoL bonus/penalty die (roll the tens die twice)</option>
          <option value="simple"${adv === 'simple' ? ' selected' : ''}>Simple (roll two d100s, take best/worst)</option>
        </select>
      </div>
      <div class="form-group" style="max-width:720px">
        <label>Ruleset</label>
        <select onchange="saveCaseRuleset(${sessionId}, this.value, this)">
          <option value="rol"${ruleset !== 'coc' ? ' selected' : ''}>Rivers of London (no SIZ; no HP/Build)</option>
          <option value="coc"${ruleset === 'coc' ? ' selected' : ''}>CoC-style (SIZ, plus SIZ-derived HP &amp; Build)</option>
        </select>
      </div>
      <div class="form-group" style="max-width:720px">
        <label>Rules set (Rules tab &amp; AI Support)</label>
        <select onchange="saveCaseRulesTier(${sessionId}, this.value, this)">
          <option value="basic"${tier !== 'advanced' ? ' selected' : ''}>Basic rules</option>
          <option value="advanced"${tier === 'advanced' ? ' selected' : ''}>Advanced rules (integrated)</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div>
        <div class="card-title">Portrait style</div>
        <div class="card-sub">The art-style half of the auto-generated portrait prompt. The field starts with the built-in default — edit it freely, e.g. <em>“photorealistic studio headshot, soft lighting”</em> or <em>“loose graphite pencil sketch on toned paper”</em>. Character framing (bust, headroom) and quality safeguards are kept automatically. <strong>Reset to default</strong> restores the default text.</div>
      </div></div>
      <div class="form-group" style="max-width:720px">
        <textarea id="case-style-${sessionId}" rows="3" spellcheck="false" data-default="${esc(def)}">${esc(styleVal)}</textarea>
        <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.4rem">
          <button class="btn btn-sm btn-primary" onclick="saveCasePortraitStyle(${sessionId}, this)">Save</button>
          <button class="btn btn-sm" onclick="saveCasePortraitStyle(${sessionId}, this, true)">Reset to default</button>
        </div>
      </div>
    </div>`;
}
window.renderSessionSettings = renderSessionSettings;

async function saveCasePortraitStyle(sessionId, btn, reset) {
  const ta = el(`case-style-${sessionId}`);
  // Reset puts the actual default text back in the field; Save stores the
  // literal field content (no empty→default coercion behind the scenes).
  if (reset && ta) ta.value = ta.dataset.default || '';
  const style = (ta && ta.value) || '';
  btn.disabled = true;
  try {
    const r = await api.setSessionSettings(sessionId, { portrait_style: style });
    const def = (ta && ta.dataset.default) || '';
    if (ta) ta.value = (r.portrait_style && r.portrait_style.trim()) ? r.portrait_style : def;
    showAlert(reset ? 'Reset to the default portrait style.' : 'Portrait style saved.', 'success', 'session-settings-alert');
  } catch (e) {
    showAlert(e.message, 'danger', 'session-settings-alert');
  } finally {
    btn.disabled = false;
  }
}
window.saveCasePortraitStyle = saveCasePortraitStyle;

async function saveCaseAdvantage(sessionId, mode, sel) {
  sel.disabled = true;
  try {
    await api.setSessionSettings(sessionId, { advantage_mode: mode });
    showAlert('Saved.', 'success', 'session-settings-alert');
  } catch (e) {
    showAlert(e.message, 'danger', 'session-settings-alert');
  } finally {
    sel.disabled = false;
  }
}
window.saveCaseAdvantage = saveCaseAdvantage;

async function saveCaseRuleset(sessionId, ruleset, sel) {
  sel.disabled = true;
  try {
    await api.setSessionSettings(sessionId, { ruleset });
    showAlert('Saved. Re-open a character sheet for this case to see the change.', 'success', 'session-settings-alert');
  } catch (e) {
    showAlert(e.message, 'danger', 'session-settings-alert');
  } finally {
    sel.disabled = false;
  }
}
window.saveCaseRuleset = saveCaseRuleset;

async function saveCaseRulesTier(sessionId, tier, sel) {
  sel.disabled = true;
  try {
    await api.setSessionSettings(sessionId, { rules_tier: tier });
    showAlert(tier === 'advanced'
      ? 'Saved. Rules-grounded AI Support for this case now uses the advanced (integrated) rules.'
      : 'Saved. Rules-grounded AI Support for this case now uses the basic rules.', 'success', 'session-settings-alert');
  } catch (e) {
    showAlert(e.message, 'danger', 'session-settings-alert');
  } finally {
    sel.disabled = false;
  }
}
window.saveCaseRulesTier = saveCaseRulesTier;

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
    svc = { ollama: { url: '', default: '' }, comfyui: { url: '', default: '' }, whisperx: { url: '', default: '', boost_alpha: '', boost_default: 0.5 } };
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
        <div class="card-sub">Base URLs for the Ollama (language), ComfyUI (image) and speech hosts. Persists in <code>data/app-config.json</code>; leave blank to use the deploy default. Changes take effect immediately — no redeploy.</div>
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
      <div class="form-group" style="max-width:560px">
        <label>Speech (Parakeet/WhisperX) URL</label>
        <input type="text" id="svc-whisperx" value="${esc((svc.whisperx && svc.whisperx.url) || '')}" placeholder="default: ${esc((svc.whisperx && svc.whisperx.default) || '')}" spellcheck="false" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group" style="max-width:560px">
        <label>Glossary boost strength</label>
        <input type="number" id="svc-boost" min="0" max="5" step="0.1" value="${esc(String((svc.whisperx && svc.whisperx.boost_alpha != null && svc.whisperx.boost_alpha !== '') ? svc.whisperx.boost_alpha : ''))}" placeholder="default: ${esc(String((svc.whisperx && svc.whisperx.boost_default != null) ? svc.whisperx.boost_default : '0.5'))}">
        <div class="card-sub">How hard speech recognition is biased toward the case glossary. Higher recovers rare names but can force a glossary name onto a similar ordinary word; lower is safer. <strong>0</strong> disables it.</div>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-primary" onclick="saveAdminLlmServices(this)">Save</button>
        <button class="btn" onclick="saveAdminLlmServices(this, true)">Reset to defaults</button>
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
  const whisperx = reset ? '' : ((el('svc-whisperx') && el('svc-whisperx').value) || '').trim();
  const boost = reset ? '' : ((el('svc-boost') && el('svc-boost').value) || '').trim();
  btn.disabled = true;
  try {
    await api.setLlmServices({ ollama_url: ollama, comfyui_url: comfyui, whisperx_url: whisperx, boost_alpha: boost });
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
  if (!State.rulesView) State.rulesView = 'core';
  State.rulesCache = State.rulesCache || {};
  await renderRulesTab();
}

// Lazy-load and cache each Rules view: 'core'/'advanced' return a rendered
// rules index; 'changes' returns the advanced changelog.
// The Rules tab is global: a game dropdown picks the system, and that system's
// rule sets (+ RoL's derived What's New / Setting & Reference) follow on the same
// line. The tree + availability flags come from GET /rules; each rule set's
// content is fetched on demand by its "<game>/<dir>" key. 'changes'/'reference'
// are the two RoL derived views.
async function ensureRulesTree() {
  State.rulesCache = State.rulesCache || {};
  if (!State.rulesCache.__tree) State.rulesCache.__tree = await api.getRules();
  return State.rulesCache.__tree;
}

async function ensureRulesData(view) {
  State.rulesCache = State.rulesCache || {};
  if (view === 'changes') {
    if (!State.rulesCache.changes) State.rulesCache.changes = await api.getRulesChanges();
    return State.rulesCache.changes;
  }
  if (view === 'reference') {
    if (!State.rulesCache.reference) State.rulesCache.reference = await api.getRulesReference();
    return State.rulesCache.reference;
  }
  if (!State.rulesCache[view]) State.rulesCache[view] = await api.getRulesSection(view);
  return State.rulesCache[view];
}

// Selectable views for a game: its rule sets, plus (for RoL) the derived views.
function gameViews(game, treeData) {
  const views = (game.ruleSets || []).map((s) => [s.key, s.label]);
  if (game.key === 'rivers-of-london') {
    if (treeData.advancedAvailable) views.push(['changes', "What's New"]);
    if (treeData.referenceAvailable) views.push(['reference', 'Setting & Reference']);
  }
  return views;
}

window.setRulesGame = async function setRulesGame(gameKey) {
  State.rulesGame = gameKey;
  State.rulesView = null; // fall to the game's first view
  await renderRulesTab();
};

window.setRulesView = async function setRulesView(view) {
  State.rulesView = view;
  await renderRulesTab();
};

// One horizontal line: the game dropdown, then the selected game's view buttons.
function rulesNavHtml(treeData, game, view) {
  const select = `<select class="rules-game-select" aria-label="Game system" onchange="setRulesGame(this.value)">${
    treeData.tree.map((g) => `<option value="${esc(g.key)}"${g.key === game.key ? ' selected' : ''}>${esc(g.label)}</option>`).join('')
  }</select>`;
  const btns = gameViews(game, treeData).map(([id, label]) =>
    `<button type="button" role="tab" aria-selected="${view === id}" class="rules-view-btn${view === id ? ' active' : ''}" onclick="setRulesView('${esc(id)}')">${esc(label)}</button>`
  ).join('');
  return `<div class="rules-views" role="tablist">${select}${btns}</div>`;
}

const RULES_CHANGE_BADGES = {
  add: { label: 'New', cls: 'rules-badge-add' },
  supersede: { label: 'Changed', cls: 'rules-badge-supersede' },
  supplement: { label: 'Extended', cls: 'rules-badge-supplement' }
};

function rulesChangesHtml(data) {
  if (!data || !data.groups || !data.groups.length) {
    return '<div class="empty" style="padding:1.5rem"><p>No advanced changes found.</p></div>';
  }
  const intro = `<p class="rules-changes-intro">How the Advanced rules differ from Core, chapter by chapter. <span class="rules-badge rules-badge-add">New</span> adds a topic, <span class="rules-badge rules-badge-supersede">Changed</span> replaces a base rule, and <span class="rules-badge rules-badge-supplement">Extended</span> adds an option to an existing rule.</p>`;
  const groups = data.groups.map((g) => {
    const entries = g.entries.map((e) => {
      const b = RULES_CHANGE_BADGES[e.class] || { label: e.class, cls: '' };
      return `<div class="rules-change-entry">
        <h4 class="rules-change-title"><span class="rules-badge ${b.cls}">${esc(b.label)}</span> ${esc(e.title)}</h4>
        <div class="rules-change-body">${e.html}</div>
      </div>`;
    }).join('');
    return `<section class="rules-change-group"><h3 class="rules-change-chapter">${esc(g.chapter)}</h3>${entries}</section>`;
  }).join('');
  return intro + groups;
}

async function renderRulesTab() {
  const tab = el('tab-rules');
  if (!tab) return;

  let treeData;
  try {
    treeData = await ensureRulesTree();
  } catch (e) {
    tab.innerHTML = `<div class="page-header"><h2>Rules Library</h2></div><div class="alert alert-danger">${esc(e.message)}</div>`;
    return;
  }
  const games = (treeData && treeData.tree) || [];
  if (!games.length) {
    tab.innerHTML = `<div class="page-header"><h2>Rules Library</h2></div><div class="empty" style="padding:1.5rem"><p>No rules are loaded on the server.</p></div>`;
    return;
  }

  // Selected game: default Rivers of London, else the first discovered game.
  const game = games.find((g) => g.key === State.rulesGame)
    || games.find((g) => g.key === 'rivers-of-london') || games[0];
  State.rulesGame = game.key;

  // Selected view within the game; fall back to its first rule set.
  const viewIds = gameViews(game, treeData).map(([id]) => id);
  const view = viewIds.includes(State.rulesView) ? State.rulesView : viewIds[0];
  State.rulesView = view;

  let title = 'Rules';
  let showPrint = true;
  let bodyHtml = '';
  try {
    if (view === 'changes') {
      const data = await ensureRulesData('changes');
      title = data.title || "What's New in Advanced";
      showPrint = false;
      bodyHtml = `<article class="rules-document"><div class="print-cover"><h1>${esc(title)}</h1></div><div class="print-section">${rulesChangesHtml(data)}</div></article>`;
    } else if (view === 'reference') {
      const data = await ensureRulesData('reference');
      title = data.title || 'Setting & GM Reference';
      bodyHtml = `<article class="rules-document"><div class="print-cover"><h1>${esc(title)}</h1></div><div class="print-section">${data.html || '<p>(no setting reference found)</p>'}</div></article>`;
    } else {
      const idx = await ensureRulesData(view);
      title = idx.title || title;
      bodyHtml = `<article class="rules-document"><div class="print-cover"><h1>${esc(idx.title || title)}</h1></div><div class="print-section">${idx.html || '<p>(no rule files found)</p>'}</div></article>`;
    }
  } catch (e) {
    bodyHtml = `<div class="alert alert-danger">${esc(e.message)}</div>`;
  }

  // Title shows once, at the top of the content; the header carries only the action.
  tab.innerHTML = `
    ${showPrint ? `<div class="page-header rules-print-actions"><button class="btn btn-primary" type="button" onclick="printRulesTab()">Print rules</button></div>` : ''}
    ${rulesNavHtml(treeData, game, view)}
    <div id="rules-view-body">${bodyHtml}</div>`;
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

// ── NPC persona chat ────────────────────────────────────────────────────────
async function renderSessionNpcChat(sessionId) {
  const tab = el('session-content');
  if (!tab) return;
  let personas = State.npcPersonasCache[sessionId];
  if (!personas) {
    try { const r = await api.getNpcPersonas(sessionId); personas = (r && r.npcs) || []; }
    catch { personas = []; }
    State.npcPersonasCache[sessionId] = personas;
  }
  const st = State.npcChat;
  if (st.sessionId !== sessionId) {
    if (st.streaming && st.controller) st.controller.abort();
    Object.assign(st, { sessionId, slug: null, name: '', messages: [], streaming: false, controller: null });
  }
  if ((!st.slug || !personas.some((p) => p.slug === st.slug)) && personas.length) {
    st.slug = personas[0].slug; st.name = personas[0].name;
  }
  const selected = personas.find((p) => p.slug === st.slug);
  st.portrait = selected ? (selected.portrait || '') : '';
  const optionFor = (p) => `<option value="${esc(p.slug)}"${p.slug === st.slug ? ' selected' : ''}>${esc(p.name)}</option>`;
  // The GM gets the full roster (some personas come back not allocated to this
  // case); group those apart so a forgotten allocation stands out. Players only
  // ever receive allocated NPCs, so they see a single flat list.
  const gmView = personas.some((p) => !p.allocated);
  let options;
  if (gmView) {
    const inCase = personas.filter((p) => p.allocated).map(optionFor).join('');
    const notInCase = personas.filter((p) => !p.allocated).map(optionFor).join('');
    options = `${inCase ? `<optgroup label="In this case">${inCase}</optgroup>` : ''}`
      + `${notInCase ? `<optgroup label="Not allocated to this case">${notInCase}</optgroup>` : ''}`;
  } else {
    options = personas.map(optionFor).join('');
  }
  tab.innerHTML = `
    <div class="page-header">
      <div>
        <h2>AI Support</h2>
        <p class="card-sub">Chat in character with an NPC. <em>In character — not rules advice.</em></p>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        ${aiSupportToggleHtml(sessionId, 'npc')}
        <button class="btn btn-sm" onclick="clearNpcChat()">Clear</button>
      </div>
    </div>
    <div id="npc-chat-alert"></div>
    ${personas.length ? `
    <div class="form-group" style="max-width:420px;margin-bottom:0.75rem">
      <label>Speaking with</label>
      <select id="npc-select" onchange="setNpcChatTarget(this.value)">${options}</select>
    </div>
    <div class="gmchat-wrap">
      <div class="gmchat-log" id="npc-chat-log"></div>
      <div class="gmchat-compose gmchat-compose-inline">
        <textarea id="npc-chat-text" rows="3" placeholder="Say something to ${esc(st.name)}…" onkeydown="npcChatKey(event)"></textarea>
        <div class="gmchat-actions gmchat-actions-side">
          ${chatMicBtnHtml('npc-chat-mic')}
          <button class="btn btn-primary" id="npc-chat-send" onclick="sendNpcChat()">Send</button>
          <button class="btn" id="npc-chat-stop" onclick="stopNpcChat()" style="display:none">Stop</button>
        </div>
      </div>
    </div>` : '<div class="empty" style="padding:1.5rem"><p>No NPC personalities are available yet. Add a “&lt;Name&gt; - personality.md” handout in Edit Files, or seed a canonical persona.</p></div>'}`;
  if (personas.length) { renderNpcChatLog(); setNpcChatStreaming(st.streaming); wireChatMic('npc-chat-mic', 'npc-chat-text', sessionId); }
}

function npcChatLogHtml() {
  const st = State.npcChat;
  if (!st.messages.length) {
    return `<div class="empty" style="padding:1.5rem"><p>You're speaking with <strong>${esc(st.name || 'an NPC')}</strong>, in character. They won't answer game-rules questions or reveal your case's secrets.</p></div>`;
  }
  return st.messages.map((m, i) => {
    const isNpc = m.role === 'assistant';
    // Each NPC turn carries its own identity, so a carried-over conversation can
    // show more than one speaker correctly (fall back to the active NPC).
    const speakerName = m.speakerName || st.name;
    const portrait = m.portrait != null ? m.portrait : st.portrait;
    const who = m.role === 'user' ? 'You' : esc(speakerName || 'NPC');
    const prev = st.messages[i - 1];
    const handoff = isNpc && prev && prev.role === 'assistant' && prev.speakerSlug !== m.speakerSlug;
    const avatarHtml = (isNpc && portrait) ? `<img src="${esc(portrait)}" alt="" class="npc-chat-portrait">` : '';
    const markdownBody = isNpc;
    let body = markdownBody ? renderAiMarkdown(m.content || '') : esc(m.content || '');
    if (m.streaming) body += '<span class="gmchat-caret">▍</span>';
    if (m.error) body += `<div class="gmchat-error">Error: ${esc(m.error)}</div>`;
    return `<div class="gmchat-msg gmchat-${m.role}${handoff ? ' npc-handoff' : ''}"><div class="gmchat-who">${avatarHtml}${who}</div><div class="gmchat-body${markdownBody ? ' gmchat-markdown-body' : ''}">${body || '<em style="color:var(--text2)">...</em>'}</div></div>`;
  }).join('');
}

function renderNpcChatLog() {
  const log = el('npc-chat-log');
  if (!log) return;
  log.innerHTML = npcChatLogHtml();
  log.scrollTop = log.scrollHeight;
}

function setNpcChatStreaming(on) {
  const send = el('npc-chat-send'); const stop = el('npc-chat-stop'); const text = el('npc-chat-text');
  if (send) send.style.display = on ? 'none' : '';
  if (stop) stop.style.display = on ? '' : 'none';
  if (text) text.disabled = on;
}

function npcChatKey(ev) {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendNpcChat(); }
}
window.npcChatKey = npcChatKey;

function setNpcChatTarget(slug) {
  const st = State.npcChat;
  if (st.streaming) return;
  const personas = State.npcPersonasCache[st.sessionId] || [];
  const p = personas.find((x) => x.slug === slug);
  if (!p) return;
  // Carry the conversation over: switching speaker changes who replies next, it
  // does not clear history (reset happens on leaving the tab / Clear).
  st.slug = p.slug; st.name = p.name; st.portrait = p.portrait || '';
  const t = el('npc-chat-text'); if (t) t.placeholder = `Say something to ${p.name}…`;
  renderNpcChatLog();
}
window.setNpcChatTarget = setNpcChatTarget;

async function sendNpcChat() {
  const st = State.npcChat;
  if (st.streaming || !st.slug) return;
  const textEl = el('npc-chat-text');
  const content = ((textEl && textEl.value) || '').trim();
  if (!content) return;
  st.messages.push({ role: 'user', content });
  if (textEl) textEl.value = '';
  // Stamp the speaker so the log and the server can attribute this turn to the
  // NPC that produced it, even after the dropdown switches to another NPC.
  const reply = { role: 'assistant', content: '', streaming: true,
                  speakerSlug: st.slug, speakerName: st.name, portrait: st.portrait };
  st.messages.push(reply);
  await runNpcStream(reply);
}
window.sendNpcChat = sendNpcChat;

async function runNpcStream(reply) {
  const st = State.npcChat;
  const cut = st.messages.indexOf(reply);
  const payload = st.messages.slice(0, cut < 0 ? st.messages.length : cut)
    .map((m) => ({ role: m.role, content: m.content,
                   speaker: m.role === 'assistant' ? (m.speakerName || null) : null }));
  reply.content = ''; reply.error = null; reply.streaming = true;
  st.controller = new AbortController();
  st.streaming = true;
  setNpcChatStreaming(true);
  llmPendingBegin('NPC Chat');
  renderNpcChatLog();
  try {
    const res = await fetch(`/api/sessions/${st.sessionId}/npc-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ slug: st.slug, messages: payload }),
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
      if (obj.delta) { reply.content += obj.delta; renderNpcChatLog(); }
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
    else reply.error = e.message || 'NPC chat failed';
  } finally {
    reply.streaming = false;
    if (!reply.content && !reply.error) st.messages = st.messages.filter((m) => m !== reply);
    st.streaming = false;
    st.controller = null;
    setNpcChatStreaming(false);
    llmPendingEnd();
    renderNpcChatLog();
  }
}

function stopNpcChat() {
  const st = State.npcChat;
  if (st.controller) st.controller.abort();
}
window.stopNpcChat = stopNpcChat;

// Abort any in-flight stream and drop the conversation. Used both by the Clear
// button and when the user leaves the NPC sub-tab.
function resetNpcChat() {
  const st = State.npcChat;
  if (st.streaming && st.controller) st.controller.abort();
  st.streaming = false; st.controller = null; st.messages = [];
}
function clearNpcChat() {
  resetNpcChat();
  renderNpcChatLog();
}
window.clearNpcChat = clearNpcChat;

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
  SheetForm.setRulesTier('basic');
  SheetForm.setGmEditor(!!(State.user && State.user.role === 'gm'));
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
  // Delegated input/change covers all current and future fields under the
  // sheet host without needing to re-bind after the form's +Add buttons
  // insert new rows.
  host.addEventListener('input', onChange);
  host.addEventListener('change', onChange);
  // The form's +Add and ✕ remove buttons mutate the DOM directly and never
  // fire input/change. Watch the subtree for structural changes so collect()
  // reflects them before the next persist.
  const observer = new MutationObserver(onChange);
  observer.observe(host, { childList: true, subtree: true });
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
