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
  notifyChanges();
  loadHealth();
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
  ['vm', 'Create the VM'],
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
  showWhere();
  App.Local().then((st) => {
    $('#lima-hint').textContent = st.lima ? '' : `Lima isn't installed yet: ${st.hint}`;
  });
  $('#install-dialog').showModal();
};
$('#install-cancel').onclick = () => $('#install-dialog').close();

function showWhere() {
  const where = $('#install-form').querySelector('input[name="where"]:checked').value;
  for (const el of document.querySelectorAll('#install-form [data-where]')) el.hidden = el.dataset.where !== where;
  for (const n of ['host', 'user']) $('#install-form').elements[n].required = where === 'remote';
}
for (const r of document.querySelectorAll('#install-form input[name="where"]')) r.onchange = showWhere;

$('#install-form').onsubmit = (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const copyFrom = d.copyFrom === '' ? null : state.targets[Number(d.copyFrom)];
  if (d.where === 'mac') {
    $('#install-dialog').close();
    startInstall({ name: d.name.trim(), gvisor: d.gvisor === 'on', local: true,
      cpus: Number(d.cpus), memoryGB: Number(d.memoryGB), diskGB: Number(d.diskGB), copyFrom });
    return;
  }
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
  const steps = STEPS.filter(([id]) => (id !== 'gvisor' || req.gvisor) && (id !== 'vm' || req.local));
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
  const run = req.local
    ? App.InstallLocal({ name: req.name, cpus: req.cpus, memoryGB: req.memoryGB, diskGB: req.diskGB, gvisor: req.gvisor, copyFrom: req.copyFrom })
    : App.Install(req);
  run.catch((e) => finish(false, String(e)));
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


/* Health: what quietly breaks a fleet, with the fix next to it */

const healthCache = {};

async function loadHealth(force = false) {
  const t = cur();
  if (!t) return;
  const key = keyOf(t);
  const cached = healthCache[key];
  if (!force && cached && Date.now() - cached.at < 30000) { renderHealth(cached.h); return; }
  try {
    const h = await App.Health(t);
    healthCache[key] = { h, at: Date.now() };
    if (keyOf(cur()) === key) renderHealth(h);
  } catch (e) {
    healthCache[key] = { h: null, at: Date.now() };
    if (keyOf(cur()) === key) renderHealth(null);
  }
}

function healthItem(level, text, ...controls) {
  const el = document.createElement('div');
  el.className = `item ${level}`;
  const span = document.createElement('span');
  span.className = 'txt';
  span.textContent = text;
  el.append(span, ...controls);
  return el;
}

function button(label, fn) {
  const b = document.createElement('button');
  b.className = 'btn small';
  b.textContent = label;
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { toast(String(e), true); }
    b.disabled = false;
  };
  return b;
}

async function renderHealth(h) {
  const box = $('#health');
  const t = cur();
  const items = [];
  const f = state.fleet;
  // An unreachable fleet that is one of this Mac's VMs is usually just stopped.
  if (f && f.error) {
    const st = await App.Local();
    const vm = (st.vms || []).find((v) => v.name === t.name || v.name === t.context);
    if (vm && vm.status !== 'Running') {
      items.push(healthItem('warn', `This greenhouse is a VM on this Mac, and it's ${vm.status.toLowerCase()}.`,
        button('Start VM', async () => { toast('starting the VM…'); await App.StartVM(vm.name); toast('VM running'); refresh(); })));
    }
  }
  if (h) {
    for (const n of h.nodes || []) {
      if (n.diskPressure) {
        items.push(healthItem('bad', `${n.name} is out of disk: Kubernetes has stopped starting new pods there. Free space on the machine.`));
      } else if (n.diskTotalGB > 0 && n.diskFreeGB / n.diskTotalGB < 0.2) {
        items.push(healthItem('warn', `${n.name} has ${n.diskFreeGB.toFixed(0)} GB free of ${n.diskTotalGB.toFixed(0)} GB. Below 15% Kubernetes stops starting pods.`));
      }
      if (n.memoryPressure) items.push(healthItem('warn', `${n.name} is short of memory.`));
      if (!n.ready) items.push(healthItem('bad', `${n.name} isn't ready.`));
    }
    if ((h.runtimeMissing || []).length) {
      items.push(healthItem('warn', `tiny's runtime here is older than this app: ${h.runtimeMissing.join(', ')} would be dropped from new sessions.`,
        button('Upgrade runtime', async () => { await App.UpgradeRuntime(t); toast('runtime upgraded'); loadHealth(true); })));
    }
    if (h.signIn === 'none') {
      const sel = document.createElement('select');
      const others = state.targets.filter((x) => keyOf(x) !== keyOf(t));
      for (const o of others) sel.append(new Option(o.name, keyOf(o)));
      const controls = others.length ? [sel, button('Copy', async () => {
        const from = others.find((o) => keyOf(o) === sel.value);
        await App.CopyCredentials(from, t);
        toast(`credentials copied from ${from.name}`);
        loadHealth(true);
      })] : [];
      items.push(healthItem('warn', `No agent credentials here, so sessions can't sign in.${others.length ? ' Copy them from:' : ' Run tiny setup.'}`, ...controls));
    }
  }
  box.hidden = !items.length;
  box.replaceChildren(...items);
}

/* Notifications: when an agent starts waiting for you */

const lastNeeds = {};
function notifyChanges() {
  for (const t of state.targets) {
    const k = keyOf(t);
    const now = state.summaries[k]?.needsYou ?? 0;
    if (lastNeeds[k] !== undefined && now > lastNeeds[k]) {
      App.Notify('Tiny Systems', `${t.name}: ${now} ${now === 1 ? 'agent is' : 'agents are'} waiting for you`);
    }
    lastNeeds[k] = now;
  }
}
