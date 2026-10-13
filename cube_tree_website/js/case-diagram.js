/**
 * case-diagram.js -- pixel-art pictures of alg-set cases (README "Algorithm
 * sets"): a last-layer case as the classic top view (the U face and the
 * top row of each side), a last-slot case as a small 3D cube (pixel-cube.js)
 * so the slot shows. Stickers a set does not look at are grey
 * (AlgSets.maskedLabels). Colours: yellow on top, green in front, as the
 * cube sits after a white cross.
 */
'use strict';

const CaseDiagram = (() => {
  // face letter -> sticker colour key of pixel-cube.js (X: a sticker that does not matter)
  const COLOUR_OF_FACE = { U: 'Y', D: 'W', F: 'G', B: 'B', R: 'O', L: 'R', '.': 'X' };
  const HEX = {
    Y: '#ffd500', W: '#e9e9e4', G: '#17c84c', B: '#1e5bff', O: '#ff8a00', R: '#e8231c', X: '#5d5d5a',
  };
  const LIGHT = {
    Y: '#fff27a', W: '#ffffff', G: '#5cf58a', B: '#6f9bff', O: '#ffb45c', R: '#ff6a5c', X: '#7a7a76',
  };

  /** Face-letter facelets -> pixel-cube.js colour letters. */
  const toColours = labels => [...labels].map(c => COLOUR_OF_FACE[c] || 'X').join('');

  // The top view, in art pixels: stickers S wide, 1 apart; side strips T thick.
  const S = 6, G = 1, T = 2;
  const FACE = 3 * S + 2 * G;               // 20
  const SIZE = T + G + FACE + G + T + 2;    // 28 with a 1-pixel margin
  // facelet indices of the side strips, in drawing order (top view, F at the bottom)
  const STRIPS = {
    back: [47, 46, 45], front: [18, 19, 20], left: [36, 37, 38], right: [11, 10, 9],
  };

  /**
   * Draws the top view of `labels` (masked face letters) on `canvas` at art
   * resolution; CSS scales it (image-rendering: pixelated).
   */
  function topView(canvas, labels, opts = {}) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    const col = c => COLOUR_OF_FACE[c] || 'X';
    const fill = (key, x, y, w, h) => {
      ctx.fillStyle = HEX[key]; ctx.fillRect(x, y, w, h);
      if (w > 2 && h > 2) { ctx.fillStyle = LIGHT[key]; ctx.fillRect(x, y, w - 1, 1); ctx.fillRect(x, y, 1, h - 1); }
    };
    const x0 = 1 + T + G, y0 = 1 + T + G;
    if (opts.body) { ctx.fillStyle = opts.body; ctx.fillRect(x0 - 1, y0 - 1, FACE + 2, FACE + 2); }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      fill(col(labels[r * 3 + c]), x0 + c * (S + G), y0 + r * (S + G), S, S);
    }
    STRIPS.back.forEach((f, k) => fill(col(labels[f]), x0 + k * (S + G), 1, S, T));
    STRIPS.front.forEach((f, k) => fill(col(labels[f]), x0 + k * (S + G), y0 + FACE + G, S, T));
    STRIPS.left.forEach((f, k) => fill(col(labels[f]), 1, y0 + k * (S + G), T, S));
    STRIPS.right.forEach((f, k) => fill(col(labels[f]), x0 + FACE + G, y0 + k * (S + G), T, S));
  }

  // The 3D view: one hidden PixelCube renders every picture, copied out.
  let iso = null;
  function isoCube() {
    if (iso) return iso;
    const c = document.createElement('canvas');
    c.width = 170; c.height = 153;
    const cube = new PixelCube(c, { resolution: 'chunky', backFaces: false });
    cube.setTheme({ clear: true, floorShadow: false });
    iso = { canvas: c, cube };
    return iso;
  }
  /** Draws `labels` (masked face letters) as a small 3D cube, U, F and R showing. */
  function cubeView(canvas, labels, opts = {}) {
    const { canvas: src, cube } = isoCube();
    if (opts.line) cube.setTheme({ line: opts.line });
    cube.setFacelets(toColours(labels));
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0);
  }

  /** The picture of a case of a set: its stored state (face letters), masked. */
  function draw(canvas, setId, stateLabels, opts) {
    const labels = AlgSets.maskedLabels(setId, AlgSets.toCubie(stateLabels));
    if (AlgSets.SET_BY_ID[setId].slot) cubeView(canvas, labels, opts);
    else topView(canvas, labels, opts);
  }

  return { draw, topView, cubeView, toColours, COLOUR_OF_FACE, SIZE };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CaseDiagram };
}
