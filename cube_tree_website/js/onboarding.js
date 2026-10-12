/**
 * onboarding.js — index.html: sign-in (the profiles on this device) and the
 * first-visit questions (README "Profiles", "Onboarding").
 *
 * A signed-in, onboarded profile goes straight to solver.html. ?profiles
 * shows the profile list anyway (the main screen's "switch profile"),
 * ?onboard runs the questions again for the signed-in profile.
 */
'use strict';

(function () {
  if (typeof document === 'undefined' || !cubeProfiles) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined) n.append(kid);
    return n;
  };
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const searcherCanvas = (index, size = 64) => {
    const c = el('canvas', { width: size, height: size, 'aria-hidden': 'true' });
    drawSearcher(c, index, cssVar('--ink'), cssVar('--panel'));
    return c;
  };

  const SCREENS = ['welcome', 'speed', 'inspection', 'style', 'goals', 'colours'];
  const params = new URLSearchParams(location.search);
  let draft = null; // { editingId, name, searcher, theme, answers }
  let screen = 0;
  let showAllGoals = false;

  function startDraft(profile) {
    const a = (profile && profile.answers) || {};
    draft = {
      editingId: profile ? profile.id : null,
      name: profile ? profile.name : '',
      searcher: profile ? profile.searcher : 0,
      theme: (profile && profile.prefs && profile.prefs.theme) || document.documentElement.dataset.theme || PROFILE_THEMES[0],
      answers: {
        speed: a.speed || '',
        inspection: inspectionOption(a.inspection).id,
        style: a.style || 'tps',
        goals: (a.goals || []).slice(),
        colours: (a.colours && a.colours.length ? a.colours : ['white']).slice(),
      },
    };
    screen = 0;
    showAllGoals = false;
    renderOnboarding();
  }

  // ---- theme swatches (top bar) -------------------------------------------
  const SWATCH = { ink: ['#0a0a0b', '#f1f1ee'], violet: ['#2b1a4a', '#f3efff'], paper: ['#faf9f4', '#141414'], mint: ['#e7f4e3', '#22314a'] };
  function renderSwatches() {
    const box = $('#theme-swatches');
    if (!box) return;
    box.innerHTML = '';
    const current = document.documentElement.dataset.theme;
    for (const t of PROFILE_THEMES) {
      const [bg, fg] = SWATCH[t];
      box.append(el('button', {
        type: 'button', class: 'theme-swatch', title: t, 'aria-label': `${t} theme`, 'aria-pressed': String(t === current),
        style: `background: linear-gradient(135deg, ${bg} 55%, ${fg} 55%)`,
        onclick: () => setTheme(t),
      }));
    }
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    if (draft) draft.theme = t;
    const active = cubeProfiles.active();
    if (active && (!draft || draft.editingId === active.id)) cubeProfiles.update(active.id, { prefs: { theme: t } });
    renderSwatches();
    // sprites are drawn in the theme's colours
    if (draft) renderOnboarding(); else renderProfiles();
  }

  // ---- profile list (sign-in) -----------------------------------------------
  function renderProfiles(message = '') {
    draft = null;
    const title = $('#onboard-title');
    title.textContent = caption('profiles.title');
    const body = $('#screen');
    body.innerHTML = '';
    const list = el('div', { class: 'profile-list' });
    for (const p of cubeProfiles.list()) {
      const level = p.answers && p.answers.speed ? caption(SKILL_LEVELS[levelFor(p.answers.speed)].caption) : '';
      list.append(el('div', { class: 'profile-row' },
        el('button', {
          type: 'button', class: 'choice',
          onclick: () => {
            cubeProfiles.signIn(p.id);
            applyProfileLook(cubeProfiles.active());
            if (p.onboarded) location.href = 'solver.html'; else startDraft(cubeProfiles.active());
          },
        }, searcherCanvas(p.searcher, 32), el('span', { text: p.name }), el('span', { class: 'tag', text: level })),
        el('button', {
          type: 'button', class: 'px-btn icon quiet', title: 'export a code', 'aria-label': `export ${p.name}`,
          onclick: () => showCode(cubeProfiles.exportCode(p.id)),
        }, '⇪'),
        el('button', {
          type: 'button', class: 'px-btn icon quiet', title: 'delete', 'aria-label': `delete ${p.name}`,
          onclick: () => { if (confirm(caption('profiles.deleteConfirm', { name: p.name }))) { cubeProfiles.remove(p.id); renderProfiles(); } },
        }, '×'),
      ));
    }
    const importBox = el('textarea', { class: 'px-textarea code-box', placeholder: 'paste a profile code', 'aria-label': 'profile code', hidden: true });
    const importGo = el('button', {
      type: 'button', class: 'px-btn', hidden: true,
      onclick: () => {
        const p = cubeProfiles.importCode(importBox.value);
        if (!p) { renderProfiles(caption('profiles.importFailed')); return; }
        applyProfileLook(p);
        if (p.onboarded) location.href = 'solver.html'; else startDraft(p);
      },
    }, 'import');
    const active = cubeProfiles.active();
    body.append(...[
      list,
      message ? el('p', { class: 'sub', text: message }) : null,
      el('div', { class: 'speed-row' },
        active && active.onboarded ? el('a', { class: 'px-btn primary', href: 'solver.html' }, `solve as ${active.name} ›`) : null,
        el('button', { type: 'button', class: active && active.onboarded ? 'px-btn' : 'px-btn primary', onclick: () => { cubeProfiles.signOut(); startDraft(null); } }, caption('profiles.new')),
        el('button', { type: 'button', class: 'link-btn', onclick: () => { importBox.hidden = false; importGo.hidden = false; importBox.focus(); } }, caption('profiles.import')),
      ),
      importBox,
      importGo,
    ].filter(Boolean));
    $('#onboard-nav').hidden = true;
  }

  function showCode(code) {
    const body = $('#screen');
    body.innerHTML = '';
    const box = el('textarea', { class: 'px-textarea code-box', readonly: true, 'aria-label': 'profile code' });
    box.value = code;
    body.append(
      el('p', { class: 'sub', text: caption('profiles.exported') }),
      box,
      el('div', { class: 'speed-row' },
        el('button', { type: 'button', class: 'px-btn', onclick: () => { box.select(); try { navigator.clipboard.writeText(code); } catch (e) { document.execCommand('copy'); } } }, 'copy'),
        el('button', { type: 'button', class: 'px-btn quiet', onclick: () => renderProfiles() }, 'back'),
      ),
    );
  }

  // ---- the questions ----------------------------------------------------------
  function heading(key) {
    return [el('h2', { text: caption(`onboard.${key}.title`) }), el('p', { class: 'sub', text: caption(`onboard.${key}.text`) })];
  }

  function choiceList(name, options, selected, multi, onChange) {
    return el('div', { class: 'choice-list', role: multi ? 'group' : 'radiogroup' }, options.map(o => {
      const input = el('input', { type: multi ? 'checkbox' : 'radio', name, value: o.id, checked: multi ? selected.includes(o.id) : selected === o.id });
      input.addEventListener('change', () => onChange(o.id, input.checked));
      return el('label', { class: 'choice px-check' }, input, el('span', { text: caption(o.caption) }), o.tag ? el('span', { class: 'tag', text: o.tag }) : null);
    }));
  }

  const SCREEN_RENDER = {
    welcome(body) {
      const name = el('input', { class: 'px-input', type: 'text', maxlength: 24, placeholder: 'name', 'aria-label': 'name', value: draft.name });
      name.addEventListener('input', () => { draft.name = name.value; });
      const grid = el('div', { class: 'searcher-grid', role: 'radiogroup', 'aria-label': 'tree-searcher' });
      for (let i = 0; i < SEARCHER_COUNT(); i++) {
        grid.append(el('button', {
          type: 'button', class: 'searcher-choice', 'aria-pressed': String(draft.searcher === i), 'aria-label': `tree-searcher ${i + 1}`,
          onclick: () => { draft.searcher = i; renderOnboarding(); },
        }, searcherCanvas(i, 64)));
      }
      body.append(...heading('welcome'), name, grid);
      setTimeout(() => name.focus(), 0);
    },
    speed(body) {
      const input = el('input', { class: 'px-input', type: 'number', min: 3, max: 600, step: 0.1, inputmode: 'decimal', 'aria-label': 'average in seconds', value: draft.answers.speed });
      const readout = el('span', { class: 'level-readout' });
      const note = el('p', { class: 'level-note' });
      const update = () => {
        draft.answers.speed = input.value ? Number(input.value) : '';
        const level = draft.answers.speed ? SKILL_LEVELS[levelFor(draft.answers.speed)] : null;
        readout.textContent = level ? caption(level.caption) : '';
        note.textContent = level ? caption(`${level.caption}.note`) : '';
      };
      input.addEventListener('input', update);
      update();
      body.append(...heading('speed'), el('div', { class: 'speed-row' }, input, el('span', { text: 's' }), readout), note);
      setTimeout(() => input.focus(), 0);
    },
    inspection(body) {
      body.append(...heading('inspection'), choiceList('inspection', INSPECTION_OPTIONS, draft.answers.inspection, false, (id) => { draft.answers.inspection = id; }));
    },
    style(body) {
      body.append(...heading('style'), choiceList('style', STYLE_OPTIONS, draft.answers.style, false, (id) => { draft.answers.style = id; }));
    },
    goals(body) {
      const split = goalsFor(levelFor(draft.answers.speed));
      const toggle = (id, on) => {
        const g = new Set(draft.answers.goals);
        if (on) g.add(id); else g.delete(id);
        draft.answers.goals = [...g];
      };
      body.append(...heading('goals'), choiceList('goals', split.recommended, draft.answers.goals, true, toggle));
      const extra = [
        ...split.later.map(g => ({ ...g, tag: caption('onboard.goals.later') })),
        ...split.basics.map(g => ({ ...g, tag: caption('onboard.goals.basics') })),
      ];
      if (extra.length) {
        if (showAllGoals) body.append(choiceList('goals-more', extra, draft.answers.goals, true, toggle));
        else body.append(el('button', { type: 'button', class: 'link-btn', onclick: () => { showAllGoals = true; renderOnboarding(); } }, caption('onboard.goals.showAll')));
      }
      body.append(el('p', { class: 'sub', text: caption('onboard.goals.settings') }));
    },
    colours(body) {
      const row = el('div', { class: 'colour-row', role: 'group', 'aria-label': 'cross colours' });
      const HEX = { white: '#f4f4f4', yellow: '#ffd500', green: '#13c447', blue: '#1e5bff', red: '#e8231c', orange: '#ff8a00' };
      for (const c of CROSS_COLOURS) {
        const on = draft.answers.colours.includes(c);
        row.append(el('button', {
          type: 'button', class: 'colour-chip', title: c, 'aria-label': c, 'aria-pressed': String(on), style: `background:${HEX[c]}`,
          onclick: () => {
            const set = new Set(draft.answers.colours);
            if (on && set.size > 1) set.delete(c); else set.add(c);
            draft.answers.colours = CROSS_COLOURS.filter(x => set.has(x));
            renderOnboarding();
          },
        }));
      }
      body.append(...heading('colours'), row);
    },
  };

  function renderOnboarding() {
    $('#onboard-title').textContent = 'cube⑂tree';
    const body = $('#screen');
    body.innerHTML = '';
    SCREEN_RENDER[SCREENS[screen]](body);
    const nav = $('#onboard-nav');
    nav.hidden = false;
    const dots = $('#onboard-dots');
    dots.innerHTML = '';
    SCREENS.forEach((_, i) => dots.append(el('span', { class: i <= screen ? 'on' : '' })));
    $('#onboard-back').disabled = screen === 0 && !cubeProfiles.list().length;
    $('#onboard-next').textContent = screen === SCREENS.length - 1 ? caption('onboard.done') : 'next ›';
  }

  function next() {
    if (!draft) return;
    if (screen < SCREENS.length - 1) { screen++; renderOnboarding(); return; }
    finish();
  }
  function back() {
    if (!draft) return;
    if (screen > 0) { screen--; renderOnboarding(); return; }
    if (cubeProfiles.list().length) renderProfiles();
  }

  /** Saves the profile and its settings (scoped to it), then opens the main screen. */
  function finish() {
    const fields = {
      name: draft.name.trim() || 'cuber',
      searcher: draft.searcher,
      answers: { ...draft.answers, speed: draft.answers.speed || null },
      onboarded: true,
    };
    const profile = draft.editingId
      ? cubeProfiles.update(draft.editingId, { ...fields, prefs: { theme: draft.theme } })
      : cubeProfiles.create({ ...fields, prefs: { theme: draft.theme } });
    cubeProfiles.signIn(profile.id);
    const settings = settingsFromAnswers(profile.answers);
    let prev = null;
    try { prev = loadSearchCriteria(); } catch (err) { prev = null; }
    const keep = prev && (prev.advanced || []).includes('full_pseudo') ? ['full_pseudo'] : [];
    const scrambles = prev && prev.scrambles && prev.scrambles.length
      ? prev.scrambles
      : [typeof generateRandomStateScramble === 'function' ? generateRandomStateScramble() : generateScramble()];
    try {
      localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(normalizeCriteria({
        colors: settings.colors,
        advanced: [...settings.advanced, ...keep],
        searchConfig: prev ? prev.searchConfig : undefined,
        scrambles,
        version: CRITERIA_VERSION,
      })));
      let view = {};
      try { view = JSON.parse(localStorage.getItem(scopedKey(VIEW_PREFS_KEY)) || '{}') || {}; } catch (err) { view = {}; }
      localStorage.setItem(scopedKey(VIEW_PREFS_KEY), JSON.stringify({ ...view, ...settings.view }));
    } catch (err) { /* private mode: the main screen starts from defaults */ }
    location.href = 'solver.html';
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderSwatches();
    $('#onboard-next').addEventListener('click', next);
    $('#onboard-back').addEventListener('click', back);
    $('#onboard').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && draft && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        next();
      }
    });
    const active = cubeProfiles.active();
    if (params.has('onboard') && active) { startDraft(active); return; }
    if (active && active.onboarded && !params.has('profiles')) { location.replace('solver.html'); return; }
    if (active && !params.has('profiles')) { startDraft(active); return; }
    if (cubeProfiles.list().length) renderProfiles(); else startDraft(null);
  });
})();
