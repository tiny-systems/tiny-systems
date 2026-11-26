// State glyphs: small plant icons that say what a helper is doing. A
// leaf for working, an amber bud for "needs you", a flower for finished,
// a wilted leaf for stuck, a seed while starting, a folded leaf at rest.
// Shapes are fixed strings, never data.

const GLYPHS = {
  seed: '<ellipse cx="12" cy="14.5" rx="4.2" ry="3.2" class="g-seed"/><path d="M12 11.3 C12 9.5 13 8.2 14.6 7.6" class="g-stroke"/>',
  grow: '<path d="M12 20 V10.5" class="g-stroke"/><path d="M12 13.5 C8.5 13.6 6 11.4 5.6 7.6 C9.3 7.7 11.8 9.8 12 13.5 Z" class="g-leaf2"/><path d="M12 11 C12.2 7.2 14.8 4.6 18.6 4.4 C18.4 8.4 15.8 10.8 12 11 Z" class="g-leaf"/>',
  ask: '<path d="M12 20 V12" class="g-stroke"/><path d="M12 12.5 C8.6 11.8 8.4 6.6 12 3.8 C15.6 6.6 15.4 11.8 12 12.5 Z" class="g-bud"/>',
  done: '<path d="M12 20 V13" class="g-stroke"/><g class="g-petals"><circle cx="12" cy="5.6" r="2.7"/><circle cx="15.8" cy="8.4" r="2.7"/><circle cx="14.4" cy="12.6" r="2.7"/><circle cx="9.6" cy="12.6" r="2.7"/><circle cx="8.2" cy="8.4" r="2.7"/></g><circle cx="12" cy="9.4" r="2" class="g-heart"/>',
  fail: '<path d="M12 20 C12 15 13 12.5 16 11" class="g-stroke g-dry"/><path d="M15.5 11.3 C18.8 11 20.6 13.4 20.4 17 C17.2 16.8 15.6 14.6 15.5 11.3 Z" class="g-dryleaf"/><path d="M13 14.6 C10 13.8 7.6 15.4 6.8 18.6 C9.8 19 12 17.4 13 14.6 Z" class="g-dryleaf"/>',
  rest: '<path d="M12 20 V13" class="g-stroke g-rest"/><path d="M12 13.4 C9.6 12.4 9.4 8.8 12 6.6 C14.6 8.8 14.4 12.4 12 13.4 Z" class="g-restleaf"/>',
};

export function plantKind(r) {
  if (r.question) return 'ask';
  if (r.paused) return 'rest';
  if (r.phase === 'Done') return 'done';
  if (r.phase === 'Failed' || r.phase === 'stuck') return 'fail';
  if (r.phase === 'Running') return 'grow';
  return 'seed';
}

export const STATE = {
  seed: 'Starting', grow: 'Working', ask: 'Needs you', done: 'Finished', fail: 'Stuck', rest: 'Resting',
};

// glyph returns a small state icon, optionally inside a tinted tile.
export function glyph(kind, size = 20, { tile = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `glyph glyph-${kind}`);
  svg.innerHTML = GLYPHS[kind] || GLYPHS.seed;
  if (!tile) return svg;
  const t = document.createElement('span');
  t.className = `tile tile-${kind}`;
  t.append(svg);
  return t;
}

// The brand mark: a two-leaf sprout.
export function mark(size = 22) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'mark');
  svg.innerHTML = GLYPHS.grow;
  return svg;
}

const NAMES = ['Basil', 'Fern', 'Mint', 'Sage', 'Clover', 'Thyme', 'Ivy', 'Moss', 'Juniper', 'Willow',
  'Hazel', 'Rosemary', 'Olive', 'Poppy', 'Linden', 'Sorrel', 'Yarrow', 'Laurel', 'Rowan', 'Aster'];

function hash(id) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h);
}

const given = new Map();

// helperName gives a helper a friendly plant name, the same every time and
// unique among the helpers seen so far.
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

export function nameHelpers(ids) {
  for (const id of [...ids].sort()) helperName(id);
}
