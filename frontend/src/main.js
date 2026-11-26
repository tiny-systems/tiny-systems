import './style.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as App from '../wailsjs/go/main/App.js';
import { EventsOn, EventsOff, BrowserOpenURL } from '../wailsjs/runtime/runtime.js';
import { plant, plantKind, STATE, helperName, nameHelpers } from './plant.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const REFRESH_MS = 2500;

const state = {
  targets: [],
  current: null,
  summaries: {},   // garden key -> {needsYou, running, error, total}
  fleet: null,
  selected: null,  // helper (session) name shown in the sheet
  kinds: {},       // helper -> last plant kind, to animate changes
  sent: {},        // question name -> what was sent
  drafts: {},      // question name -> typed reply
  terms: [],
  activeTerm: null,
};

const keyOf = (t) => `${t.context}/${t.namespace}`;
const plantEls = new Map(); // helper -> its element in the bed, kept across refreshes
const cur = () => state.targets[state.current];
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const gardenName = (t) => title(t.name);

function toast(text, bad = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2600);
}

async function act(done, fn) {
  try {
    await fn();
    if (done) toast(done);
    refresh();
  } catch (e) {
    toast(friendlyError(e), true);
  }
}

// Errors from the cluster are written for operators; say what it means.
function friendlyError(e) {
  const s = String(e);
  if (/connection refused|no such host|i\/o timeout|dial tcp/i.test(s)) return 'This garden can’t be reached right now.';
  if (/forbidden/i.test(s)) return 'You don’t have permission to do that in this garden.';
  return s.replace(/^Error: /, '');
}

/* Gardens in the sidebar */

function renderRail() {
  $('#gardens').replaceChildren(...state.targets.map((t, i) => {
    const s = state.summaries[keyOf(t)] || {};
    const b = el('button', 'garden');
    b.setAttribute('aria-current', String(i === state.current));
    const dot = el('span', 'dot');
    let label = '';
    let cls = '';
    if (s.error) { label = 'asleep'; cls = 'asleep'; }
    else if (s.needsYou) { label = `${s.needsYou} need${s.needsYou === 1 ? 's' : ''} you`; cls = 'needs'; }
    else if (s.total != null) { label = s.total ? `${s.total} helper${s.total === 1 ? '' : 's'}` : 'empty'; }
    if (cls) dot.classList.add(cls);
    b.append(dot, el('span', 'gname', gardenName(t)), el('span', `gstate ${cls}`, label));
    b.onclick = () => selectTarget(i);
    return b;
  }));
}

function selectTarget(i) {
  plantEls.clear();
  $('#beds').replaceChildren();
  state.current = i;
  state.selected = null;
  state.fleet = null;
  renderRail();
  renderGarden();
  renderSheet();
  refresh();
}

/* The garden bed */

function summaryLine(f) {
  if (!f) return document.createTextNode('');
  if (f.error) return document.createTextNode('This garden is asleep or out of reach.');
  const rows = f.rows || [];
  if (!rows.length) return document.createTextNode('No helpers yet.');
  const working = rows.filter((r) => plantKind(r) === 'grow').length;
  const p = document.createDocumentFragment();
  const parts = [];
  if (working) parts.push(`${working} working`);
  const resting = rows.filter((r) => plantKind(r) === 'rest').length;
  if (resting) parts.push(`${resting} resting`);
  const finished = rows.filter((r) => plantKind(r) === 'done').length;
  if (finished) parts.push(`${finished} finished`);
  const starting = rows.filter((r) => plantKind(r) === 'seed').length;
  if (starting) parts.push(`${starting} getting ready`);
  const stuck = rows.filter((r) => plantKind(r) === 'fail').length;
  if (stuck) parts.push(`${stuck} stuck`);
  p.append(`${rows.length} helper${rows.length === 1 ? '' : 's'}${parts.length ? ': ' + parts.join(', ') : ''}.`);
  if (f.needsYou) {
    p.append(' ');
    p.append(el('b', '', `${f.needsYou} need${f.needsYou === 1 ? 's' : ''} you.`));
  }
  return p;
}

