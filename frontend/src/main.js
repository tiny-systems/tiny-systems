import './style.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as App from '../wailsjs/go/main/App.js';
import { plant, plantKind } from './plant.js';
import { EventsOn, EventsOff, BrowserOpenURL } from '../wailsjs/runtime/runtime.js';

const $ = (sel) => document.querySelector(sel);
const REFRESH_MS = 2500;

const state = {
  targets: [],
  current: null,      // index into targets
  summaries: {},      // key -> {needsYou, running, error}
  fleet: null,
  selected: null,     // session name
  terms: [],          // {id, session, key, term, fit, el, closed}
  activeTerm: null,
  drafts: {},         // question name -> typed answer, kept across refreshes
  kinds: {},          // session -> last plant kind, to animate changes
  sent: {},           // question name -> answer just sent
};

const keyOf = (t) => `${t.context}/${t.namespace}`;
const cur = () => state.targets[state.current];

function toast(text, bad = false) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, bad ? 6000 : 2600);
}

async function act(label, fn) {
  try {
    await fn();
    toast(label);
    refresh();
  } catch (e) {
    toast(String(e), true);
  }
}

/* Fleets in the rail */

function renderRail() {
  const nav = $('#fleets');
  nav.replaceChildren(...state.targets.map((t, i) => {
    const s = state.summaries[keyOf(t)] || {};
    const b = document.createElement('button');
    b.className = 'fleet';
    b.setAttribute('aria-current', String(i === state.current));
    const count = s.error ? '<span class="down">unreachable</span>'
      : s.needsYou ? `<span class="needs">✳ ${s.needsYou}</span>`
      : s.running != null ? `● ${s.running}` : '';
    b.innerHTML = `<span class="fname"></span><span class="fcount">${count}</span><span class="fwhere"></span>`;
    b.querySelector('.fname').textContent = t.name;
    b.querySelector('.fwhere').textContent = `${t.context} · ${t.namespace}`;
    b.onclick = () => selectTarget(i);
    return b;
  }));
}

function selectTarget(i) {
  state.current = i;
  state.selected = null;
  state.fleet = null;
  renderRail();
  renderFleet();
  refresh();
}

/* The session table */

function sentNote(answer) {
  const n = document.createElement('div');
  n.className = 'q';
  n.textContent = `Sent: “${answer}” — delivered to the agent.`;
  return n;
}

function askBlock(q) {
  const box = document.createElement('div');
  box.className = 'ask';
  const text = document.createElement('div');
  text.className = 'q';
  text.textContent = q.text;
  const opts = document.createElement('div');
  opts.className = 'opts';
  const t = cur();
  // Replace the card at once, so a send never looks like it did nothing.
  const send = async (answer) => {
    try {
      await App.Answer(t, q, answer);
      state.sent[q.name] = answer;
      delete state.drafts[q.name];
      box.replaceChildren(sentNote(answer));
      box.classList.add('sent');
      refresh();
    } catch (e) {
      toast(String(e), true);
    }
  };
  for (const o of q.options || []) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = o;
    b.onclick = () => send(o);
    opts.append(b);
  }
  if (!(q.options || []).length) {
    const input = document.createElement('input');
    input.placeholder = q.idle ? 'Message the agent' : 'Type an answer';
    input.value = state.drafts[q.name] || '';
    input.oninput = () => { state.drafts[q.name] = input.value; };
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn small';
    sendBtn.textContent = 'Send';
    const go = () => {
      const v = input.value.trim();
      if (!v) return;
      sendBtn.disabled = true;
      send(v).finally(() => { sendBtn.disabled = false; });
    };
    sendBtn.onclick = go;
    input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    opts.append(input, sendBtn);
  }
  box.append(text, opts);
  return box;
}

