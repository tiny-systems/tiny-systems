// A potted seedling whose shape says what a session is doing. Pure SVG,
// animated with CSS (style.css, .plant-*). The pot and stem follow the
// website's sprout mark.

const POT = `
  <rect class="rim" x="8.5" y="18" width="15" height="3.2" rx="1.4"/>
  <path class="pot" d="M10.5 22 H21.5 L20.4 28.4 C20.3 29.1 19.6 29.5 19 29.5 H13 C12.4 29.5 11.7 29.1 11.6 28.4 Z"/>`;

const SHAPES = {
  // A seed cracking the soil.
  seed: `
    <g class="sprout-up"><path class="stem" d="M16 18 C16 16.8 16 16 16 15"/>
    <ellipse class="seed" cx="16" cy="14.6" rx="1.9" ry="1.4"/></g>`,
  // Two leaves, swaying.
  grow: `
    <path class="stem" d="M16 18 C16 14.5 16 12.5 16 9.5"/>
    <g class="sway">
      <path class="leaf-l" d="M16 11 C15 7.8 12.5 5.8 8.8 5.5 C9 9.5 11.5 11.6 16 11 Z"/>
      <path class="leaf-r" d="M16 11 C16.3 6.8 19 4.2 23.5 4 C23.3 8.9 20.5 11.4 16 11 Z"/>
    </g>`,
  // A closed bud waiting for a person.
  ask: `
    <path class="stem" d="M16 18 C16 14.5 16 12.5 16 9.5"/>
    <path class="leaf-l" d="M16 14 C15 11.6 13 10.2 10.2 10 C10.4 13 12.4 14.5 16 14 Z"/>
    <path class="leaf-r" d="M16 14 C17 11.6 19 10.2 21.8 10 C21.6 13 19.6 14.5 16 14 Z"/>
    <g class="bud"><path d="M16 9.6 C13.6 8.6 13.4 5.4 16 3.6 C18.6 5.4 18.4 8.6 16 9.6 Z"/></g>`,
  // In flower.
  done: `
    <path class="stem" d="M16 18 C16 14.5 16 12.5 16 9.5"/>
    <path class="leaf-l" d="M16 14 C15 11.6 13 10.2 10.2 10 C10.4 13 12.4 14.5 16 14 Z"/>
    <path class="leaf-r" d="M16 14 C17 11.6 19 10.2 21.8 10 C21.6 13 19.6 14.5 16 14 Z"/>
    <g class="bloom">
      <circle class="petal" cx="16" cy="3.9" r="2.3"/><circle class="petal" cx="19.2" cy="6.3" r="2.3"/>
      <circle class="petal" cx="18" cy="9.8" r="2.3"/><circle class="petal" cx="14" cy="9.8" r="2.3"/>
      <circle class="petal" cx="12.8" cy="6.3" r="2.3"/><circle class="heart" cx="16" cy="7" r="1.8"/>
    </g>`,
  // Wilted.
  fail: `
    <path class="stem" d="M16 18 C16 15 16.5 13 18.5 11.5"/>
    <path class="leaf-l" d="M17.4 12.6 C14.5 12.4 12.4 14 11.6 17 C14.6 16.9 16.6 15.4 17.4 12.6 Z"/>
    <path class="leaf-r" d="M18.5 11.5 C21.4 11 23.2 12.6 23.6 15.6 C20.7 15.8 19 14.2 18.5 11.5 Z"/>`,
  // Dormant: a stub and one folded leaf.
  rest: `
    <path class="stem" d="M16 18 C16 16 16 14.5 16 13"/>
    <path class="leaf-r" d="M16 14 C16.6 11.8 18.4 10.8 20.6 11 C20.2 13.4 18.4 14.4 16 14 Z"/>`,
};

export function plantKind(r) {
  if (r.question) return 'ask';
  if (r.paused) return 'rest';
  if (r.phase === 'Done') return 'done';
  if (r.phase === 'Failed' || r.phase === 'stuck') return 'fail';
  if (r.phase === 'Running') return 'grow';
  return 'seed';
}

export const PLANT_LABEL = {
  seed: 'starting', grow: 'working', ask: 'waiting for you', done: 'finished', fail: 'failed', rest: 'paused',
};

// plant returns an <svg> for a kind. Shapes are fixed strings, never data.
export function plant(kind, size = 30) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', `plant plant-${kind}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', PLANT_LABEL[kind]);
  svg.innerHTML = (SHAPES[kind] || SHAPES.seed) + POT;
  return svg;
}
