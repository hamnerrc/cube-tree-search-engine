/**
 * avatars.js — the solving buddy's sprites (README "Avatar").
 *
 * PLACEHOLDER ART: 16x16 one-bit sprites drawn in code, in the style of
 * UI_references/avatars_inspo.webp. To use real art, set AVATAR_SHEET to a
 * horizontal sprite sheet (one square cell per avatar, transparent
 * background, ink pixels white): drawAvatar then draws from it and tints it
 * with the theme's ink colour.
 *
 * Sprite rows: '#' ink, 'x' a cut-out (drawn in the background colour, e.g.
 * eyes), '.' transparent.
 */
'use strict';

const AVATAR_SHEET = null; // e.g. { url: 'img/avatars.png', cell: 16, names: ['ghost', ...] }

function cubeBuddyRows() {
  const rows = Array.from({ length: 16 }, () => Array(16).fill('.'));
  for (let r = 1; r <= 14; r++) {
    for (let c = 1; c <= 14; c++) rows[r][c] = (r === 5 || r === 10 || c === 5 || c === 10) ? 'x' : '#';
  }
  // a face on the centre sticker
  for (const [r, c] of [[7, 6], [7, 9], [8, 6], [8, 9]]) rows[r][c] = 'x';
  return rows.map(r => r.join(''));
}

const AVATAR_SPRITES = [
  { id: 'ghost', rows: [
    '................',
    '.....######.....',
    '...##########...',
    '..############..',
    '.##############.',
    '.###xx####xx###.',
    '.###xx####xx###.',
    '.##############.',
    '.######xx######.',
    '.#####x##x#####.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##.###..###.##.',
    '.#...##..##...#.',
    '................',
  ] },
  { id: 'cat', rows: [
    '................',
    '.##..........##.',
    '.###........###.',
    '.####......####.',
    '.##############.',
    '.##############.',
    '.###xx####xx###.',
    '.###xx####xx###.',
    '.##############.',
    '.######xx######.',
    '.####x#xx#x####.',
    '.##############.',
    '..############..',
    '...##########...',
    '....##....##....',
    '................',
  ] },
  { id: 'robot', rows: [
    '.......##.......',
    '.......##.......',
    '......####......',
    '..############..',
    '..#xxxxxxxxxx#..',
    '..#x##xxxx##x#..',
    '..#x##xxxx##x#..',
    '..#xxxxxxxxxx#..',
    '..#xxx####xxx#..',
    '..#xxxxxxxxxx#..',
    '..############..',
    '....########....',
    '..############..',
    '..##.######.##..',
    '..##.######.##..',
    '................',
  ] },
  { id: 'blob', rows: [
    '................',
    '.....######.....',
    '...##########...',
    '..############..',
    '.##############.',
    '.###xx####xx###.',
    '.###xx####xx###.',
    '.##############.',
    '.##############.',
    '.##x########x##.',
    '.###x######x###.',
    '.####xxxxxx####.',
    '..############..',
    '...##########...',
    '.....######.....',
    '................',
  ] },
  { id: 'frog', rows: [
    '................',
    '................',
    '..###......###..',
    '.##xx#....#xx##.',
    '.##xx######xx##.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.#x##########x#.',
    '.##xxxxxxxxxx##.',
    '..############..',
    '...##########...',
    '..###......###..',
    '.####......####.',
    '................',
    '................',
  ] },
  { id: 'cube', rows: cubeBuddyRows() },
];

const AVATAR_COUNT = () => (AVATAR_SHEET && AVATAR_SHEET.names ? AVATAR_SHEET.names.length : AVATAR_SPRITES.length);

let avatarSheetImage = null;
function loadAvatarSheet() {
  if (!AVATAR_SHEET || avatarSheetImage || typeof Image === 'undefined') return avatarSheetImage;
  avatarSheetImage = new Image();
  avatarSheetImage.src = AVATAR_SHEET.url;
  return avatarSheetImage;
}

/**
 * Draws avatar `index` into `canvas` (sized to a multiple of 16 by the
 * caller; drawn pixel-crisp), in `ink` with cut-outs in `paper`.
 */
function drawAvatar(canvas, index, ink, paper) {
  const ctx = canvas.getContext('2d');
  const n = AVATAR_COUNT();
  const i = ((Number(index) || 0) % n + n) % n;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img = loadAvatarSheet();
  if (img) {
    const draw = () => {
      const cell = AVATAR_SHEET.cell || 16;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, i * cell, 0, cell, cell, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = ink;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    };
    if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
    return;
  }
  const rows = AVATAR_SPRITES[i].rows;
  const px = canvas.width / 16;
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      ctx.fillStyle = ch === '#' ? ink : paper;
      ctx.fillRect(Math.round(c * px), Math.round(r * px), Math.ceil(px), Math.ceil(px));
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AVATAR_SPRITES, AVATAR_COUNT, drawAvatar };
}