function renderFleet() {
  const t = cur();
  $('#fleet-name').textContent = t ? t.name : 'No fleets';
  $('#fleet-sub').textContent = t ? `${t.context} · ${t.namespace}` : '';
  const f = state.fleet;
  $('#read-at').textContent = f ? `read ${f.readAt}` : '';
  const err = $('#fleet-error');
  err.hidden = !(f && f.error);
  if (f && f.error) err.textContent = f.error;

  const loose = $('#loose');
  const looseQs = (f && f.loose) || [];
  loose.hidden = !looseQs.length;
  if (looseQs.length) {
    const h = document.createElement('h3');
    h.textContent = 'Waiting on you, not tied to a session';
    loose.replaceChildren(h, ...looseQs.map(askBlock));
  }

  const rows = (f && f.rows) || [];
  $('#empty').hidden = !(f && !f.error && rows.length === 0);
  if (!$('#empty').hidden && !$('#empty-plant').firstChild) $('#empty-plant').append(plant('seed', 72));
  // Keep a focused answer box alive across refreshes.
  if (document.activeElement && document.activeElement.closest('#rows .ask')) return;
  $('#rows').replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    if (r.name === state.selected) tr.className = 'sel';
    tr.innerHTML = `
      <td class="g"></td>
      <td class="name"></td>
      <td class="what"><div class="title"></div><div class="activity"></div></td>
      <td class="num"></td><td class="num"></td><td class="num"></td>
      <td class="acts"></td>`;
    const kind = plantKind(r);
    const svg = plant(kind);
    // A plant that just changed state pops in; steady ones stay still.
    if (state.kinds[r.name] && state.kinds[r.name] !== kind) svg.classList.add('fresh');
    state.kinds[r.name] = kind;
    tr.querySelector('.g').append(svg);
    const name = tr.querySelector('.name');
    if (r.depth) name.innerHTML = '<span class="child">└</span>';
    name.append(r.name);
    tr.querySelector('.title').textContent = r.title || r.task || (r.command ? 'command session' : '');
    const activity = tr.querySelector('.activity');
    activity.textContent = r.activity || '';
    if (!r.activity) activity.remove();
    if (r.message && r.phase !== 'Running') {
      const m = document.createElement('div');
      m.className = 'msg';
      m.textContent = r.message;
      tr.querySelector('.what').append(m);
    }
    if (r.question) tr.querySelector('.what').append(askBlock(r.question));
    const nums = tr.querySelectorAll('.num');
    nums[0].textContent = r.cpu || '';
    nums[1].textContent = r.mem || '';
    nums[2].textContent = r.age;
    const acts = tr.querySelector('.acts');
    const btn = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = `btn small ${cls}`;
      b.textContent = label;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      acts.append(b);
    };
    if (r.attachable) btn('Attach', () => openTerminal(r.name));
    if (!r.command) {
      if (r.paused) btn('Resume', () => act(`${r.name} resuming`, () => App.Resume(t, r.name)));
      else btn('Pause', () => act(`${r.name} paused`, () => App.Pause(t, r.name)));
    }
    btn('Delete', () => confirmDelete(r.name), 'danger');
    tr.onclick = () => { state.selected = r.name; renderFleet(); };
    tr.ondblclick = () => { if (r.attachable) openTerminal(r.name); };
    return tr;
  }));
}

async function refresh() {
  const targets = state.targets;
  if (!targets.length) return;
  // The current fleet in full; the others for their rail counts.
  await Promise.all(targets.map(async (t, i) => {
    const f = await App.Fleet(t);
    state.summaries[keyOf(t)] = { needsYou: f.needsYou, running: f.running, error: f.error };
    if (i === state.current) state.fleet = f;
  }));
  renderRail();
  renderFleet();
  updateDockBadge();
}

function updateDockBadge() {
  const waiting = Object.values(state.summaries).reduce((n, s) => n + (s.needsYou || 0), 0);
  document.title = waiting ? `Tiny Systems (${waiting} waiting)` : 'Tiny Systems';
}

function confirmDelete(name) {
  const d = $('#confirm-dialog');
  $('#confirm-title').textContent = `Delete ${name}?`;
  $('#confirm-body').textContent = 'Its workspace and transcript go with it. This can’t be undone.';
  d.returnValue = '';
  d.showModal();
  d.onclose = () => {
    if (d.returnValue === 'ok') act(`${name} deleted`, () => App.Delete(cur(), name));
  };
}

/* New session */

function openNew() {
  const d = $('#new-dialog');
  $('#new-form').reset();
  d.showModal();
}

$('#new-cancel').onclick = () => $('#new-dialog').close();
$('#new-form').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  $('#new-dialog').close();
  const t = cur();
  try {
    const name = await App.NewSession(t, data);
    toast(`${name} starting`);
    refresh();
    if (!data.task.trim()) waitThenAttach(name);
  } catch (err) {
    toast(String(err), true);
  }
};

