import './style.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as App from '../wailsjs/go/main/App.js';
import { EventsOn, EventsOff, BrowserOpenURL } from '../wailsjs/runtime/runtime.js';
import { glyph, mark, plantKind, STATE, helperName, nameHelpers } from './plant.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const REFRESH_MS = 2500;

const state = {
  view: 'helpers',
  targets: [],
  fleets: {},          // garden key -> Fleet
  filter: 'all',
  query: '',
  sel: null,           // {key, name}
  mode: 'chat',        // chat | terminal
  convo: [],           // messages of the selected helper
  convoFor: '',
  term: null,          // {id, key, name, term, fit, host}
  health: {},          // garden key -> {h, at}
  gardens: [],
};

const keyOf = (t) => `${t.context}/${t.namespace}`;
const targetOf = (key) => state.targets.find((t) => keyOf(t) === key);
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const gardenName = (t) => (t ? title(t.name) : '');

function toast(text, bad = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2400);
}

function friendly(e) {
  const s = String(e).replace(/^Error: /, '');
  if (/connection refused|no such host|i\/o timeout|dial tcp/i.test(s)) return 'That garden can’t be reached right now.';
  if (/forbidden/i.test(s)) return 'You don’t have permission to do that in this garden.';
  return s;
}

async function run(done, fn) {
  try { await fn(); if (done) toast(done); refresh(); } catch (e) { toast(friendly(e), true); }
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function clock(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* Data */

function allRows() {
  const out = [];
  for (const t of state.targets) {
    const f = state.fleets[keyOf(t)];
    for (const r of (f && f.rows) || []) out.push({ ...r, key: keyOf(t), kind: plantKind(r) });
  }
  return out;
}

function selectedRow() {
  if (!state.sel) return null;
  const f = state.fleets[state.sel.key];
  const r = (f?.rows || []).find((x) => x.name === state.sel.name);
  return r ? { ...r, key: state.sel.key, kind: plantKind(r) } : null;
}

async function refresh() {
  await Promise.all(state.targets.map(async (t) => { state.fleets[keyOf(t)] = await App.Fleet(t); }));
  nameHelpers(allRows().map((r) => r.name));
  renderList();
  renderBadge();
  notify();
  if (state.view === 'helpers') {
    await loadConvo();
    renderPane();
  } else {
    renderGardens();
  }
}

/* Helper list */

function renderList() {
  const rows = allRows();
  const asks = rows.filter((r) => r.kind === 'ask').length;
  $('#count-ask').textContent = asks ? String(asks) : '';
  const q = state.query.toLowerCase();
  const show = rows.filter((r) => (state.filter === 'all' || r.kind === state.filter) &&
    (!q || `${helperName(r.name)} ${r.title} ${r.task} ${r.activity}`.toLowerCase().includes(q)));
  const box = $('#rows');
  const out = [];
  for (const t of state.targets) {
    const key = keyOf(t);
    const f = state.fleets[key];
    const mine = show.filter((r) => r.key === key);
    if (!mine.length && (state.filter !== 'all' || q)) continue;
    const g = el('div', 'group');
    const dot = el('span', 'gdot' + (f?.error ? ' asleep' : ''));
    g.append(dot, el('span', 'gn', gardenName(t)), el('span', '', f?.error ? 'asleep' : String((f?.rows || []).length)));
    out.push(g);
    for (const r of mine) out.push(rowEl(r));
  }
  if (!out.length) out.push(el('div', 'list-empty', q ? 'No helpers match.' : 'No helpers yet. Press + to start one.'));
  box.replaceChildren(...out);
}

function rowEl(r) {
  const b = el('button', 'row');
  b.setAttribute('aria-current', String(state.sel?.key === r.key && state.sel?.name === r.name));
  const name = el('div', 'rname');
  name.append(helperName(r.name));
  const chipText = repoLabel(r.task) || (r.command ? 'command' : '');
  if (chipText) name.append(el('span', 'chip', chipText));
  const preview = r.question ? (r.question.idle ? 'Waiting for you' : r.question.text)
    : r.kind === 'fail' ? (r.message || 'Stuck') : (r.activity || r.title || r.task || STATE[r.kind]);
  b.append(glyph(r.kind, 20, { tile: true }), name, el('span', 'time', r.age), el('div', 'preview', preview));
  if (r.question) b.append(el('span', 'badge', '1'));
  b.onclick = () => select(r.key, r.name);
  return b;
}

function repoLabel(task) {
  const m = /github\.com\/[^/\s]+\/([^/\s]+)/.exec(task || '');
  return m ? m[1].replace(/\.git$/, '') : '';
}

function select(key, name, mode = 'chat') {
  if (state.term && (state.term.key !== key || state.term.name !== name)) closeTerminal();
  state.sel = { key, name };
  state.mode = mode;
  state.convoFor = '';
  renderList();
  loadConvo().then(renderPane);
}

/* Helper pane */

async function loadConvo() {
  const r = selectedRow();
  if (!r) { state.convo = []; return; }
  try {
    state.convo = (await App.Conversation(targetOf(r.key), r.name)) || [];
    state.convoFor = `${r.key}/${r.name}`;
  } catch { state.convo = []; }
}

function renderPane() {
  const body = $('#pane-body');
  const r = selectedRow();
  if (!r) {
    const e = el('div', 'pane-empty');
    const inner = el('div');
    inner.append(mark(34), el('h2', '', allRows().length ? 'Pick a helper' : 'Start your first helper'),
      el('p', '', allRows().length ? 'Its conversation and work show here.' : 'A helper is an AI that works on one task until it’s done.'));
    if (!allRows().length) { const b = el('button', 'btn primary', 'New helper'); b.onclick = openNew; inner.append(b); }
    e.append(inner);
    body.replaceChildren(e);
    return;
  }
  // Keep typing undisturbed.
  if (document.activeElement?.closest('#pane-body .composer') && body.dataset.for === `${r.key}/${r.name}` && state.mode === 'chat') {
    renderChat(body.querySelector('.chat-inner'), r);
    return;
  }
  body.dataset.for = `${r.key}/${r.name}`;
  if (state.mode === 'terminal' && state.term && body.querySelector('.term-wrap')) { body.querySelector('.tabbar').replaceWith(tabbar(r)); return; }
  const parts = [tabbar(r)];
  if (state.mode === 'terminal') {
    const wrap = el('div', 'term-wrap');
    wrap.id = 'term-wrap';
    parts.push(wrap);
    body.replaceChildren(...parts);
    openTerminal(r, wrap);
    return;
  }
  const chat = el('div', 'chat');
  const inner = el('div', 'chat-inner');
  chat.append(inner);
  renderChat(inner, r);
  parts.push(chat, composer(r));
  body.replaceChildren(...parts);
  chat.scrollTop = chat.scrollHeight;
}

function tabbar(r) {
  const t = targetOf(r.key);
  const bar = el('div', 'tabbar');
  const who = el('div', 'who');
  who.append(glyph(r.kind, 16), helperName(r.name), el('span', 'where', `· ${gardenName(t)}`));
  const st = el('div', `status ${r.kind}`);
  st.append(el('span', 'sd'), STATE[r.kind]);
  const seg = el('div', 'seg');
  for (const [m, label] of [['chat', 'Chat'], ['terminal', 'Terminal']]) {
    const b = el('button', '', label);
    b.setAttribute('aria-pressed', String(state.mode === m));
    b.disabled = m === 'terminal' && !r.attachable;
    b.title = b.disabled ? 'Available while the helper is running' : '';
    b.onclick = () => {
      if (state.mode === m) return;
      if (m === 'chat') closeTerminal();
      state.mode = m;
      $('#pane-body').dataset.for = '';
      renderPane();
    };
    seg.append(b);
  }
  const more = el('button', 'icon-btn');
  more.setAttribute('aria-label', 'More');
  more.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>';
  more.onclick = (e) => openMenu(e.currentTarget, helperMenu(r));
  bar.append(who, st, el('div', 'fill'), seg, more);
  return bar;
}

function helperMenu(r) {
  const t = targetOf(r.key);
  const items = [];
  if (!r.command) {
    if (r.paused) items.push(['Resume', '', () => run(`${helperName(r.name)} resumed`, () => App.Resume(t, r.name))]);
    else if (r.kind !== 'done') items.push(['Pause', '', () => run(`${helperName(r.name)} paused`, () => App.Pause(t, r.name))]);
  }
  items.push(['Copy session ID', '', () => navigator.clipboard?.writeText(r.name).then(() => toast('Copied'))]);
  items.push(['Remove helper…', 'danger', () => confirmRemove(r)]);
  return items;
}

function renderChat(inner, r) {
  const msgs = state.convo;
  const out = [];
  let lastDay = '';
  for (const m of msgs) {
    const day = new Date(m.at).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const today = day === new Date().toDateString();
      out.push(el('div', 'day', `${today ? 'Today' : new Date(m.at).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock(m.at)}`));
    }
    if (m.from === 'you') { out.push(el('div', 'msg-you', m.text)); continue; }
    const h = el('div', 'msg-helper');
    const meta = el('div', 'meta');
    meta.append(el('b', '', helperName(r.name)), clock(m.at));
    const text = el('div', 'text');
    if (m.question) {
      text.append(m.idle ? 'Finished a step and is waiting for you.' : m.text);
      const card = el('div', 'ask-card' + (m.open ? '' : ' answered'));
      if (m.open && (m.options || []).length) {
        card.append(el('div', '', 'Pick one, or type below:'));
        const opts = el('div', 'opts');
        for (const o of m.options) {
          const b = el('button', 'btn small', o);
          b.onclick = () => answer(r, m, o);
          opts.append(b);
        }
        card.append(opts);
        text.append(card);
      } else if (m.open) {
        card.append(el('div', '', 'Type your reply below.'));
        text.append(card);
      } else if (m.answer) {
        const a = el('div', 'answer');
        a.append('You answered ', el('b', '', m.answer));
        card.append(a);
        text.append(card);
      }
    } else {
      text.append(m.text);
    }
    h.append(glyph(m.open ? 'ask' : 'grow', 16, { tile: true }), meta, text);
    out.push(h);
  }
  if (r.kind === 'grow' && !r.question) {
    const w = el('div', 'working');
    w.append(el('span', 'spin'), r.activity || r.title || 'Working…');
    out.push(w);
  }
  if (r.kind === 'fail' && r.message) out.push(el('div', 'problem', r.message));
  if (r.kind === 'seed') { const w = el('div', 'working'); w.append(el('span', 'spin'), 'Starting up…'); out.push(w); }
  if (!msgs.length && r.kind !== 'grow' && r.kind !== 'seed') out.push(el('div', 'day', 'No messages yet.'));
  inner.replaceChildren(...out);
}

function openQuestion() {
  return [...state.convo].reverse().find((m) => m.question && m.open);
}

function composer(r) {
  const c = el('div', 'composer');
  const inner = el('div', 'composer-inner');
  const ta = el('textarea');
  ta.rows = 1;
  ta.placeholder = `Message ${helperName(r.name)}`;
  const send = el('button', 'send');
  send.setAttribute('aria-label', 'Send');
  send.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  send.disabled = true;
  ta.oninput = () => {
    send.disabled = !ta.value.trim();
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };
  const go = async () => {
    const v = ta.value.trim();
    if (!v) return;
    send.disabled = true;
    const q = openQuestion();
    try {
      if (q) await App.Answer(targetOf(r.key), { name: q.question, session: r.name, text: q.text, idle: !!q.idle }, v);
      else await App.SendMessage(targetOf(r.key), r.name, v);
      ta.value = '';
      ta.style.height = 'auto';
      await refresh();
    } catch (e) {
      toast(friendly(e), true);
    }
    send.disabled = !ta.value.trim();
  };
  send.onclick = go;
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
  inner.append(ta, send);
  c.append(inner);
  return c;
}

async function answer(r, m, value) {
  try {
    await App.Answer(targetOf(r.key), { name: m.question, session: r.name, text: m.text, idle: !!m.idle }, value);
    toast('Sent');
    await refresh();
  } catch (e) { toast(friendly(e), true); }
}

function confirmRemove(r) {
  const d = $('#confirm-dialog');
  $('#confirm-title').textContent = `Remove ${helperName(r.name)}?`;
  $('#confirm-body').textContent = 'It stops, and its files and conversation are deleted. This can’t be undone.';
  d.returnValue = '';
  d.showModal();
  d.onclose = () => {
    if (d.returnValue !== 'ok') return;
    closeTerminal();
    state.sel = null;
    run(`${helperName(r.name)} removed`, () => App.Delete(targetOf(r.key), r.name));
  };
}

/* Menu */

function openMenu(anchor, items) {
  const m = $('#menu');
  m.replaceChildren(...items.map(([label, cls, fn]) => {
    const b = el('button', cls, label);
    b.onclick = () => { m.hidden = true; fn(); };
    return b;
  }));
  const r = anchor.getBoundingClientRect();
  m.hidden = false;
  m.style.top = `${r.bottom + 6}px`;
  m.style.left = `${Math.max(8, r.right - m.offsetWidth)}px`;
  setTimeout(() => document.addEventListener('click', () => { m.hidden = true; }, { once: true }), 0);
}

/* Terminal */

const enc = new TextEncoder();
const toB64 = (s) => { let b = ''; for (const c of enc.encode(s)) b += String.fromCharCode(c); return btoa(b); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const theme = {
  background: '#0D110E', foreground: '#DCE6DE', cursor: '#46D87A', selectionBackground: '#2B3A2F',
  black: '#1D231E', red: '#EF7461', green: '#46D87A', yellow: '#F4B44C', blue: '#7FB2E0', magenta: '#E58BB5', cyan: '#6FCFC1', white: '#DCE6DE',
  brightBlack: '#5D6A61', brightRed: '#F59585', brightGreen: '#7BE7A0', brightYellow: '#F7CB7A', brightBlue: '#A3C9EC', brightMagenta: '#EFADCB', brightCyan: '#97DDD3', brightWhite: '#F4F8F5',
};

async function openTerminal(r, wrap) {
  if (state.term) { wrap.append(state.term.host); state.term.fit.fit(); state.term.term.focus(); return; }
  const host = el('div', 'term');
  wrap.append(host);
  const term = new Terminal({ fontFamily: "'Geist Mono Variable', ui-monospace, Menlo, monospace", fontSize: 12.5, lineHeight: 1.15, cursorBlink: true, allowProposedApi: true, theme, scrollback: 0 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  const entry = { id: null, key: r.key, name: r.name, term, fit, host, closed: false };
  state.term = entry;
  term.write(`\x1b[2mconnecting to ${helperName(r.name)}…\x1b[0m\r\n`);
  // A helper that was just planted takes a minute to start: keep trying
  // while it's still this terminal, up to about three minutes.
  for (let tries = 0; ; tries++) {
    try {
      entry.id = await App.OpenTerminal(targetOf(r.key), r.name, term.cols, term.rows);
      if (state.term !== entry) { App.CloseTerminal(entry.id); return; } // left while connecting
      break;
    } catch (e) {
      if (state.term !== entry) return;
      if (tries >= 60) {
        term.write(`\r\n\x1b[31m${friendly(e)}\x1b[0m\r\n`);
        entry.closed = true;
        return;
      }
      if (tries === 0) term.write(`\x1b[2mwaiting for ${helperName(r.name)} to start…\x1b[0m\r\n`);
      await new Promise((ok) => setTimeout(ok, 3000));
      if (state.term !== entry) return;
    }
  }
  EventsOn(`term:${entry.id}`, (b64) => term.write(fromB64(b64)));
  EventsOn(`term-closed:${entry.id}`, (reason) => {
    entry.closed = true;
    term.write(`\r\n\x1b[2m[disconnected${reason ? `: ${reason}` : ''}]\x1b[0m\r\n`);
    EventsOff(`term:${entry.id}`, `term-closed:${entry.id}`);
  });
  term.onData((d) => { if (!entry.closed) App.TermInput(entry.id, toB64(d)); });
  term.onResize(({ cols, rows }) => { if (!entry.closed) App.TermResize(entry.id, cols, rows); });
  term.focus();
}

function closeTerminal() {
  const t = state.term;
  if (!t) return;
  if (t.id && !t.closed) App.CloseTerminal(t.id);
  t.term.dispose();
  t.host.remove();
  state.term = null;
}

new ResizeObserver(() => { if (state.term) state.term.fit.fit(); }).observe($('#pane'));

/* Gardens view */

async function renderGardens() {
  state.gardens = (await App.Gardens()) || [];
  const rows = await Promise.all(state.gardens.map(async (g) => {
    const key = keyOf(g.target);
    const f = state.fleets[key];
    let h = state.health[key];
    if (!h || Date.now() - h.at > 30000) {
      let v = null;
      try { v = await App.Health(g.target); } catch { /* unreachable */ }
      h = state.health[key] = { h: v, at: Date.now() };
    }
    return gardenRow(g, f, h.h);
  }));
  $('#gv-rows').replaceChildren(...rows);
}

function gardenRow(g, f, h) {
  const t = g.target;
  const row = el('div', 'gv-row');
  const asleep = !!(f && f.error);
  const kind = asleep ? 'rest' : (f?.needsYou ? 'ask' : 'grow');
  const name = el('div', 'gname');
  name.append(el('b', '', gardenName(t)), el('span', '', g.where || t.context));
  const status = el('div', 'cell');
  const pill = el('span', 'pill' + (asleep ? ' off' : f?.needsYou ? ' warn' : ''), asleep ? (g.local ? 'Asleep' : 'Unreachable') : 'Awake');
  status.append(pill);
  if (!asleep && h) status.append(el('span', h.sandbox ? 'sbx on' : 'sbx', h.sandbox ? 'Sandboxed' : 'Not sandboxed'));
  const helpers = el('div', 'cell');
  helpers.append(el('b', '', asleep ? '—' : `${(f?.rows || []).length} helper${(f?.rows || []).length === 1 ? '' : 's'}`),
    el('span', '', f?.needsYou ? `${f.needsYou} need${f.needsYou === 1 ? 's' : ''} you` : ''));
  const disk = el('div', 'cell');
  const n = h?.nodes?.[0];
  if (n && n.diskTotalGB > 0) {
    const used = 1 - n.diskFreeGB / n.diskTotalGB;
    disk.append(el('span', '', `${n.diskFreeGB.toFixed(0)} GB free of ${n.diskTotalGB.toFixed(0)}`));
    const bar = el('div', 'disk' + (n.diskPressure ? ' full' : used > 0.8 ? ' low' : ''));
    const fill = el('i');
    fill.style.width = `${Math.round(used * 100)}%`;
    bar.append(fill);
    disk.append(bar);
  } else {
    disk.append(el('span', '', '\u2014'));
  }
  const actions = el('div', 'gv-actions');
  if (asleep && g.local) {
    const b = el('button', 'btn small green', 'Wake');
    b.onclick = () => run(`${gardenName(t)} is awake`, async () => { toast('Waking…'); await App.StartVM(t.context); });
    actions.append(b);
  }
  if (!asleep) {
    const b = el('button', 'btn small', 'New helper');
    b.onclick = () => openNew(t);
    actions.append(b);
  }
  row.append(glyph(kind, 20, { tile: true }), name, status, helpers, disk, actions);

  const notes = [];
  if (asleep) h = null;
  if (n?.diskPressure) notes.push(['bad', 'Out of disk: new helpers can’t start until space is freed on this computer.']);
  if (h && (h.runtimeMissing || []).length) notes.push(['', 'An update is available for this garden.', 'Update', async () => { await App.UpgradeRuntime(t); toast('Updated'); state.health = {}; renderGardens(); }]);
  if (h && !h.sandbox && h.sandboxAvailable) notes.push(['', 'Helpers here run without the sandbox, though it’s installed.', 'Turn on', async () => { await App.SetSandbox(t, true); toast('Sandbox on: new helpers run sealed off'); state.health = {}; renderGardens(); }]);
  if (h && h.signIn === 'none') notes.push(['', 'Helpers can’t sign in here yet.', 'copy']);
  for (const [cls, text, act, fn] of notes) {
    const note = el('div', 'gv-note' + (cls ? ` ${cls}` : ''));
    note.append(text);
    if (act === 'copy') {
      const others = state.targets.filter((x) => keyOf(x) !== keyOf(t) && !state.fleets[keyOf(x)]?.error && x.context !== '__demo__');
      const add = el('button', 'btn small', 'Add key');
      add.onclick = () => signInDialog(t);
      note.append(add);
      if (others.length) {
        const sel = el('select');
        for (const o of others) sel.append(new Option(`from ${gardenName(o)}`, keyOf(o)));
        const b = el('button', 'btn small', 'Copy sign-in');
        b.onclick = () => run('Sign-in copied', async () => { await App.CopyCredentials(targetOf(sel.value), t); state.health = {}; });
        note.append(sel, b);
      }
    } else if (act) {
      const b = el('button', 'btn small', act);
      b.onclick = () => fn().catch((e) => toast(friendly(e), true));
      note.append(b);
    }
    row.append(note);
  }
  return row;
}

/* Views */

function setView(v) {
  state.view = v;
  $('#app').classList.toggle('gardens', v === 'gardens');
  $('#gardens-view').hidden = v !== 'gardens';
  for (const b of document.querySelectorAll('.rail-btn[data-view]')) b.setAttribute('aria-current', String(b.dataset.view === v));
  if (v === 'gardens') { closeTerminal(); renderGardens(); } else { renderPane(); }
}
for (const b of document.querySelectorAll('.rail-btn[data-view]')) b.onclick = () => setView(b.dataset.view);
$('#help').onclick = (e) => {
  e.stopPropagation();
  openMenu($('#help'), [
    ['Help and docs', '', () => BrowserOpenURL('https://tinysystems.dev/docs/')],
    ['Settings', '', openSettings],
    ['Copy diagnostics', '', () => App.CopyDiagnostics().then(() => toast('Diagnostics copied: paste them into your message to support')).catch((err) => toast(friendly(err), true))],
  ]);
};

function openSettings() {
  App.GetSettings().then((cur) => {
    const form = el('form');
    form.style.cssText = 'padding:0;display:flex;flex-direction:column;gap:12px';
    const check = (name, label, on) => {
      const l = el('label', 'check');
      const c = el('input');
      c.type = 'checkbox'; c.name = name; c.checked = !!on;
      l.append(c, label);
      return l;
    };
    form.append(
      check('openAtLogin', 'Open Tiny Systems when you log in', cur.openAtLogin),
      check('startVMs', 'Start this Mac’s gardens when the app opens', cur.startVMs),
      check('checkUpdates', 'Tell me when a new version is out', cur.checkUpdates),
      el('p', 'hint', 'Closing the window keeps Tiny Systems running, so helpers can still reach you. Quit with ⌘Q.'),
    );
    const save = el('button', 'btn primary', 'Save');
    save.type = 'submit';
    form.append(actionsRow(wbtn('Cancel', 'ghost', () => $('#wizard').close()), save));
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const d = new FormData(form);
      try {
        await App.SaveSettings({ openAtLogin: d.has('openAtLogin'), startVMs: d.has('startVMs'), checkUpdates: d.has('checkUpdates') });
        $('#wizard').close();
        toast('Settings saved');
      } catch (err) { toast(friendly(err), true); }
    };
    wizard(el('h2', '', 'Settings'), form);
  }).catch((err) => toast(friendly(err), true));
}

function renderBadge() {
  const n = allRows().filter((r) => r.kind === 'ask').length;
  const b = $('#rail-badge');
  b.hidden = !n;
  b.textContent = String(n);
  document.title = n ? `Tiny Systems (${n})` : 'Tiny Systems';
  if (renderBadge.n !== n) { renderBadge.n = n; App.SetBadge(n).catch(() => {}); }
}

/* Filters and search */

for (const b of document.querySelectorAll('#filters button')) {
  b.onclick = () => {
    state.filter = b.dataset.filter;
    for (const x of document.querySelectorAll('#filters button')) x.setAttribute('aria-selected', String(x === b));
    renderList();
  };
}
$('#search').oninput = (e) => { state.query = e.target.value; renderList(); };

/* Notifications */

const lastAsk = {};
function notify() {
  for (const t of state.targets) {
    const k = keyOf(t);
    const now = state.fleets[k]?.needsYou ?? 0;
    if (lastAsk[k] !== undefined && now > lastAsk[k]) App.Notify('Tiny Systems', `A helper in ${gardenName(t)} needs you`);
    lastAsk[k] = now;
  }
}

/* New helper */

function openNew(target) {
  $('#new-form').reset();
  const sel = $('#new-garden');
  const live = state.targets.filter((t) => !state.fleets[keyOf(t)]?.error);
  sel.replaceChildren(...live.map((t) => new Option(gardenName(t), keyOf(t))));
  const pick = target ? keyOf(target) : state.sel?.key;
  if (pick && live.some((t) => keyOf(t) === pick)) sel.value = pick;
  if (!live.length) { toast('Add a garden first: that’s where helpers live.', true); return; }
  $('#new-dialog').showModal();
}
$('#new-btn').onclick = () => openNew();
$('#new-cancel').onclick = () => $('#new-dialog').close();
$('#new-form').onsubmit = async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  $('#new-dialog').close();
  const t = targetOf(d.garden);
  try {
    const task = (d.task || '').trim();
    const name = await App.NewSession(t, { task, repo: d.repo, agent: d.agent, model: d.model, image: d.image });
    toast(`${helperName(name)} started`);
    setView('helpers');
    await refresh();
    // No task: a blank session, so open straight into its terminal.
    select(keyOf(t), name, task ? 'chat' : 'terminal');
  } catch (err) { toast(friendly(err), true); }
};

/* Add a garden: a short guided flow */

const wz = { req: null };
const wizard = (...c) => { $('#wz').replaceChildren(...c); if (!$('#wizard').open) $('#wizard').showModal(); };
const actionsRow = (...b) => { const a = el('div', 'actions'); a.append(...b); return a; };
const wbtn = (label, cls, fn) => { const b = el('button', `btn ${cls}`, label); b.type = 'button'; b.onclick = fn; return b; };
// slug turns whatever name was typed ("Home Garden") into the form
// computers and Kubernetes accept ("home-garden").
function slug(name) {
  return name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'garden';
}

function field(label, name, attrs = {}, opt) {
  const l = el('label', 'field');
  l.append(label);
  if (opt) l.append(' ', el('span', 'opt', opt));
  const i = el('input');
  i.name = name;
  // No macOS autocapitalize or autocorrect on names, hosts and paths.
  i.setAttribute('autocapitalize', 'off');
  i.setAttribute('autocorrect', 'off');
  i.spellcheck = false;
  Object.assign(i, attrs);
  l.append(i);
  return l;
}

// keyBlock is the "sign helpers in" field: a pasted Claude key, with the
// two ways to get one. The key goes straight to the garden.
function keyBlock() {
  const box = el('div', 'keyblock');
  box.append(field('Claude key', 'token', { type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…' }));
  const how = el('p', 'hint');
  const cli = el('button', 'linkish', 'get one with Claude Code');
  cli.type = 'button';
  cli.onclick = () => App.ClaudeSetupToken().then(() => toast('Sign in in Terminal, then paste the key here')).catch((e) => toast(friendly(e), true));
  const api = el('button', 'linkish', 'create an API key');
  api.type = 'button';
  api.onclick = () => BrowserOpenURL('https://console.anthropic.com/settings/keys');
  how.append('Claude subscription: ', cli, '. Or ', api, ' in the Claude Console (billed per use).');
  App.HasClaudeCLI().then((has) => {
    if (!has) cli.replaceWith('install Claude Code and run ', el('code', '', 'claude setup-token'));
  }).catch(() => {});
  box.append(how);
  return box;
}

function signInDialog(t) {
  const form = el('form');
  form.style.cssText = 'padding:0;display:flex;flex-direction:column;gap:13px';
  const save = el('button', 'btn primary', 'Sign in');
  save.type = 'submit';
  form.append(keyBlock(), actionsRow(wbtn('Cancel', 'ghost', () => $('#wizard').close()), save));
  form.onsubmit = async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      await App.SignIn(t, new FormData(form).get('token') || '');
      $('#wizard').close();
      toast('Helpers in ' + gardenName(t) + ' are signed in');
      state.health = {};
      renderGardens();
    } catch (err) { toast(friendly(err), true); save.disabled = false; }
  };
  wizard(el('h2', '', `Sign helpers in to ${gardenName(t)}`), el('p', 'lead', 'Helpers use your Claude account to work. The key stays in this garden.'), form);
}

function stepWhere() {
  const places = el('div', 'places');
  const mac = el('button', 'place');
  mac.type = 'button';
  mac.append(glyph('grow', 22, { tile: true }), el('b', '', 'This Mac'), el('span', '', 'Quickest to start. Helpers work while the Mac is awake.'));
  mac.onclick = () => stepDetails('mac');
  const other = el('button', 'place');
  other.type = 'button';
  other.append(glyph('done', 22, { tile: true }), el('b', '', 'Another computer'), el('span', '', 'A computer at home or in the office that stays on. Helpers keep working while you’re away.'));
  other.onclick = () => stepDetails('remote');
  places.append(mac, other);
  wizard(el('h2', '', 'Add a garden'), el('p', 'lead', 'Where should your helpers live?'), places, actionsRow(wbtn('Cancel', 'ghost', () => $('#wizard').close())));
}

function stepDetails(where) {
  const form = el('form');
  form.style.cssText = 'padding:0;display:flex;flex-direction:column;gap:13px';
  form.append(field('Name', 'name', { required: true, placeholder: where === 'mac' ? 'My Mac' : 'Office' }));
  if (where === 'remote') {
    const r = el('div', 'row2');
    r.append(field('Address', 'host', { required: true, placeholder: '192.168.1.20' }), field('SSH user', 'user', { required: true, placeholder: 'ubuntu' }));
    form.append(r, el('p', 'hint', 'Connects over SSH with the keys already on this Mac.'));
  }
  const creds = el('label', 'field');
  creds.append('Sign helpers in');
  const sel = el('select');
  sel.name = 'copyFrom';
  for (const [i, t] of state.targets.entries()) if (!state.fleets[keyOf(t)]?.error && t.context !== '__demo__') sel.append(new Option(`Same as ${gardenName(t)}`, String(i)));
  sel.append(new Option('Paste a Claude key', 'paste'));
  sel.append(new Option('Later', ''));
  if (sel.options.length === 2) sel.value = 'paste'; // no garden to copy from
  creds.append(sel);
  const key = keyBlock();
  const showKey = () => { key.hidden = sel.value !== 'paste'; };
  sel.onchange = showKey;
  showKey();
  form.append(creds, key);
  const adv = el('details', 'advanced');
  adv.append(el('summary', '', 'Advanced'));
  const safety = el('label', 'check');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.name = 'gvisor';
  cb.checked = true;
  safety.append(cb, 'Extra isolation (recommended): helpers run in a sandbox, sealed off from the computer.');
  adv.append(safety);
  if (where === 'mac') {
    const r = el('div', 'row3');
    r.append(field('CPUs', 'cpus', { type: 'number', value: '2', min: '1', max: '16' }), field('Memory GB', 'memoryGB', { type: 'number', value: '4', min: '2', max: '64' }), field('Disk GB', 'diskGB', { type: 'number', value: '40', min: '20', max: '500' }));
    adv.append(r);
  } else {
    const r = el('div', 'row2');
    r.append(field('SSH port', 'port', { type: 'number', value: '22', min: '1', max: '65535' }), field('Key file', 'keyFile', { placeholder: '~/.ssh/id_ed25519' }, 'optional'));
    adv.append(r, field('Sudo password', 'sudoPassword', { type: 'password', autocomplete: 'off', placeholder: 'only if asked; never stored' }, 'optional'));
  }
  adv.append(field('Namespace', 'namespace', { placeholder: 'tiny' }, 'optional'));
  form.append(adv);
  const go = el('button', 'btn primary', 'Create garden');
  go.type = 'submit';
  form.append(actionsRow(wbtn('Back', 'ghost', stepWhere), go));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const copyFrom = d.copyFrom === '' || d.copyFrom === 'paste' ? null : state.targets[Number(d.copyFrom)];
    const token = d.copyFrom === 'paste' ? (d.token || '').trim() : '';
    if (where === 'mac') {
      { const l = await App.Local(); if (!l.lima) { toast(l.hint || 'This Mac can’t run gardens yet.', true); return; } }
      grow({ local: true, name: slug(d.name), gvisor: !!d.gvisor, cpus: Number(d.cpus), memoryGB: Number(d.memoryGB), diskGB: Number(d.diskGB), copyFrom, token });
    } else {
      grow({ name: slug(d.name), host: d.host.trim(), user: d.user.trim(), port: Number(d.port) || 22, keyFile: (d.keyFile || '').trim(), sudoPassword: d.sudoPassword || '',
        namespace: (d.namespace || '').trim() || 'tiny', gvisor: !!d.gvisor, trustFingerprint: '', copyFrom, token });
    }
  };
  wizard(el('h2', '', where === 'mac' ? 'Garden on this Mac' : 'Garden on another computer'), form);
}

const STEPS = [
  ['vm', 'Create a virtual machine'], ['connect', 'Connect'], ['preflight', 'Check the computer'], ['k3s', 'Install Kubernetes'],
  ['gvisor', 'Install the sandbox'], ['kubeconfig', 'Save the connection'], ['runtime', 'Set up the garden'], ['credentials', 'Sign helpers in'],
];

function grow(req) {
  wz.req = req;
  const list = el('div', 'steps');
  list.id = 'steps';
  for (const [id, label] of STEPS.filter(([id]) => (id !== 'gvisor' || req.gvisor) && (id !== 'vm' || req.local))) {
    const s = el('div', 'step');
    s.dataset.step = id;
    s.append(el('span', 'ic'), el('span', '', label), el('span', 'sd'));
    list.append(s);
  }
  const trust = el('div', 'trust');
  trust.id = 'trust';
  trust.hidden = true;
  const log = el('details', 'techlog');
  const pre = el('pre');
  pre.id = 'grow-log';
  log.append(el('summary', '', 'Log'), pre);
  const close = wbtn('Close', 'ghost', () => $('#wizard').close());
  close.id = 'grow-close';
  close.disabled = true;
  const h = el('h2', '', `Creating ${req.name}`);
  h.id = 'grow-title';
  const lead = el('p', 'lead', 'Takes a few minutes. You can keep working.');
  lead.id = 'grow-lead';
  const acts = actionsRow(close);
  acts.id = 'grow-actions';
  wizard(h, lead, list, trust, log, acts);
  const p = req.local
    ? App.InstallLocal({ name: req.name, cpus: req.cpus, memoryGB: req.memoryGB, diskGB: req.diskGB, gvisor: req.gvisor, copyFrom: req.copyFrom, token: req.token })
    : App.Install(req);
  p.catch((e) => finish(false, friendly(e)));
}

function markStep(s, cls, detail) {
  s.className = `step ${cls}`;
  if (detail != null) s.querySelector('.sd').textContent = detail;
}

function finish(ok, text, target) {
  $('#grow-close').disabled = false;
  $('#grow-title').textContent = ok ? `${title(wz.req.name)} is ready` : 'Setup stopped';
  const acts = $('#grow-actions');
  if (ok) {
    $('#grow-lead').textContent = 'Everything is set up. Give it its first helper.';
    $('#grow-close').textContent = 'Later';
    acts.append(wbtn('Plant a helper', 'primary', async () => {
      $('#wizard').close();
      await reloadTargets();
      openNew(target);
    }));
  } else {
    $('#grow-lead').textContent = 'Nothing is lost: running setup again picks up where it stopped.';
    acts.append(wbtn('Try again', 'primary', () => grow(wz.req)));
  }
  if (!ok) {
    const s = document.querySelector('#steps .step.active') || document.querySelector('#steps .step:not(.ok):not(.warn)');
    if (s) markStep(s, 'error', text);
  }
}

EventsOn('install:event', (e) => {
  const log = $('#grow-log');
  if (log) { log.textContent += (e.level === 'log' ? '  ' : '• ') + e.text + '\n'; log.scrollTop = log.scrollHeight; }
  if (!$('#steps')) return;
  if (e.level === 'hostkey') {
    const t = $('#trust');
    t.hidden = false;
    t.replaceChildren(el('p', '', 'First connection to this computer. Check its key fingerprint matches, then continue:'), el('code', '', e.data.fingerprint),
      actionsRow(wbtn('Cancel', 'ghost', () => $('#wizard').close()), wbtn('Trust and continue', 'primary', () => grow({ ...wz.req, trustFingerprint: e.data.fingerprint }))));
    return;
  }
  if (e.step === 'done') {
    if (e.level === 'ok') {
      for (const s of document.querySelectorAll('#steps .step')) if (!/ok|warn/.test(s.className)) markStep(s, 'ok');
      finish(true, '', e.data);
      reloadTargets();
    } else finish(false, friendly(e.text));
    return;
  }
  if (e.step === 'log') return;
  const s = document.querySelector(`#steps .step[data-step="${e.step}"]`);
  if (!s) return;
  let prev = s.previousElementSibling;
  while (prev) { if (!/ok|warn|error/.test(prev.className)) markStep(prev, 'ok'); prev = prev.previousElementSibling; }
  const cls = e.level === 'info' ? 'active' : e.level === 'ok' ? 'ok' : e.level;
  markStep(s, cls, e.level === 'warn' ? e.text.replace(/`/g, '') : '');
});

EventsOn('vms:started', () => { state.health = {}; refresh(); });

async function reloadTargets() {
  state.targets = (await App.Targets()) || [];
  state.health = {};
  refresh();
}
$('#add-garden').onclick = stepWhere;

/* Updates: a quiet note when a newer release is out. Nothing installs
   itself; Download opens the release and the person decides. */

async function checkUpdate() {
  let u;
  try { u = await App.CheckUpdate(); } catch { return; }
  if (!u || !u.available) return;
  let skipped = '';
  try { skipped = localStorage.getItem('update-skipped') || ''; } catch {}
  if (skipped === u.version) return;
  $('#update-text').textContent = `Tiny Systems ${u.version} is available`;
  $('#update-get').onclick = () => BrowserOpenURL(u.url);
  $('#update-close').onclick = () => {
    try { localStorage.setItem('update-skipped', u.version); } catch {}
    $('#update').hidden = true;
  };
  $('#update').hidden = false;
}

/* Start */

async function start() {
  $('#rail-mark').append(mark(18));
  $('#rail-mark').title = `Tiny Systems ${await App.Version()}`;
  setView('helpers');
  state.targets = (await App.Targets()) || [];
  if (!state.targets.length) { renderPane(); stepWhere(); return; }
  await refresh();
  const pick = await App.DemoSelect();
  if (pick === 'gardens') { setView('gardens'); setInterval(refresh, REFRESH_MS); return; }
  const first = allRows().find((r) => (pick ? r.name === pick : r.kind === 'ask')) || allRows()[0];
  if (first) select(first.key, first.name);
  setInterval(refresh, REFRESH_MS);
}

start();
checkUpdate();
setInterval(checkUpdate, 6 * 60 * 60 * 1000);
