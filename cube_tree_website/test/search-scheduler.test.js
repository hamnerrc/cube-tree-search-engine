#!/usr/bin/env node
/**
 * search-scheduler.js: background searches run one at a time, the active
 * scramble's search jumps the queue and pre-empts background engine calls,
 * priorities follow scramble switches, and the engine never sees two
 * concurrent calls. Fake helpers with timed solve* methods; no WASM.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { createSearchScheduler, SEARCH_PRIORITY } = require(path.join(__dirname, '..', 'js', 'search-scheduler.js'));
const { BACKGROUND, ACTIVE } = SEARCH_PRIORITY;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A fake engine: each solve takes `ms`, logs its tag, and fails on overlap. */
function fakeHelper(log, ms = 5) {
  let busy = false;
  return {
    name: 'fake',
    async solveCross(tag) {
      if (busy) throw new Error('Another solve is in progress');
      busy = true;
      log.push(tag);
      await sleep(ms);
      busy = false;
      return [tag];
    },
    notASolve() { return this.name; },
  };
}

/** A search: `calls` engine calls tagged name0..nameN, with JS work between. */
const search = (h, name, calls) => async wrap => {
  const gated = wrap(h);
  for (let i = 0; i < calls; i++) {
    await gated.solveCross(`${name}${i}`);
    await sleep(1);
  }
  return name;
};

test('background jobs run one at a time, in submission order', async () => {
  const log = [];
  const h = fakeHelper(log);
  const s = createSearchScheduler();
  const jobs = ['a', 'b', 'c'].map(n => s.submit(search(h, n, 3), BACKGROUND));
  assert.deepStrictEqual(await Promise.all(jobs.map(j => j.promise)), ['a', 'b', 'c']);
  assert.deepStrictEqual(log, ['a0', 'a1', 'a2', 'b0', 'b1', 'b2', 'c0', 'c1', 'c2']);
  assert.ok(s.idle);
});

test('an active search jumps ahead of queued AND running background searches', async () => {
  const log = [];
  const h = fakeHelper(log, 10);
  const s = createSearchScheduler();
  const bg = ['a', 'b'].map(n => s.submit(search(h, n, 4), BACKGROUND));
  await sleep(15); // a is mid-way through its engine calls
  const active = s.submit(search(h, 'X', 3), ACTIVE);
  assert.strictEqual(active.state, 'running', 'started immediately, not queued');
  await Promise.all([active.promise, ...bg.map(j => j.promise)]);
  const firstX = log.indexOf('X0');
  const lastX = log.indexOf('X2');
  // Only a's in-flight call(s) precede X; no background call interleaves with X.
  assert.ok(firstX >= 1 && firstX <= 2, log.join(' '));
  assert.deepStrictEqual(log.slice(firstX, lastX + 1), ['X0', 'X1', 'X2'], log.join(' '));
  assert.ok(log.indexOf('b0') > lastX, 'b never started before X finished');
  assert.ok(log.indexOf('a3') > lastX, 'a resumed only after X');
});

test('promoting a queued background job starts it now; demoting lets others through', async () => {
  const log = [];
  const h = fakeHelper(log, 10);
  const s = createSearchScheduler();
  const a = s.submit(search(h, 'a', 3), BACKGROUND);
  const b = s.submit(search(h, 'b', 3), BACKGROUND);
  const c = s.submit(search(h, 'c', 2), BACKGROUND);
  await sleep(5);
  assert.strictEqual(c.state, 'queued');
  s.setPriority(c, ACTIVE); // user switched to scramble c
  assert.strictEqual(c.state, 'running');
  await Promise.all([a.promise, b.promise, c.promise]);
  assert.ok(log.indexOf('c1') < log.indexOf('a2'), log.join(' '));
  assert.ok(log.indexOf('c1') < log.indexOf('b0'), log.join(' '));
  assert.strictEqual(log.length, 8);
});

test('a demoted active job no longer blocks background engine calls', async () => {
  const log = [];
  const h = fakeHelper(log, 5);
  const s = createSearchScheduler();
  const x = s.submit(search(h, 'X', 6), ACTIVE);
  await sleep(8);
  s.setPriority(x, BACKGROUND); // user switched away from X ...
  const y = s.submit(search(h, 'Y', 2), ACTIVE); // ... to Y
  await Promise.all([x.promise, y.promise]);
  assert.ok(log.indexOf('Y1') < log.indexOf('X5'), log.join(' '));
});

test('wrap gates only solve* methods, passes null helpers through, and propagates errors', async () => {
  const log = [];
  const h = fakeHelper(log);
  const s = createSearchScheduler();
  const job = s.submit(async wrap => {
    assert.strictEqual(wrap(null), null);
    const g = wrap(h);
    assert.strictEqual(g.notASolve(), 'fake');
    assert.strictEqual(g.name, 'fake');
    throw new Error('boom');
  }, ACTIVE);
  await assert.rejects(job.promise, /boom/);
  const next = s.submit(search(h, 'n', 1), BACKGROUND);
  assert.strictEqual(await next.promise, 'n', 'scheduler keeps going after a failed job');
});