// An idle session is for talking to: attach as soon as it's running.
async function waitThenAttach(name) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const row = (state.fleet?.rows || []).find((r) => r.name === name);
    if (row?.attachable) { openTerminal(name); return; }
  }
}

/* Terminals */

function termTheme() {
  return {
    background: '#161B16', foreground: '#E6E4D3', cursor: '#EEEDE0', selectionBackground: '#3D4A3B',
    black: '#20281F', red: '#D4705F', green: '#6FBF7E', yellow: '#E0B04F', blue: '#7FA7C9',
    magenta: '#B98BC0', cyan: '#73B8B0', white: '#E6E4D3',
    brightBlack: '#6A7268', brightRed: '#E8907F', brightGreen: '#8FD69C', brightYellow: '#F0C870',
    brightBlue: '#9CC0DE', brightMagenta: '#CFA6D5', brightCyan: '#93D0C8', brightWhite: '#F7F6EC',
  };
}

const enc = new TextEncoder();
const toB64 = (s) => { let b = ''; for (const c of enc.encode(s)) b += String.fromCharCode(c); return btoa(b); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function openTerminal(session) {
  const t = cur();
  const existing = state.terms.find((x) => x.session === session && x.key === keyOf(t) && !x.closed);
  if (existing) { activate(existing); return; }

  const el = document.createElement('div');
  el.className = 'term';
  $('#term-host').append(el);
  const term = new Terminal({
    fontFamily: "'IBM Plex Mono', Menlo, monospace", fontSize: 13, lineHeight: 1.15,
    cursorBlink: true, allowProposedApi: true, theme: termTheme(), scrollback: 0,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  showPane(true);
  fit.fit();

  const entry = { id: null, session, key: keyOf(t), term, fit, el, closed: false };
  state.terms.push(entry);
  activate(entry);
  term.write(`\x1b[2mattaching to ${session}…\x1b[0m\r\n`);
  try {
    entry.id = await App.OpenTerminal(t, session, term.cols, term.rows);
  } catch (e) {
    term.write(`\r\n\x1b[31m${e}\x1b[0m\r\n`);
    entry.closed = true;
    renderTabs();
    return;
  }
  EventsOn(`term:${entry.id}`, (b64) => term.write(fromB64(b64)));
  EventsOn(`term-closed:${entry.id}`, (reason) => {
    entry.closed = true;
    term.write(`\r\n\x1b[2m[detached${reason ? `: ${reason}` : ''}]\x1b[0m\r\n`);
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
  else showPane(false);
  renderTabs();
}

function renderTabs() {
  $('#tabs').replaceChildren(...state.terms.map((x) => {
    const b = document.createElement('div');
    b.className = 'tab' + (x.closed ? ' closed' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(x === state.activeTerm));
    b.tabIndex = 0;
    b.textContent = x.session;
    const close = document.createElement('button');
    close.className = 'x';
    close.title = 'Detach (the agent keeps running)';
    close.textContent = '×';
    close.onclick = (e) => { e.stopPropagation(); closeTerm(x); };
    b.append(close);
    b.onclick = () => activate(x);
    return b;
  }));
}

function showPane(on) {
  $('#term-pane').hidden = !on;
  $('#split').classList.toggle('with-term', on);
}

new ResizeObserver(() => { if (state.activeTerm) state.activeTerm.fit.fit(); }).observe($('#term-host'));

/* Start */

$('#new-btn').onclick = openNew;
$('#empty-new').onclick = openNew;
$('#docs').onclick = (e) => { e.preventDefault(); BrowserOpenURL('https://tinysystems.io/docs/'); };

async function start() {
  $('#version').textContent = await App.Version();
  state.targets = (await App.Targets()) || [];
  if (state.targets.length) selectTarget(0);
  else renderFleet();
  setInterval(refresh, REFRESH_MS);
}

start();

/* Add a machine */

const STEPS = [
  ['connect', 'Connect over SSH'],
  ['preflight', 'Check the machine'],
  ['k3s', 'Install k3s'],
  ['gvisor', 'Install gVisor'],
  ['kubeconfig', 'Add it to your kubeconfig'],
  ['runtime', 'Install tiny’s runtime'],
  ['credentials', 'Agent credentials'],
];

let lastInstall = null;

$('#add-machine').onclick = () => {
  const sel = $('#copy-from');
  sel.replaceChildren(new Option('Set up later with tiny setup', ''),
    ...state.targets.map((t, i) => new Option(`Copy from ${t.name}`, String(i))));
  if (state.targets.length) sel.value = String(state.current ?? 0);
  $('#install-form').reset();
  $('#install-dialog').showModal();
};
$('#install-cancel').onclick = () => $('#install-dialog').close();

$('#install-form').onsubmit = (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const req = {
    name: d.name.trim(), host: d.host.trim(), user: d.user.trim(), port: Number(d.port) || 22,
    keyFile: d.keyFile.trim(), sudoPassword: d.sudoPassword, namespace: d.namespace.trim() || 'tiny',
    gvisor: d.gvisor === 'on', trustFingerprint: '',
    copyFrom: d.copyFrom === '' ? null : state.targets[Number(d.copyFrom)],
  };
  $('#install-dialog').close();
  startInstall(req);
};

function startInstall(req) {
  lastInstall = req;
  const steps = STEPS.filter(([id]) => id !== 'gvisor' || req.gvisor);
  $('#progress-title').textContent = `Setting up ${req.name}`;
  $('#steps').replaceChildren(...steps.map(([id, label]) => {
    const li = document.createElement('li');
    li.dataset.step = id;
    li.append(plant('seed', 26));
    const t = document.createElement('div');
    t.className = 'stext';
    t.textContent = label;
    const det = document.createElement('div');
    det.className = 'sdetail';
    li.append(t, det);
    return li;
  }));
  $('#install-log').textContent = '';
  $('#hostkey').hidden = true;
  $('#progress-close').disabled = true;
  if (!$('#progress-dialog').open) $('#progress-dialog').showModal();
  App.Install(req).catch((e) => finish(false, String(e)));
}

function setStep(id, cls, text) {
  const li = $(`#steps li[data-step="${id}"]`);
  if (!li) return;
  // Steps before this one are done.
  let prev = li.previousElementSibling;
  while (prev) {
    if (!['ok', 'warn', 'error'].includes(prev.className)) mark(prev, 'ok');
    prev = prev.previousElementSibling;
  }
  mark(li, cls);
  if (text) li.querySelector('.sdetail').textContent = text;
}

function mark(li, cls) {
  li.className = cls;
  const kind = { active: 'grow', ok: 'done', warn: 'ask', error: 'fail' }[cls] || 'seed';
  li.firstChild.replaceWith(plant(kind, 26));
}

function finish(ok, text) {
  $('#progress-close').disabled = false;
  $('#progress-title').textContent = ok ? 'Ready' : 'Setup stopped';
  if (!ok) {
    const active = $('#steps li.active') || $('#steps li:not(.ok):not(.warn)');
    if (active) mark(active, 'error');
    if (active) active.querySelector('.sdetail').textContent = text;
  }
}

EventsOn('install:event', (e) => {
  const log = $('#install-log');
  log.textContent += (e.level === 'log' ? '  ' : '• ') + e.text + '\n';
  log.scrollTop = log.scrollHeight;
  if (e.level === 'hostkey') {
    $('#hostkey-fp').textContent = e.data.fingerprint;
    $('#hostkey').hidden = false;
    $('#hostkey-yes').onclick = () => startInstall({ ...lastInstall, trustFingerprint: e.data.fingerprint });
    $('#hostkey-no').onclick = () => $('#progress-dialog').close();
    return;
  }
  if (e.step === 'done') {
    if (e.level === 'ok') {
      for (const li of document.querySelectorAll('#steps li')) if (!['ok', 'warn'].includes(li.className)) mark(li, 'ok');
      finish(true);
      reloadTargets(e.data);
    } else {
      finish(false, e.text);
    }
    return;
  }
  if (e.step === 'log') return;
  const cls = e.level === 'info' ? 'active' : e.level === 'ok' ? 'ok' : e.level;
  setStep(e.step, cls, e.text);
});

$('#progress-close').onclick = () => $('#progress-dialog').close();

async function reloadTargets(target) {
  state.targets = (await App.Targets()) || [];
  const i = state.targets.findIndex((t) => t.context === target.context && t.namespace === target.namespace);
  selectTarget(i >= 0 ? i : 0);
}