function renderGarden() {
  const t = cur();
  $('#garden-name').textContent = t ? gardenName(t) : 'No gardens yet';
  const f = state.fleet;
  $('#garden-summary').replaceChildren(summaryLine(f));
  const rows = (f && !f.error && f.rows) || [];
  const empty = !!(f && !f.error && rows.length === 0);
  $('#empty').hidden = !empty;
  $('#beds').hidden = empty || !!(f && f.error);
  if (empty && !$('#empty-art').firstChild) $('#empty-art').append(plant('seed', 120, { pot: true }));

  nameHelpers(rows.map((r) => r.name));
  // Plants are kept between refreshes and only redrawn when their state
  // changes, so animations run on instead of restarting every few seconds.
  const plants = rows.map((r) => {
    const kind = plantKind(r);
    let b = plantEls.get(r.name);
    if (!b || b.dataset.kind !== kind) {
      const changed = !!b;
      b = el('button', 'helper');
      b.dataset.kind = kind;
      const art = el('div', 'art');
      const svg = plant(kind, 148);
      if (changed) svg.classList.add('fresh');
      art.append(svg);
      if (kind === 'ask') b.append(el('span', 'bubble', 'Needs you'));
      b.append(art, el('span', 'stake', helperName(r.name)));
      b.onclick = () => { state.selected = r.name; renderGarden(); renderSheet(); };
      plantEls.set(r.name, b);
    }
    b.setAttribute('aria-pressed', String(r.name === state.selected));
    b.setAttribute('aria-label', `${helperName(r.name)}: ${STATE[kind]}`);
    return b;
  });
  for (const name of [...plantEls.keys()]) if (!rows.some((r) => r.name === name)) plantEls.delete(name);
  // One planter per row: plants never float above a row without soil.
  const width = $('.greenhouse').clientWidth - 80;
  const perRow = Math.max(1, Math.floor((Math.min(width, 1100) - 68 + 18) / (150 + 18)));
  const box = $('#beds');
  const rowsNeeded = Math.ceil(plants.length / perRow);
  while (box.children.length > rowsNeeded) box.lastElementChild.remove();
  while (box.children.length < rowsNeeded) {
    const wrap = el('div', 'bed-wrap');
    wrap.append(el('div', 'bed'), el('div', 'soil'));
    box.append(wrap);
  }
  // Move plants into place without detaching ones already there.
  [...box.children].forEach((wrap, i) => {
    const bed = wrap.firstElementChild;
    const want = plants.slice(i * perRow, (i + 1) * perRow);
    want.forEach((p, j) => { if (bed.children[j] !== p) bed.insertBefore(p, bed.children[j] || null); });
    while (bed.children.length > want.length) bed.lastElementChild.remove();
  });
}

/* The helper sheet */

function selectedRow() {
  return (state.fleet?.rows || []).find((r) => r.name === state.selected);
}