test('many concurrent jobs never overlap engine calls', async () => {
  const log = [];
  const h = fakeHelper(log, 2);
  const s = createSearchScheduler();
  const jobs = [];
  for (let i = 0; i < 6; i++) jobs.push(s.submit(search(h, `j${i}-`, 4), i % 2 ? ACTIVE : BACKGROUND));
  await Promise.all(jobs.map(j => j.promise)); // fakeHelper throws on overlap
  assert.strictEqual(log.length, 24);
});

test('a helper array is a pool: up to one call per member at once, every member used, none overlapping', async () => {
  const logs = [[], [], []];
  const pool = logs.map(l => fakeHelper(l, 10));
  let inFlight = 0, maxInFlight = 0;
  pool.forEach(h => { const f = h.solveCross; h.solveCross = async (...a) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); try { return await f.apply(h, a); } finally { inFlight--; } }; });
  const s = createSearchScheduler();
  const job = s.submit(async wrap => {
    const g = wrap(pool);
    assert.strictEqual(g.__gated, true);
    return Promise.all(Array.from({ length: 9 }, (_, i) => g.solveCross(`c${i}`)));
  }, ACTIVE);
  const out = await job.promise; // fakeHelper throws if one member gets overlapping calls
  assert.deepStrictEqual(out.map(r => r[0]), Array.from({ length: 9 }, (_, i) => `c${i}`), 'results come back to the right caller');
  assert.ok(logs.every(l => l.length === 3), logs.map(l => l.length).join(','));
  assert.strictEqual(maxInFlight, 3, 'all three members busy at once');
});

test('with a pool, background calls still wait while an active search runs', async () => {
  const log = [];
  const pool = [fakeHelper(log, 10), fakeHelper(log, 10)];
  const s = createSearchScheduler();
  const bg = s.submit(search(pool, 'b', 4), BACKGROUND);
  await sleep(5);
  const act = s.submit(async wrap => {
    const g = wrap(pool);
    await Promise.all([g.solveCross('X0'), g.solveCross('X1')]);
    await sleep(15); // post-processing: background must stay paused
    await Promise.all([g.solveCross('X2'), g.solveCross('X3')]);
    return 'X';
  }, ACTIVE);
  await Promise.all([bg.promise, act.promise]);
  const first = log.indexOf('X0') < log.indexOf('X1') ? log.indexOf('X0') : log.indexOf('X1');
  const last = Math.max(log.indexOf('X2'), log.indexOf('X3'));
  assert.ok(log.slice(first, last + 1).every(t => t.startsWith('X')), log.join(' '));
});

test('look-ahead ranks: lowest rank first among waiting calls, unranked before ranked, ties FIFO', async () => {
  const log = [];
  const h = fakeHelper(log, 10);
  const s = createSearchScheduler();
  const job = s.submit(async (wrap) => {
    const gated = wrap(h);
    const first = gated.solveCross('busy'); // occupies the engine while the rest queue up
    const queued = [
      gated.withRank([2]).solveCross('r2'),
      gated.withRank([0, 1]).solveCross('r01'),
      gated.withRank([1]).solveCross('r1'),
      gated.withRank([0]).solveCross('r0a'),
      gated.solveCross('own'),
      gated.withRank([0]).solveCross('r0b'),
      gated.withRank([0, 0, 5]).solveCross('r005'),
    ];
    await Promise.all([first, ...queued]);
    return 'done';
  }, ACTIVE);
  await job.promise;
  assert.deepStrictEqual(log, ['busy', 'own', 'r0a', 'r0b', 'r005', 'r01', 'r1', 'r2']);
});

test('a stale job yields: its queued calls run after another active job\'s, then still run', async () => {
  const log = [];
  const h = fakeHelper(log, 10);
  const s = createSearchScheduler();
  // the old step queues all its calls at once (a split engine call)
  const old = s.submit(async (wrap) => {
    const g = wrap(h);
    return (await Promise.all([0, 1, 2, 3, 4].map(i => g.solveCross(`old${i}`)))).length;
  }, ACTIVE);
  await sleep(5); // old0 is running, old1..4 wait
  s.setStale(old);
  // the new step also starts its calls at once (searchCurrentNode)
  const next = s.submit(async (wrap) => {
    const g = wrap(h);
    await Promise.all([0, 1].map(i => g.solveCross(`new${i}`)));
    return 'new';
  }, ACTIVE);
  assert.strictEqual(await next.promise, 'new');
  assert.strictEqual(await old.promise, 5);
  assert.deepStrictEqual(log.slice(0, 3), ['old0', 'new0', 'new1'], log.join(' '));
  assert.deepStrictEqual(log.slice(3).sort(), ['old1', 'old2', 'old3', 'old4']);
});

test('compareSearchRanks orders look-ahead paths depth-first by candidate index', () => {
  const { compareSearchRanks } = require(path.join(__dirname, '..', 'js', 'search-scheduler.js'));
  const ranks = [[1], null, [0, 1], [0], [0, 0, 3], [], [2, 0]];
  assert.deepStrictEqual(ranks.slice().sort(compareSearchRanks), [null, [], [0], [0, 0, 3], [0, 1], [1], [2, 0]]);
});

(async () => {
  let failures = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS: ${t.name}`); } catch (e) { failures++; console.log(`FAIL: ${t.name}\n  ${e.stack}`); }
  }
  if (failures) { console.log(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log('\nAll search-scheduler tests passed.');
})();
