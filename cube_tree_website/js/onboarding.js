/**
 * index.html: sign-in (the profiles on this device) and the
 * first-visit questions.
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
  const initial = name => el('span', { class: 'initial', 'aria-hidden': 'true', text: (name || '?')[0].toUpperCase() });

  const SCREENS = ['welcome', 'speed', 'goals', 'inspection', 'style', 'lastlayer', 'lastslot', 'colours'];
  const params = new URLSearchParams(location.search);
  let draft = null; // { editingId, name, searcher, theme, answers }
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
        lastLayer: (lastLayerOption(a.lastLayer) || LAST_LAYER_OPTIONS[1]).id,
        lastSlot: Array.isArray(a.lastSlot) ? a.lastSlot.slice() : [],
        colours: (a.colours && a.colours.length ? a.colours : ['white']).slice(),
      },
    };
    showAllGoals = false;
    renderOnboarding();
  }

  // ---- light / dark (top bar) ---------------------------------------------
  function renderSwatches() {
    const box = $('#theme-swatches');
    if (!box) return;
    box.innerHTML = '';
    const current = document.documentElement.dataset.theme;
    for (const t of PROFILE_THEMES) {
      box.append(el('button', {
        type: 'button', class: 'theme-swatch', 'aria-pressed': String(t === current),
        onclick: () => setTheme(t),
      }, t[0].toUpperCase() + t.slice(1)));
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
        }, initial(p.name), el('span', { text: p.name }), el('span', { class: 'tag', text: level })),
        el('button', {
          type: 'button', class: 'btn quiet', 'aria-label': `edit ${p.name}`,
          onclick: () => { cubeProfiles.signIn(p.id); applyProfileLook(cubeProfiles.active()); startDraft(cubeProfiles.active()); },
        }, 'Edit'),
        el('button', {
          type: 'button', class: 'btn quiet', title: 'a code that copies this profile to another device', 'aria-label': `export ${p.name}`,
          onclick: () => showCode(cubeProfiles.exportCode(p.id)),
        }, 'Export'),
        el('button', {
          type: 'button', class: 'btn quiet', 'aria-label': `delete ${p.name}`,
          onclick: () => { if (confirm(caption('profiles.deleteConfirm', { name: p.name }))) { cubeProfiles.remove(p.id); renderProfiles(); } },
        }, 'Delete'),
      ));
    }
    const importBox = el('textarea', { class: 'textarea code-box', placeholder: 'paste a profile code', 'aria-label': 'profile code', hidden: true });
    const importGo = el('button', {
      type: 'button', class: 'btn', hidden: true,
      onclick: () => {
        const p = cubeProfiles.importCode(importBox.value);
        if (!p) { renderProfiles(caption('profiles.importFailed')); return; }
        applyProfileLook(p);
        if (p.onboarded) location.href = 'solver.html'; else startDraft(p);
      },
    }, 'Import');
    const active = cubeProfiles.active();
    body.append(...[
      list,
      message ? el('p', { class: 'sub', text: message }) : null,
      el('div', { class: 'speed-row' },
        active && active.onboarded ? el('a', { class: 'btn primary', href: 'solver.html' }, `Solve as ${active.name} ›`) : null,
        el('button', { type: 'button', class: active && active.onboarded ? 'btn' : 'btn primary', onclick: () => { cubeProfiles.signOut(); startDraft(null); } }, caption('profiles.new')),
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
    const box = el('textarea', { class: 'textarea code-box', readonly: true, 'aria-label': 'profile code' });
    box.value = code;
    body.append(
      el('p', { class: 'sub', text: caption('profiles.exported') }),
      box,
      el('div', { class: 'speed-row' },
        el('button', { type: 'button', class: 'btn', onclick: () => { box.select(); try { navigator.clipboard.writeText(code); } catch (e) { document.execCommand('copy'); } } }, 'Copy'),
        el('button', { type: 'button', class: 'btn quiet', onclick: () => renderProfiles() }, 'Back'),
      ),
    );
  }

  // ---- the questions ----------------------------------------------------------
  function heading(key) {
    const text = `onboard.${key}.text`;
    return [el('h2', { text: caption(`onboard.${key}.title`) }), CAPTIONS[text] ? el('p', { class: 'sub', text: caption(text) }) : null].filter(Boolean);
  }

  function choiceList(name, options, selected, multi, onChange) {
    return el('div', { class: 'choice-list', role: multi ? 'group' : 'radiogroup' }, options.map(o => {
      const input = el('input', { type: multi ? 'checkbox' : 'radio', name, value: o.id, checked: multi ? selected.includes(o.id) : selected === o.id });
      input.addEventListener('change', () => onChange(o.id, input.checked));
      return el('label', { class: 'choice check' }, input, el('span', { text: caption(o.caption) }), o.tag ? el('span', { class: 'tag', text: o.tag }) : null);
    }));
  }

  const SCREEN_RENDER = {
    welcome(body) {
      const name = el('input', { class: 'input', type: 'text', maxlength: 24, placeholder: 'name', 'aria-label': 'name', value: draft.name });
      name.addEventListener('input', () => { draft.name = name.value; });
      body.append(...heading('welcome'), name);
      if (!body.isConnected) setTimeout(() => name.focus(), 0);
    },
    speed(body) {
      const input = el('input', { class: 'input', type: 'number', min: 3, max: 600, step: 0.1, inputmode: 'decimal', 'aria-label': 'average in seconds', value: draft.answers.speed });
      const readout = el('span', { class: 'level-readout' });
      const note = el('p', { class: 'level-note' });
      const update = () => {
        draft.answers.speed = input.value ? Number(input.value) : '';
        const level = draft.answers.speed ? SKILL_LEVELS[levelFor(draft.answers.speed)] : null;
        readout.textContent = level ? caption(level.caption) : '';
        note.textContent = level ? caption(`${level.caption}.note`) : '';
      };
      let t = 0;
      input.addEventListener('input', () => { update(); clearTimeout(t); t = setTimeout(() => rerender('goals'), 400); });
      update();
      body.append(...heading('speed'), el('div', { class: 'speed-row' }, input, el('span', { text: 's' }), readout), note);
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
        else body.append(el('button', { type: 'button', class: 'link-btn', onclick: () => { showAllGoals = true; rerender('goals'); } }, caption('onboard.goals.showAll')));
      }
      body.append(el('p', { class: 'sub', text: caption('onboard.goals.settings') }));
    },
    lastlayer(body) {
      body.append(...heading('lastlayer'), choiceList('lastlayer', LAST_LAYER_OPTIONS, draft.answers.lastLayer, false, (id) => { draft.answers.lastLayer = id; }));
    },
    lastslot(body) {
      const toggle = (id, on) => {
        const set = new Set(draft.answers.lastSlot);
        if (on) set.add(id); else set.delete(id);
        draft.answers.lastSlot = LAST_SLOT_OPTIONS.map(o => o.id).filter(x => set.has(x));
      };
      body.append(...heading('lastslot'), choiceList('lastslot', LAST_SLOT_OPTIONS, draft.answers.lastSlot, true, toggle));
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
            rerender('colours');
          },
        }));
      }
      body.append(...heading('colours'), row);
    },
  };

  function rerender(key) {
    const sec = document.querySelector(`#screen [data-q="${key}"]`);
    if (!sec) return;
    sec.innerHTML = '';
    SCREEN_RENDER[key](sec);
  }

  // every question on one page; each answer can be changed later in Options
  function renderOnboarding() {
    $('#onboard-title').textContent = draft.editingId ? 'Profile setup' : 'New profile';
    const body = $('#screen');
    body.innerHTML = '';
    for (const key of SCREENS) {
      const sec = el('section', { class: 'q', 'data-q': key });
      SCREEN_RENDER[key](sec);
      body.append(sec);
    }
    $('#onboard-nav').hidden = false;
    $('#onboard-back').hidden = !cubeProfiles.list().length;
    $('#onboard-next').textContent = caption('onboard.done');
  }

  function next() {
    if (draft) finish();
  }
  function back() {
    if (draft && cubeProfiles.list().length) renderProfiles();
  }

  /** Saves the profile and its settings (scoped to it), then opens the main screen. */
  function finish() {
    const ll = lastLayerOption(draft.answers.lastLayer);
    const fields = {
      name: draft.name.trim() || 'cuber',
      searcher: draft.searcher,
      answers: { ...draft.answers, speed: draft.answers.speed || null, knownSets: ll ? ll.knownSets.slice() : [] },
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
    const active = cubeProfiles.active();
    if (params.has('onboard') && active) { startDraft(active); return; }
    if (active && active.onboarded && !params.has('profiles')) { location.replace('solver.html'); return; }
    if (active && !params.has('profiles')) { startDraft(active); return; }
    if (cubeProfiles.list().length) renderProfiles(); else startDraft(null);
  });
})();