function renderSheet() {
  const sheet = $('#sheet');
  const r = selectedRow();
  if (!r) { sheet.hidden = true; return; }
  // Keep a reply being typed alive across refreshes.
  if (!sheet.hidden && sheet.dataset.name === r.name && document.activeElement?.closest('#sheet .reply')) return;
  sheet.hidden = false;
  sheet.dataset.name = r.name;
  const kind = plantKind(r);
  const t = cur();

  const top = el('div', 'sheet-top');
  const close = el('button', 'btn quiet small', 'Close');
  close.onclick = () => { state.selected = null; renderGarden(); renderSheet(); };
  top.append(close);

  const hero = el('div', 'hero');
  hero.append(plant(kind, 132, { pot: true }), el('h2', '', helperName(r.name)), el('div', `state ${kind}`, STATE[kind]));

  const blocks = [];
  const doing = el('div', 'block');
  doing.append(el('h3', '', kind === 'done' ? 'What it did' : 'What it’s doing'));
  doing.append(el('div', 'doing', r.title || r.task || 'Waiting for something to do.'));
  if (r.activity && kind === 'grow') doing.append(el('div', 'latest', r.activity));
  blocks.push(doing);

  if (r.message && (kind === 'fail' || kind === 'seed')) {
    const b = el('div', 'block');
    b.append(el('div', 'problem', r.message));
    blocks.push(b);
  }
  if (r.question) {
    const b = el('div', 'block');
    b.append(replyBox(t, r.question));
    blocks.push(b);
  }

  const acts = el('div', 'acts');
  const btn = (label, cls, fn) => { const b = el('button', `btn small ${cls}`, label); b.onclick = fn; acts.append(b); };
  if (r.attachable) btn('Watch it work', 'primary', () => openTerminal(r.name));
  if (!r.command) {
    if (r.paused) btn('Wake it up', '', () => act(`${helperName(r.name)} is waking up`, () => App.Resume(t, r.name)));
    else if (kind !== 'done') btn('Let it rest', '', () => act(`${helperName(r.name)} is resting`, () => App.Pause(t, r.name)));
  }
  btn('Send home', 'danger', () => confirmSendHome(r));

  const details = el('details', 'details');
  details.append(el('summary', '', 'Details'));
  const dl = el('dl');
  const add = (k, v) => { if (v) { dl.append(el('dt', '', k), el('dd', '', v)); } };
  add('Session', r.name);
  add('State', r.phase + (r.paused ? ' (paused)' : ''));
  add('Task', r.task);
  add('Planted', `${r.age} ago`);
  add('CPU', r.cpu);
  add('Memory', r.mem);
  if (r.exit != null) add('Exit code', String(r.exit));
  details.append(dl);

  sheet.replaceChildren(top, hero, ...blocks, acts, details);
}

function replyBox(t, q) {
  const box = el('div', 'reply');
  if (state.sent[q.name]) {
    box.classList.add('sent');
    box.append(el('div', 'q', `Sent: “${state.sent[q.name]}”`));
    return box;
  }
  box.append(el('div', 'q', q.idle ? 'Your helper is waiting for you.' : q.text));
  const send = async (answer) => {
    try {
      await App.Answer(t, q, answer);
      state.sent[q.name] = answer;
      delete state.drafts[q.name];
      box.replaceChildren(el('div', 'q', `Sent: “${answer}”`));
      box.classList.add('sent');
      refresh();
    } catch (e) {
      toast(friendlyError(e), true);
    }
  };
  const opts = el('div', 'opts');
  if ((q.options || []).length) {
    for (const o of q.options) {
      const b = el('button', 'btn small', o);
      b.onclick = () => send(o);
      opts.append(b);
    }
    box.append(opts);
    return box;
  }
  const ta = el('textarea');
  ta.placeholder = q.idle ? 'Tell it what to do next' : 'Your answer';
  ta.value = state.drafts[q.name] || '';
  ta.oninput = () => { state.drafts[q.name] = ta.value; };
  const go = el('button', 'btn small primary', 'Send');
  const submit = () => {
    const v = ta.value.trim();
    if (!v) return;
    go.disabled = true;
    send(v).finally(() => { go.disabled = false; });
  };
  go.onclick = submit;
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); };
  opts.append(go);
  box.append(ta, opts);
  return box;
}

function confirmSendHome(r) {
  const d = $('#confirm-dialog');
  $('#confirm-title').textContent = `Send ${helperName(r.name)} home?`;
  $('#confirm-body').textContent = 'It stops working, and its files and conversation are deleted. This can’t be undone.';
  d.returnValue = '';
  d.showModal();
  d.onclose = () => {
    if (d.returnValue !== 'ok') return;
    state.selected = null;
    act(`${helperName(r.name)} went home`, () => App.Delete(cur(), r.name));
  };
}

/* Refresh */

async function refresh() {
  const targets = state.targets;
  if (!targets.length) { renderGarden(); return; }
  await Promise.all(targets.map(async (t, i) => {
    const f = await App.Fleet(t);
    state.summaries[keyOf(t)] = { needsYou: f.needsYou, running: f.running, error: f.error, total: (f.rows || []).length };
    if (i === state.current) state.fleet = f;
  }));
  renderRail();
  renderGarden();
  renderSheet();
  notifyChanges();
  loadHealth();
}

