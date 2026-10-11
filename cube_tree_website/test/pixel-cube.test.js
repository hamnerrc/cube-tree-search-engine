#!/usr/bin/env node
/**
 * pixel-cube.js geometry vs facelet-cube.js (magiccube-verified): for every
 * move token (faces, primes, halves, wide, slices, rotations), turning the
 * stickers' 3D positions gives exactly MOVE_TABLE's permutation; 500 random
 * algs replayed through the geometry equal applyAlgorithm. The renderer
 * never decides the cube state, but its animations must turn the stickers
 * the state says.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { MOVE_TABLE, applyAlgorithm, SOLVED_FACELETS } = require(path.join(__dirname, '..', 'js', 'facelet-cube.js'));
const { geometryPerm, moveGeometry, PC_STICKERS, playbackTokens } = require(path.join(__dirname, '..', 'js', 'pixel-cube.js'));

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};

const BASES = 'U D R L F B M E S x y z u d r l f b'.split(' ');
const TOKENS = BASES.flatMap(b => [b, `${b}'`, `${b}2`]);

test('54 stickers on distinct positions, 9 per face, centres fixed', () => {
  assert.strictEqual(PC_STICKERS.length, 54);
  assert.strictEqual(new Set(PC_STICKERS.map(s => s.pos.join(','))).size, 54);
  for (let f = 0; f < 6; f++) assert.deepStrictEqual(PC_STICKERS[f * 9 + 4].cubie, PC_STICKERS[f * 9 + 4].n);
});

test('every token: geometry permutation === MOVE_TABLE', () => {
  for (const t of TOKENS) {
    assert.ok(MOVE_TABLE[t], `MOVE_TABLE has ${t}`);
    assert.deepStrictEqual(geometryPerm(t), MOVE_TABLE[t], t);
  }
});

test('500 random algs: geometry replay === applyAlgorithm', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let n = 0; n < 500; n++) {
    const alg = Array.from({ length: 1 + Math.floor(rnd() * 25) }, () => TOKENS[Math.floor(rnd() * TOKENS.length)]);
    let state = SOLVED_FACELETS;
    for (const t of alg) {
      const perm = geometryPerm(t);
      state = perm.map(j => state[j]).join('');
    }
    assert.strictEqual(state, applyAlgorithm(SOLVED_FACELETS, alg.join(' ')), alg.join(' '));
  }
});

test('half turns are two quarters; primes negate', () => {
  for (const b of BASES) {
    const q = moveGeometry(b).quarters;
    assert.strictEqual(moveGeometry(`${b}'`).quarters, -q, b);
    assert.strictEqual(Math.abs(moveGeometry(`${b}2`).quarters), 2, b);
  }
  assert.strictEqual(moveGeometry('Q'), null);
  assert.strictEqual(moveGeometry(''), null);
});

test('playbackTokens drops comments and non-moves', () => {
  assert.deepStrictEqual(playbackTokens("z2 y // inspection\nD' L D2 // cross\n\nR U R' foo"), ['z2', 'y', "D'", 'L', 'D2', 'R', 'U', "R'"]);
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('All pixel-cube tests passed.');
