/**
 * Local profiles ("sign-in" without a server).
 */
'use strict';

const PROFILE_STORE_KEY = 'cubetree.profiles';
const PROFILE_STORE_VERSION = 1;
const LEGACY_PROFILE_KEYS = ['cubetree.criteria', 'cubetree.view', 'cubetree.session'];
const EXPORTED_PROFILE_KEYS = ['cubetree.criteria', 'cubetree.view'];
// keys from before the rename, moved over once
const OLD_KEY_NAMES = { 'cubecrit_search_criteria': 'cubetree.criteria', 'cubecrit_view_prefs': 'cubetree.view', 'cubecrit_session_state': 'cubetree.session' };
const PROFILE_DEFAULT_PREFS = { theme: 'light', pixelRes: 'smooth', backFaces: true, animSpeed: 1 };

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function defaultProfileStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__cubetree_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch (err) { /* blocked: fall through */ }
  return memoryStorage();
}

function newProfileId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function encodeProfileCode(obj) {
  const json = JSON.stringify(obj);
  if (typeof Buffer !== 'undefined') return Buffer.from(json, 'utf8').toString('base64');
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeProfileCode(code) {
  const text = String(code || '').trim();
  const json = typeof Buffer !== 'undefined'
    ? Buffer.from(text, 'base64').toString('utf8')
    : decodeURIComponent(escape(atob(text)));
  return JSON.parse(json);
}

function createProfileStore(storage = defaultProfileStorage()) {
  const safeGet = (k) => { try { return storage.getItem(k); } catch (err) { return null; } };
  const safeSet = (k, v) => { try { storage.setItem(k, v); return true; } catch (err) { return false; } };
  const safeRemove = (k) => { try { storage.removeItem(k); } catch (err) { /* ignore */ } };

  function migrateOldKeys() {
    let ids = [];
    try { ids = Object.keys((JSON.parse(safeGet(PROFILE_STORE_KEY) || 'null') || {}).profiles || {}); } catch (err) { ids = []; }
    for (const [oldBase, newBase] of Object.entries(OLD_KEY_NAMES)) {
      for (const suffix of ['', ...ids.map(id => `:${id}`)]) {
        const v = safeGet(oldBase + suffix);
        if (v === null) continue;
        if (safeGet(newBase + suffix) === null) safeSet(newBase + suffix, v);
        safeRemove(oldBase + suffix);
      }
    }
  }
  migrateOldKeys();

  function load() {
    let state = null;
    try { state = JSON.parse(safeGet(PROFILE_STORE_KEY) || 'null'); } catch (err) { state = null; }
    if (!state || typeof state !== 'object' || !state.profiles) state = { version: PROFILE_STORE_VERSION, activeId: null, profiles: {} };
    if (state.activeId && !state.profiles[state.activeId]) state.activeId = null;
    for (const p of Object.values(state.profiles)) {
      if (p && p.searcher === undefined && p.avatar !== undefined) { p.searcher = p.avatar; delete p.avatar; }
    }
    return state;
  }
  function save(state) { safeSet(PROFILE_STORE_KEY, JSON.stringify(state)); }

  const scoped = (base, id) => `${base}:${id}`;

  const store = {
    storage,
    load,
    list() {
      return Object.values(load().profiles).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },
    active() {
      const s = load();
      return s.activeId ? s.profiles[s.activeId] : null;
    },
    get(id) { return load().profiles[id] || null; },
    create(fields = {}) {
      const s = load();
      const first = !Object.keys(s.profiles).length;
      const id = newProfileId();
      const profile = {
        id,
        name: String(fields.name || 'cuber').slice(0, 24),
        searcher: fields.searcher || 0,
        createdAt: Date.now(),
        onboarded: !!fields.onboarded,
        answers: { ...(fields.answers || {}) },
        prefs: { ...PROFILE_DEFAULT_PREFS, ...(fields.prefs || {}) },
        algs: { main: {}, known: {} },
      };
      s.profiles[id] = profile;
      s.activeId = id;
      save(s);
      if (first) {
        for (const k of LEGACY_PROFILE_KEYS) {
          const v = safeGet(k);
          if (v !== null && safeGet(scoped(k, id)) === null) safeSet(scoped(k, id), v);
        }
      }
      return profile;
    },
    update(id, patch = {}) {
      const s = load();
      const p = s.profiles[id];
      if (!p) return null;
      const next = { ...p, ...patch };
      if (patch.answers) next.answers = { ...p.answers, ...patch.answers };
      if (patch.prefs) next.prefs = { ...p.prefs, ...patch.prefs };
      next.id = id;
      s.profiles[id] = next;
      save(s);
      return next;
    },
    signIn(id) {
      const s = load();
      if (!s.profiles[id]) return false;
      s.activeId = id;
      save(s);
      return true;
    },
    algs(id) {
      const p = load().profiles[id];
      const a = (p && p.algs) || {};
      return { main: { ...(a.main || {}) }, known: { ...(a.known || {}) } };
    },
    setMainAlg(id, caseId, alg) {
      const s = load();
      const p = s.profiles[id];
      if (!p) return null;
      p.algs = { main: { ...((p.algs || {}).main || {}) }, known: { ...((p.algs || {}).known || {}) } };
      if (alg) { p.algs.main[caseId] = alg; p.algs.known[caseId] = true; } else delete p.algs.main[caseId];
      save(s);
      return p.algs;
    },
    setKnown(id, caseIds, on = true) {
      const s = load();
      const p = s.profiles[id];
      if (!p) return null;
      p.algs = { main: { ...((p.algs || {}).main || {}) }, known: { ...((p.algs || {}).known || {}) } };
      for (const c of [].concat(caseIds)) { if (on) p.algs.known[c] = true; else delete p.algs.known[c]; }
      save(s);
      return p.algs;
    },
    signOut() {
      const s = load();
      s.activeId = null;
      save(s);
    },
    remove(id) {
      const s = load();
      if (!s.profiles[id]) return false;
      delete s.profiles[id];
      if (s.activeId === id) s.activeId = null;
      save(s);
      for (const k of LEGACY_PROFILE_KEYS) safeRemove(scoped(k, id));
      return true;
    },
    key(base) {
      const s = load();
      return s.activeId ? scoped(base, s.activeId) : base;
    },
    exportCode(id) {
      const p = load().profiles[id];
      if (!p) return '';
      const data = {};
      for (const k of EXPORTED_PROFILE_KEYS) {
        const v = safeGet(scoped(k, id));
        if (v !== null) data[k] = v;
      }
      const { id: _drop, ...profile } = p;
      return encodeProfileCode({ v: PROFILE_STORE_VERSION, profile, data });
    },
    importCode(code) {
      let obj;
      try { obj = decodeProfileCode(code); } catch (err) { return null; }
      if (!obj || !obj.profile || typeof obj.profile !== 'object') return null;
      const s = load();
      const id = newProfileId();
      const p = obj.profile;
      s.profiles[id] = {
        id,
        name: String(p.name || 'cuber').slice(0, 24),
        searcher: p.searcher || p.avatar || 0,
        createdAt: Date.now(),
        onboarded: !!p.onboarded,
        answers: { ...(p.answers || {}) },
        prefs: { ...PROFILE_DEFAULT_PREFS, ...(p.prefs || {}) },
        algs: { main: { ...((p.algs || {}).main || {}) }, known: { ...((p.algs || {}).known || {}) } },
      };
      s.activeId = id;
      save(s);
      for (const k of EXPORTED_PROFILE_KEYS) {
        const old = Object.keys(OLD_KEY_NAMES).find(o => OLD_KEY_NAMES[o] === k);
        const v = obj.data && (typeof obj.data[k] === 'string' ? obj.data[k] : obj.data[old]);
        if (typeof v === 'string') safeSet(scoped(k, id), v);
      }
      return s.profiles[id];
    },
  };
  return store;
}

const cubeProfiles = typeof window !== 'undefined' ? createProfileStore() : null;

function profileKey(base) {
  return cubeProfiles ? cubeProfiles.key(base) : base;
}

const PROFILE_THEMES = ['light', 'dark'];
const LEGACY_THEMES = { ink: 'dark', violet: 'dark', paper: 'light', mint: 'light' };

function applyProfileLook(profile) {
  if (typeof document === 'undefined') return;
  let theme = profile && profile.prefs && profile.prefs.theme;
  theme = LEGACY_THEMES[theme] || theme;
  if (!PROFILE_THEMES.includes(theme)) theme = PROFILE_THEMES[0];
  document.documentElement.dataset.theme = theme;
}

if (cubeProfiles) applyProfileLook(cubeProfiles.active());

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createProfileStore, memoryStorage, profileKey, encodeProfileCode, decodeProfileCode,
    PROFILE_STORE_KEY, LEGACY_PROFILE_KEYS, PROFILE_DEFAULT_PREFS, PROFILE_THEMES,
  };
}