/* New helper */

function openNew() {
  $('#new-form').reset();
  $('#new-dialog').showModal();
}
$('#new-btn').onclick = openNew;
$('#empty-new').onclick = openNew;
$('#new-cancel').onclick = () => $('#new-dialog').close();
$('#new-form').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  $('#new-dialog').close();
  try {
    const name = await App.NewSession(cur(), data);
    state.selected = name;
    toast(`${helperName(name)} is planted`);
    refresh();
    if (!data.task.trim()) waitThenWatch(name);
  } catch (err) {
    toast(friendlyError(err), true);
  }
};

async function waitThenWatch(name) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((state.fleet?.rows || []).find((r) => r.name === name)?.attachable) { openTerminal(name); return; }
  }
}

/* Watching a helper work: its real terminal */

const enc = new TextEncoder();
const toB64 = (s) => { let b = ''; for (const c of enc.encode(s)) b += String.fromCharCode(c); return btoa(b); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const termTheme = {
  background: '#15231A', foreground: '#E4F2E6', cursor: '#7EE08E', selectionBackground: '#2E4A36',
  black: '#1E3A28', red: '#E8907F', green: '#7EE08E', yellow: '#F2C66B', blue: '#8DB8DA',
  magenta: '#E7A1C0', cyan: '#86CFC4', white: '#E4F2E6',
  brightBlack: '#6E8574', brightRed: '#F2A99B', brightGreen: '#A6EDB0', brightYellow: '#F7D88F',
  brightBlue: '#AFCFE8', brightMagenta: '#F0BCD3', brightCyan: '#A8DED6', brightWhite: '#F7FBF6',
};

async function openTerminal(session) {
  const t = cur();
  const existing = state.terms.find((x) => x.session === session && x.key === keyOf(t) && !x.closed);
  if (existing) { activate(existing); return; }
  const host = el('div', 'term');
  $('#term-host').append(host);
  const term = new Terminal({
    fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.15,
    cursorBlink: true, allowProposedApi: true, theme: termTheme, scrollback: 0,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  $('#watch').hidden = false;
  fit.fit();
  const entry = { id: null, session, key: keyOf(t), term, fit, el: host, closed: false };
  state.terms.push(entry);
  activate(entry);
  term.write(`\x1b[2mconnecting to ${helperName(session)}…\x1b[0m\r\n`);
  try {
    entry.id = await App.OpenTerminal(t, session, term.cols, term.rows);
  } catch (e) {
    term.write(`\r\n\x1b[31m${friendlyError(e)}\x1b[0m\r\n`);
    entry.closed = true;
    renderTabs();
    return;
  }
  EventsOn(`term:${entry.id}`, (b64) => term.write(fromB64(b64)));
  EventsOn(`term-closed:${entry.id}`, (reason) => {
    entry.closed = true;
    term.write(`\r\n\x1b[2m[stopped watching${reason ? `: ${reason}` : ''}]\x1b[0m\r\n`);
    EventsOff(`term:${entry.id}`, `term-closed:${entry.id}`);
    renderTabs();
  });
  term.onData((d) => { if (!entry.closed) App.TermInput(entry.id, toB64(d)); });
  term.onResize(({ cols, rows }) => { if (!entry.closed) App.TermResize(entry.id, cols, rows); });
  renderTabs();
}

function activate(entry) {
  state.activeTerm = entry;
  for (const x of state.terms) x.el.hidden = x !== entry;
  renderTabs();
  requestAnimationFrame(() => { entry.fit.fit(); entry.term.focus(); });
}

function closeTerm(entry) {
  if (entry.id && !entry.closed) App.CloseTerminal(entry.id);
  entry.term.dispose();
  entry.el.remove();
  state.terms = state.terms.filter((x) => x !== entry);
  if (state.activeTerm === entry) state.activeTerm = null;
  if (state.terms.length) activate(state.terms[state.terms.length - 1]);
  else $('#watch').hidden = true;
  renderTabs();
}

function renderTabs() {
  $('#tabs').replaceChildren(...state.terms.map((x) => {
    const b = el('div', 'tab' + (x.closed ? ' closed' : ''), helperName(x.session));
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(x === state.activeTerm));
    b.tabIndex = 0;
    const close = el('button', 'x', '×');
    close.title = 'Stop watching (the helper keeps working)';
    close.onclick = (e) => { e.stopPropagation(); closeTerm(x); };
    b.append(close);
    b.onclick = () => activate(x);
    return b;
  }));
}

$('#watch-close').onclick = () => { for (const x of [...state.terms]) closeTerm(x); };
new ResizeObserver(() => { if (state.activeTerm) state.activeTerm.fit.fit(); }).observe($('#term-host'));
let lastWidth = 0;
new ResizeObserver(() => {
  const w = $('.greenhouse').clientWidth;
  if (Math.abs(w - lastWidth) > 40) { lastWidth = w; renderGarden(); }
}).observe($('.greenhouse'));

/* Health notices: what quietly breaks a garden, with the fix beside it */

const healthCache = {};

async function loadHealth(force = false) {
  const t = cur();
  if (!t) return;
  const key = keyOf(t);
  const c = healthCache[key];
  if (!force && c && Date.now() - c.at < 30000) { renderNotices(c.h); return; }
  let h = null;
  try { h = await App.Health(t); } catch { /* unreachable: shown by the summary */ }
  healthCache[key] = { h, at: Date.now() };
  if (keyOf(cur()) === key) renderNotices(h);
}

function notice(level, head, body, ...controls) {
  const n = el('div', `notice ${level}`);
  const txt = el('div', 'ntext');
  txt.append(el('b', '', head));
  if (body) txt.append(body);
  n.append(txt, ...controls);
  return n;
}

function smallButton(label, fn) {
  const b = el('button', 'btn small', label);
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { toast(friendlyError(e), true); }
    b.disabled = false;
  };
  return b;
}

async function renderNotices(h) {
  const t = cur();
  const out = [];
  if (state.fleet?.error) {
    const st = await App.Local();
    const vm = (st.vms || []).find((v) => v.name === t.name || v.name === t.context);
    if (vm && vm.status !== 'Running') {
      out.push(notice('', `${gardenName(t)} is asleep`, 'It lives on this Mac and stops when the Mac restarts.',
        smallButton('Wake it', async () => { toast('Waking the garden…'); await App.StartVM(vm.name); toast(`${gardenName(t)} is awake`); refresh(); })));
    } else {
      out.push(notice('', `${gardenName(t)} can’t be reached`, 'Check that the computer it lives on is on and connected.'));
    }
  }
  if (h) {
    for (const n of h.nodes || []) {
      if (n.diskPressure) out.push(notice('bad', 'This garden is out of space', 'New helpers can’t start until some disk space is freed on its computer.'));
      else if (n.diskTotalGB > 0 && n.diskFreeGB / n.diskTotalGB < 0.2) out.push(notice('', 'Space is running low', `${n.diskFreeGB.toFixed(0)} GB left of ${n.diskTotalGB.toFixed(0)} GB. Helpers stop starting when it gets very full.`));
      if (n.memoryPressure) out.push(notice('', 'This garden is short of memory', 'Helpers may slow down. Letting some rest frees memory.'));
    }
    if ((h.runtimeMissing || []).length) {
      out.push(notice('', 'An update is ready for this garden', 'Newer helpers need it to work properly.',
        smallButton('Update', async () => { await App.UpgradeRuntime(t); toast('Garden updated'); loadHealth(true); })));
    }
    if (h.signIn === 'none') {
      const others = state.targets.filter((x) => keyOf(x) !== keyOf(t));
      const sel = el('select');
      for (const o of others) sel.append(new Option(`from ${gardenName(o)}`, keyOf(o)));
      const controls = others.length ? [sel, smallButton('Copy sign-in', async () => {
        const from = others.find((o) => keyOf(o) === sel.value);
        await App.CopyCredentials(from, t);
        toast(`Sign-in copied from ${gardenName(from)}`);
        loadHealth(true);
      })] : [];
      out.push(notice('', 'Helpers can’t sign in here yet', others.length ? 'Copy the sign-in from another garden.' : 'Sign in with `tiny setup` in the terminal.', ...controls));
    }
  }
  $('#notices').replaceChildren(...out);
}

/* Notifications */

const lastNeeds = {};
function notifyChanges() {
  for (const t of state.targets) {
    const k = keyOf(t);
    const now = state.summaries[k]?.needsYou ?? 0;
    if (lastNeeds[k] !== undefined && now > lastNeeds[k]) {
      App.Notify('Tiny Systems', `A helper in ${gardenName(t)} needs you`);
    }
    lastNeeds[k] = now;
  }
  const waiting = Object.values(state.summaries).reduce((n, s) => n + (s.needsYou || 0), 0);
  document.title = waiting ? `Tiny Systems (${waiting})` : 'Tiny Systems';
}

/* Planting a garden: a short guided flow */

const wz = { req: null, events: [] };

function wizard(...children) {
  $('#wz').replaceChildren(...children);
  if (!$('#wizard').open) $('#wizard').showModal();
}

function actions(...buttons) {
  const a = el('div', 'actions');
  a.append(...buttons);
  return a;
}

function wbtn(label, cls, fn) {
  const b = el('button', `btn ${cls}`, label);
  b.type = 'button';
  b.onclick = fn;
  return b;
}

function field(label, name, attrs = {}, opt) {
  const l = el('label', 'field');
  l.append(label);
  if (opt) l.append(' ', el('span', 'opt', opt));
  const i = el('input');
  i.name = name;
  Object.assign(i, attrs);
  l.append(i);
  return l;
}

function stepWhere() {
  const places = el('div', 'places');
  const mac = el('button', 'place');
  mac.type = 'button';
  mac.append(plant('grow', 64, { pot: true }), el('b', '', 'On this Mac'), el('span', '', 'Quickest to start. Helpers work while your Mac is awake.'));
  mac.onclick = () => stepDetails('mac');
  const other = el('button', 'place');
  other.type = 'button';
  other.append(plant('done', 64, { pot: true }), el('b', '', 'On another computer'), el('span', '', 'A spare computer at home or in the office that stays on. Helpers keep working while you’re away.'));
  other.onclick = () => stepDetails('remote');
  places.append(mac, other);
  wizard(el('h2', '', 'Plant a new garden'), el('p', 'lead', 'Where should your helpers live?'), places,
    actions(wbtn('Cancel', 'quiet', () => $('#wizard').close())));
}

function stepDetails(where) {
  const form = el('form');
  form.style.cssText = 'padding:0;display:flex;flex-direction:column;gap:16px';
  form.append(field('Name your garden', 'name', { required: true, placeholder: where === 'mac' ? 'my-mac' : 'office', pattern: '[a-z0-9]([-a-z0-9]*[a-z0-9])?', title: 'lowercase letters, numbers and dashes' }));
  if (where === 'remote') {
    form.append(el('p', 'hint', 'Tiny Systems connects to the computer with SSH, using the keys already on this Mac.'));
    const row = el('div', 'row2');
    row.append(field('Computer’s address', 'host', { required: true, placeholder: '192.168.1.20' }), field('User name on it', 'user', { required: true, placeholder: 'ubuntu' }));
    form.append(row);
  }
  const creds = el('label', 'field');
  creds.append('How should helpers sign in?');
  const sel = el('select');
  sel.name = 'copyFrom';
  for (const [i, t] of state.targets.entries()) sel.append(new Option(`The same way as ${gardenName(t)}`, String(i)));
  sel.append(new Option('I’ll set it up later', ''));
  if (state.targets.length) sel.value = String(state.current ?? 0);
  creds.append(sel);
  form.append(creds);

  const adv = el('details', 'advanced');
  adv.append(el('summary', '', 'Advanced'));
  const safety = el('label', 'check');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.name = 'gvisor';
  cb.checked = true;
  safety.append(cb, 'Extra safety (recommended). Helpers run in a sealed box, so even a misbehaving one can’t reach the rest of the computer.');
  adv.append(safety);
  if (where === 'mac') {
    const r = el('div', 'row3');
    r.append(field('Processors', 'cpus', { type: 'number', value: '2', min: '1', max: '16' }),
      field('Memory (GB)', 'memoryGB', { type: 'number', value: '4', min: '2', max: '64' }),
      field('Disk (GB)', 'diskGB', { type: 'number', value: '40', min: '20', max: '500' }));
    adv.append(r);
  } else {
    const r = el('div', 'row2');
    r.append(field('SSH port', 'port', { type: 'number', value: '22', min: '1', max: '65535' }),
      field('Key file', 'keyFile', { placeholder: '~/.ssh/id_ed25519' }, 'optional'));
    adv.append(r, field('Password for sudo', 'sudoPassword', { type: 'password', autocomplete: 'off', placeholder: 'only if it asks; never stored' }, 'optional'));
  }
  adv.append(field('Namespace', 'namespace', { placeholder: 'tiny' }, 'optional'));
  form.append(adv);

  const plantBtn = el('button', 'btn primary', 'Plant garden');
  plantBtn.type = 'submit';
  form.append(actions(wbtn('Back', 'quiet', stepWhere), plantBtn));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const copyFrom = d.copyFrom === '' ? null : state.targets[Number(d.copyFrom)];
    if (where === 'mac') {
      const st = await App.Local();
      if (!st.lima) { toast('One more thing first: install Lima with `brew install lima`, then try again.', true); return; }
      startGrowing({ local: true, name: d.name.trim(), gvisor: !!d.gvisor, cpus: Number(d.cpus), memoryGB: Number(d.memoryGB), diskGB: Number(d.diskGB), copyFrom });
    } else {
      startGrowing({ name: d.name.trim(), host: d.host.trim(), user: d.user.trim(), port: Number(d.port) || 22,
        keyFile: (d.keyFile || '').trim(), sudoPassword: d.sudoPassword || '', namespace: (d.namespace || '').trim() || 'tiny',
        gvisor: !!d.gvisor, trustFingerprint: '', copyFrom });
    }
  };
  wizard(el('h2', '', where === 'mac' ? 'A garden on this Mac' : 'A garden on another computer'), form);
}

