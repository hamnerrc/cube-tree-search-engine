#!/usr/bin/env node
/**
 * profile.js: local profiles (README "Profiles"). Create / sign in / sign
 * out / delete, keys scoped per profile, the first profile taking over the
 * settings saved before profiles existed, export/import codes, and a
 * storage that throws (private mode) never breaking the page.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const {
  createProfileStore, memoryStorage, PROFILE_STORE_KEY, PROFILE_DEFAULT_PREFS,
} = require(path.join(__dirname, '..', 'js', 'profile.js'));

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};

test('no profile at first; create signs in with default prefs', () => {
  const store = createProfileStore(memoryStorage());
  assert.strictEqual(store.active(), null);
  assert.deepStrictEqual(store.list(), []);
  const p = store.create({ name: 'rick', searcher: 2, answers: { speed: 14 } });
  assert.strictEqual(store.active().id, p.id);
  assert.strictEqual(p.name, 'rick');
  assert.strictEqual(p.searcher, 2);
  assert.strictEqual(p.onboarded, false);
  assert.deepStrictEqual(p.prefs, PROFILE_DEFAULT_PREFS);
  assert.deepStrictEqual(p.answers, { speed: 14 });
});

test('sign out keeps the profile; sign in picks it again', () => {
  const store = createProfileStore(memoryStorage());
  const a = store.create({ name: 'a' });
  const b = store.create({ name: 'b' });
  assert.strictEqual(store.active().id, b.id);
  store.signOut();
  assert.strictEqual(store.active(), null);
  assert.strictEqual(store.list().length, 2);
  assert.ok(store.signIn(a.id));
  assert.strictEqual(store.active().name, 'a');
  assert.ok(!store.signIn('nope'));
});

test('update merges answers and prefs one level deep', () => {
  const store = createProfileStore(memoryStorage());
  const p = store.create({ answers: { speed: 20, style: 'tps' } });
  const q = store.update(p.id, { onboarded: true, answers: { style: 'efficiency' }, prefs: { theme: 'paper' } });
  assert.strictEqual(q.onboarded, true);
  assert.deepStrictEqual(q.answers, { speed: 20, style: 'efficiency' });
  assert.strictEqual(q.prefs.theme, 'paper');
  assert.strictEqual(q.prefs.pixelRes, PROFILE_DEFAULT_PREFS.pixelRes);
  assert.strictEqual(store.get(p.id).prefs.theme, 'paper');
});

test('keys are scoped to the active profile; unscoped when signed out', () => {
  const store = createProfileStore(memoryStorage());
  assert.strictEqual(store.key('cubetree.view'), 'cubetree.view');
  const p = store.create({});
  assert.strictEqual(store.key('cubetree.view'), `cubetree.view:${p.id}`);
  store.signOut();
  assert.strictEqual(store.key('cubetree.view'), 'cubetree.view');
});

test('the first profile takes over pre-profile settings; later ones start empty', () => {
  const storage = memoryStorage();
  storage.setItem('cubetree.criteria', '{"colors":["yellow"]}');
  storage.setItem('cubetree.view', '{"multislot":true}');
  const store = createProfileStore(storage);
  const a = store.create({});
  assert.strictEqual(storage.getItem(`cubetree.criteria:${a.id}`), '{"colors":["yellow"]}');
  assert.strictEqual(storage.getItem(`cubetree.view:${a.id}`), '{"multislot":true}');
  const b = store.create({});
  assert.strictEqual(storage.getItem(`cubetree.criteria:${b.id}`), null);
});

test('remove deletes the profile and its scoped settings', () => {
  const storage = memoryStorage();
  const store = createProfileStore(storage);
  const p = store.create({});
  storage.setItem(store.key('cubetree.session'), '{}');
  assert.ok(store.remove(p.id));
  assert.strictEqual(store.active(), null);
  assert.strictEqual(store.list().length, 0);
  assert.strictEqual(storage.getItem(`cubetree.session:${p.id}`), null);
});

test('export code round-trips the profile and its settings into a new profile', () => {
  const s1 = memoryStorage();
  const one = createProfileStore(s1);
  const p = one.create({ name: 'Zoë ⑂', searcher: 3, answers: { speed: 11, goals: ['multislot'] }, prefs: { theme: 'violet' } });
  s1.setItem(one.key('cubetree.criteria'), '{"colors":["white","yellow"]}');
  const code = one.exportCode(p.id);
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(code), 'plain base64');
  const s2 = memoryStorage();
  const two = createProfileStore(s2);
  const q = two.importCode(code);
  assert.ok(q && q.id !== undefined);
  assert.strictEqual(q.name, 'Zoë ⑂');
  assert.strictEqual(q.searcher, 3);
  assert.deepStrictEqual(q.answers, { speed: 11, goals: ['multislot'] });
  assert.strictEqual(q.prefs.theme, 'violet');
  assert.strictEqual(two.active().id, q.id);
  assert.strictEqual(s2.getItem(`cubetree.criteria:${q.id}`), '{"colors":["white","yellow"]}');
  assert.strictEqual(two.importCode('not a code!'), null);
  assert.strictEqual(two.importCode(''), null);
});

test('a throwing storage (private mode) never throws out of the store', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const store = createProfileStore(bad);
  assert.strictEqual(store.active(), null);
  const p = store.create({ name: 'x' });
  assert.ok(p.id);
  store.signOut();
  store.remove(p.id);
  assert.deepStrictEqual(store.list(), []);
});

test('a corrupt saved blob reads as no profiles', () => {
  const storage = memoryStorage();
  storage.setItem(PROFILE_STORE_KEY, '{not json');
  const store = createProfileStore(storage);
  assert.deepStrictEqual(store.list(), []);
  storage.setItem(PROFILE_STORE_KEY, JSON.stringify({ activeId: 'gone', profiles: {} }));
  assert.strictEqual(store.active(), null);
});

test('profiles saved before the rename keep their tree-searcher', () => {
  const storage = memoryStorage();
  storage.setItem(PROFILE_STORE_KEY, JSON.stringify({ version: 1, activeId: 'a', profiles: { a: { id: 'a', name: 'old', avatar: 4, answers: {}, prefs: {} } } }));
  const s = createProfileStore(storage);
  assert.strictEqual(s.active().searcher, 4);
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
test('keys saved under the old names move to the new ones, per profile', () => {
  const storage = memoryStorage();
  storage.setItem(PROFILE_STORE_KEY, JSON.stringify({ version: 1, activeId: 'p1', profiles: { p1: { id: 'p1', name: 'a' } } }));
  storage.setItem('cubecrit_view_prefs:p1', '{"multislot":true}');
  storage.setItem('cubecrit_search_criteria', '{"colors":["white"]}');
  createProfileStore(storage);
  assert.strictEqual(storage.getItem('cubetree.view:p1'), '{"multislot":true}');
  assert.strictEqual(storage.getItem('cubetree.criteria'), '{"colors":["white"]}');
  assert.strictEqual(storage.getItem('cubecrit_view_prefs:p1'), null);
});

console.log('All profile tests passed.');
