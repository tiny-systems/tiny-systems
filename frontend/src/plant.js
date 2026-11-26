// Plants: a helper's state, drawn. In the garden bed they grow straight
// from the soil; elsewhere (the logo, small places) they sit in a pot.
// Shapes are fixed strings, never data. Animation lives in style.css.

const LEAF = (x, y, flip, cls) => {
  const s = flip ? -1 : 1;
  return `<g class="${cls}" transform="translate(${x} ${y}) scale(${s} 1)">
    <path class="leaf" d="M0 0 C-4 -2 -11 -2 -16 -9 C-9 -12 -2 -8 0 0 Z"/>
    <path class="vein" d="M0 0 C-5 -3 -9 -5 -13 -8"/>
  </g>`;
};

const SHAPES = {
  seed: `
    <g class="sprout-up">
      <path class="stem" d="M40 64 C40 60 40 57 40 54"/>
      <ellipse class="seed" cx="40" cy="53" rx="5" ry="3.6"/>
      <path class="seed-crack" d="M37 52 C39 54 41 51 43 53"/>
    </g>`,
  grow: `
    <path class="stem" d="M40 64 C40 52 41 40 40 26"/>
    <g class="sway">
      ${LEAF(40, 46, false, 'l1')}
      ${LEAF(40, 38, true, 'l2')}
      ${LEAF(40, 30, false, 'l3')}
      <g class="tip"><path class="leaf hi" d="M40 27 C36 20 37 13 41 9 C45 14 45 21 40 27 Z"/></g>
    </g>`,
  ask: `
    <path class="stem" d="M40 64 C40 52 40 42 40 30"/>
    ${LEAF(40, 50, false, 'l1')}
    ${LEAF(40, 43, true, 'l2')}
    <g class="bud">
      <path class="bud-back" d="M40 31 C33 28 33 17 40 11 C47 17 47 28 40 31 Z"/>
      <path class="bud-front" d="M40 31 C36 27 36 19 40 14 C44 19 44 27 40 31 Z"/>
    </g>`,
  done: `
    <path class="stem" d="M40 64 C40 52 40 42 40 30"/>
    ${LEAF(40, 52, false, 'l1')}
    ${LEAF(40, 45, true, 'l2')}
    <g class="bloom">
      <circle class="petal" cx="40" cy="13" r="6"/><circle class="petal" cx="48.5" cy="19" r="6"/>
      <circle class="petal" cx="45.5" cy="28.5" r="6"/><circle class="petal" cx="34.5" cy="28.5" r="6"/>
      <circle class="petal" cx="31.5" cy="19" r="6"/><circle class="heart" cx="40" cy="21" r="4.6"/>
    </g>`,
  fail: `
    <path class="stem" d="M40 64 C40 54 42 46 48 40"/>
    <g class="droop">
      ${LEAF(43, 50, false, 'l1')}
      ${LEAF(47, 42, true, 'l2')}
      <path class="leaf" d="M48 40 C52 41 55 45 55 51 C51 49 48 45 48 40 Z"/>
    </g>`,
  rest: `
    <path class="stem" d="M40 64 C40 58 40 52 40 47"/>
    ${LEAF(40, 52, true, 'l1')}
    <path class="leaf" d="M40 47 C37 44 37 40 40 37 C43 40 43 44 40 47 Z"/>
    <g class="zz"><text x="50" y="34">z</text><text x="56" y="26">z</text></g>`,
};

const POT = `
  <path class="pot-rim" d="M23 62 H57 C58 62 58.5 62.5 58.5 63.5 V66 C58.5 67 58 67.5 57 67.5 H23 C22 67.5 21.5 67 21.5 66 V63.5 C21.5 62.5 22 62 23 62 Z"/>
  <path class="pot" d="M25 67.5 H55 L52.5 78 C52.2 79.3 51 80 49.7 80 H30.3 C29 80 27.8 79.3 27.5 78 Z"/>`;

export function plantKind(r) {
  if (r.question) return 'ask';
  if (r.paused) return 'rest';
  if (r.phase === 'Done') return 'done';
  if (r.phase === 'Failed' || r.phase === 'stuck') return 'fail';
  if (r.phase === 'Running') return 'grow';
  return 'seed';
}

export const STATE = {
  seed: 'Getting ready',
  grow: 'Working',
  ask: 'Needs you',
  done: 'Finished',
  fail: 'Stuck',
  rest: 'Resting',
};

// plant returns an <svg>. With pot, the plant sits in a pot (logo, small
// places); without, it grows from the bottom edge into the garden bed.
export function plant(kind, size = 96, { pot = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', pot ? '0 0 80 82' : '0 0 80 66');
  svg.setAttribute('width', size);
  svg.setAttribute('height', pot ? size * 82 / 80 : size * 66 / 80);
  svg.setAttribute('class', `plant plant-${kind}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', STATE[kind] || '');
  svg.innerHTML = (SHAPES[kind] || SHAPES.seed) + (pot ? POT : '');
  return svg;
}

// A friendly name for a helper, the same every time for the same id.
const NAMES = ['Basil', 'Fern', 'Mint', 'Sage', 'Clover', 'Thyme', 'Ivy', 'Moss', 'Juniper', 'Willow',
  'Hazel', 'Rosemary', 'Olive', 'Poppy', 'Linden', 'Sorrel', 'Yarrow', 'Laurel', 'Rowan', 'Aster'];

function hash(id) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h);
}

// Names already given out, so two helpers in a garden never share one.
const given = new Map();

// helperName gives a helper a friendly name, the same every time. A name
// already taken by another helper moves to the next free one (with a
// number once all are used).
export function helperName(id) {
  if (given.has(id)) return given.get(id);
  const taken = new Set(given.values());
  const start = hash(id) % NAMES.length;
  for (let round = 0; ; round++) {
    for (let i = 0; i < NAMES.length; i++) {
      const n = NAMES[(start + i) % NAMES.length] + (round ? ` ${round + 1}` : '');
      if (!taken.has(n)) { given.set(id, n); return n; }
    }
  }
}

// nameHelpers assigns names in a stable order (oldest id first), so the
// same garden always gets the same names.
export function nameHelpers(ids) {
  for (const id of [...ids].sort()) helperName(id);
}