const GROW_STEPS = [
  ['vm', 'Making room on this Mac'],
  ['connect', 'Saying hello to the computer'],
  ['preflight', 'Checking there’s enough space'],
  ['k3s', 'Preparing the soil'],
  ['gvisor', 'Building the safety box'],
  ['kubeconfig', 'Remembering the way there'],
  ['runtime', 'Setting up the garden'],
  ['credentials', 'Teaching helpers to sign in'],
];

function startGrowing(req) {
  wz.req = req;
  const steps = GROW_STEPS.filter(([id]) => (id !== 'gvisor' || req.gvisor) && (id !== 'vm' || req.local));
  const list = el('div', 'growing');
  list.id = 'growing';
  for (const [id, label] of steps) {
    const s = el('div', 'gstep');
    s.dataset.step = id;
    const txt = el('div');
    txt.append(label, el('span', 'gdetail'));
    s.append(plant('seed', 34), txt);
    list.append(s);
  }
  const log = el('details', 'techlog');
  log.append(el('summary', '', 'Show details'), el('pre'));
  log.querySelector('pre').id = 'grow-log';
  const trust = el('div', 'trust');
  trust.id = 'trust';
  trust.hidden = true;
  const closeBtn = wbtn('Close', 'quiet', () => $('#wizard').close());
  closeBtn.id = 'grow-close';
  closeBtn.disabled = true;
  const head = el('h2', '', `Planting ${title(req.name)}`);
  head.id = 'grow-title';
  wizard(head, el('p', 'lead', req.local ? 'This takes a few minutes the first time.' : 'This takes a few minutes. You can keep using the app.'), list, trust, log, actions(closeBtn));
  const run = req.local
    ? App.InstallLocal({ name: req.name, cpus: req.cpus, memoryGB: req.memoryGB, diskGB: req.diskGB, gvisor: req.gvisor, copyFrom: req.copyFrom })
    : App.Install(req);
  run.catch((e) => growFinished(false, friendlyError(e)));
}

function markStep(s, cls, detail) {
  s.className = `gstep ${cls}`;
  const kind = { active: 'grow', ok: 'done', warn: 'ask', error: 'fail' }[cls] || 'seed';
  s.firstChild.replaceWith(plant(kind, 34));
  if (detail != null) s.querySelector('.gdetail').textContent = detail;
}

function growFinished(ok, text) {
  $('#grow-close').disabled = false;
  $('#grow-title').textContent = ok ? `${title(wz.req.name)} is ready` : 'Planting stopped';
  if (!ok) {
    const s = document.querySelector('#growing .gstep.active') || document.querySelector('#growing .gstep:not(.ok):not(.warn)');
    if (s) markStep(s, 'error', text);
  }
}

// Plain-language detail for a step, instead of the installer's own words.
function stepDetail(e) {
  if (e.level === 'warn') return e.text.replace(/`[^`]*`/g, (m) => m.slice(1, -1));
  if (e.level === 'ok' && e.step === 'gvisor') return 'Helpers here run sealed off from the computer.';
  if (e.level === 'ok' && e.step === 'preflight') return e.text.split(',').slice(0, 2).join(',');
  return '';
}

EventsOn('install:event', (e) => {
  const log = $('#grow-log');
  if (log) { log.textContent += (e.level === 'log' ? '  ' : '• ') + e.text + '\n'; log.scrollTop = log.scrollHeight; }
  if (!$('#growing')) return;
  if (e.level === 'hostkey') {
    const trust = $('#trust');
    trust.hidden = false;
    trust.replaceChildren(el('p', '', 'This is the first time this Mac connects to that computer. If you can, check the computer shows the same code, then continue:'),
      el('code', '', e.data.fingerprint), actions(wbtn('Cancel', 'quiet', () => $('#wizard').close()),
        wbtn('It matches, continue', 'primary', () => startGrowing({ ...wz.req, trustFingerprint: e.data.fingerprint }))));
    return;
  }
  if (e.step === 'done') {
    if (e.level === 'ok') {
      for (const s of document.querySelectorAll('#growing .gstep')) if (!/ok|warn/.test(s.className)) markStep(s, 'ok');
      growFinished(true);
      reloadTargets(e.data);
    } else {
      growFinished(false, friendlyError(e.text));
    }
    return;
  }
  if (e.step === 'log') return;
  const s = document.querySelector(`#growing .gstep[data-step="${e.step}"]`);
  if (!s) return;
  let prev = s.previousElementSibling;
  while (prev) { if (!/ok|warn|error/.test(prev.className)) markStep(prev, 'ok'); prev = prev.previousElementSibling; }
  const cls = e.level === 'info' ? 'active' : e.level === 'ok' ? 'ok' : e.level;
  markStep(s, cls, stepDetail(e));
});

async function reloadTargets(target) {
  state.targets = (await App.Targets()) || [];
  const i = state.targets.findIndex((t) => t.context === target.context && t.namespace === target.namespace);
  selectTarget(i >= 0 ? i : 0);
}

$('#add-machine').onclick = stepWhere;
$('#docs').onclick = (e) => { e.preventDefault(); BrowserOpenURL('https://tinysystems.io/docs/'); };

/* Start */

async function start() {
  $('#brand-mark').append(plant('grow', 30, { pot: true }));
  $('#version').textContent = await App.Version();
  state.targets = (await App.Targets()) || [];
  if (state.targets.length) selectTarget(0);
  const pick = await App.DemoSelect();
  if (pick) { state.selected = pick; }
  else { renderGarden(); stepWhere(); }
  setInterval(refresh, REFRESH_MS);
}

start();
