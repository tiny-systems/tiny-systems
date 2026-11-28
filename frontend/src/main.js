import './style.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as App from '../wailsjs/go/main/App.js';
import { EventsOn, EventsOff, BrowserOpenURL, OnFileDrop } from '../wailsjs/runtime/runtime.js';
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
  mode: 'chat',        // chat | changes | terminal | shell
  convo: [],           // messages of the selected helper
  convoFor: '',
  term: null,          // {id, key, name, kind, term, fit, host}
  changes: { for: '', data: null, sel: '', patch: null, error: '' },
  collapsed: new Set(), // parents whose helpers are folded, by key/name
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
  replay(t);
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2400);
}

// Restart an element's CSS entrance animation (toast, nudges).
function replay(node, cls = 'pop') {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

// The list and chat are rebuilt on every refresh, so entrance motion goes
// only on what is new since the last render: rows that appeared, rows whose
// state changed, messages that arrived while you watched.
const seen = { rows: null, kinds: new Map(), msgs: null, msgsFor: '' };

// Looping animations (sway, glow, shimmer, spinners) would restart on every
// rebuild and jump; a negative delay from the wall clock keeps each one on
// a single continuous cycle across rebuilds.
function syncPhase() {
  const now = Date.now();
  const st = document.documentElement.style;
  for (const ms of [1000, 1800, 3200, 3600]) st.setProperty(`--ph-${ms}`, `-${now % ms}ms`);
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
  syncPhase();
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
    const g = el('div', 'group' + (f && !f.error && !(f.rows || []).length ? ' empty' : ''));
    const dot = el('span', 'gdot' + (f?.error ? ' asleep' : ''));
    const n = (f?.rows || []).length;
    g.append(dot, el('span', 'gn', gardenName(t)), el('span', 'gc', f?.error ? 'asleep' : n ? String(n) : ''));
    if (!f?.error) {
      const add = el('button', 'gadd');
      add.setAttribute('aria-label', `New helper in ${gardenName(t)}`);
      add.title = `New helper in ${gardenName(t)}`;
      add.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      add.onclick = () => openNew(t);
      g.append(add);
    }
    out.push(g);
    const kids = {};
    for (const r of f?.rows || []) if (r.parent) kids[r.parent] = (kids[r.parent] || 0) + 1;
    for (const r of mine) {
      if (r.parent && !q && state.collapsed.has(`${key}/${r.parent}`) && mine.some((p) => p.name === r.parent)) continue;
      out.push(rowEl(r, kids[r.name] || 0));
    }
  }
  if (!out.length) out.push(el('div', 'list-empty', q ? 'No helpers match.' : 'No helpers yet. Press + to start one.'));
  const first = seen.rows === null;
  const now = new Set();
  for (const b of out) {
    const id = b.dataset?.id;
    if (!id) continue;
    now.add(id);
    if (!first && !seen.rows.has(id)) b.classList.add('enter');
    else if (!first && seen.kinds.has(id) && seen.kinds.get(id) !== b.dataset.kind) b.classList.add('changed');
    seen.kinds.set(id, b.dataset.kind);
  }
  seen.rows = new Set([...(seen.rows || []), ...now]);
  box.replaceChildren(...out);
}

function rowEl(r, kids = 0) {
  const b = el('button', 'row' + (r.depth > 0 ? ' child' : ''));
  b.dataset.id = `${r.key}/${r.name}`;
  b.dataset.kind = r.kind;
  b.setAttribute('aria-current', String(state.sel?.key === r.key && state.sel?.name === r.name));
  const name = el('div', 'rname');
  name.append(helperName(r.name));
  const chipText = repoLabel(r.task) || (r.command ? 'command' : '');
  if (chipText) name.append(el('span', 'chip', chipText));
  const preview = r.question ? (r.question.idle ? 'Waiting for you' : r.question.text)
    : r.kind === 'fail' ? (r.message || 'Stuck') : (r.activity || r.title || r.task || STATE[r.kind]);
  b.append(glyph(r.kind, 20, { tile: true }), name, el('span', 'time', r.age), el('div', 'preview', preview));
  if (r.question) b.append(el('span', 'badge', '1'));
  if (kids) {
    // A helper that started helpers: fold them away or show them.
    const id = `${r.key}/${r.name}`;
    const folded = state.collapsed.has(id);
    const t = el('span', 'kids' + (folded ? ' folded' : ''), String(kids));
    t.setAttribute('role', 'button');
    t.tabIndex = 0;
    t.title = folded ? `Show the ${kids} helper${kids === 1 ? '' : 's'} it started` : `Hide the helper${kids === 1 ? '' : 's'} it started`;
    const flip = (e) => { e.stopPropagation(); if (folded) state.collapsed.delete(id); else state.collapsed.add(id); renderList(); };
    t.onclick = flip;
    t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') flip(e); };
    name.append(t);
  }
  b.onclick = () => select(r.key, r.name);
  return b;
}

function repoLabel(task) {
  const m = /github\.com\/[^/\s]+\/([^/\s]+)/.exec(task || '');
  return m ? m[1].replace(/\.git$/, '') : '';
}

function select(key, name, mode = 'chat') {
  if (state.term && (state.term.key !== key || state.term.name !== name || state.term.kind !== mode)) closeTerminal();
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
  syncPhase();
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
  const switched = body.dataset.for !== `${r.key}/${r.name}`;
  body.dataset.for = `${r.key}/${r.name}`;
  const live = isTermMode(state.mode) ? (state.term?.kind === state.mode && body.querySelector('.term-wrap'))
    : state.mode === 'changes' ? body.querySelector('.changes') : null;
  if (live && !switched) { body.querySelector('.tabbar').replaceWith(tabbar(r)); return; }
  const parts = [tabbar(r)];
  if (isTermMode(state.mode)) {
    const wrap = el('div', 'term-wrap' + (switched ? ' enter' : ''));
    wrap.id = 'term-wrap';
    parts.push(wrap);
    body.replaceChildren(...parts);
    openTerminal(r, wrap, state.mode);
    return;
  }
  if (state.mode === 'changes') {
    parts.push(changesEl(r));
    body.replaceChildren(...parts);
    if (state.changes.for !== `${r.key}/${r.name}`) loadChanges(r);
    return;
  }
  const chat = el('div', 'chat' + (switched ? ' enter' : ''));
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
  if (r.parent) {
    const p = el('button', 'parent-link', `started by ${helperName(r.parent)}`);
    p.onclick = () => select(r.key, r.parent);
    who.append(p);
  }
  const st = el('div', `status ${r.kind}`);
  st.append(el('span', 'sd'), STATE[r.kind]);
  const seg = el('div', 'seg');
  for (const [m, label, hint] of [
    ['chat', 'Chat', ''],
    ['changes', 'Changes', 'What it changed in the project'],
    ['terminal', 'Terminal', 'Its Claude Code or Codex session'],
    ['shell', 'Shell', 'A plain shell on its files, beside the agent'],
  ]) {
    const b = el('button', '', label);
    b.setAttribute('aria-pressed', String(state.mode === m));
    b.disabled = (m === 'terminal' && !r.attachable) || (m !== 'chat' && r.kind === 'seed');
    b.title = b.disabled ? 'Available while the helper is running' : hint;
    b.onclick = () => {
      if (state.mode === m) return;
      if (state.term) closeTerminal();
      state.changes.for = '';
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
  items.push(['Send to another helper…', '', () => deliverDialog(r)]);
  items.push(['Export conversation…', '', () => App.ExportConversation(t, r.name).then((p) => { if (p) toast(`Saved to ${p.replace(/^\/Users\/[^/]+/, '~')}`); }, (e) => toast(friendly(e), true))]);
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
    const mid = `${m.at}|${m.from}|${m.question || m.file || ''}|${m.open ? 1 : 0}|${(m.text || '').slice(0, 60)}`;
    if (m.from === 'you') { out.push(Object.assign(el('div', 'msg-you', m.text), { _mid: mid })); continue; }
    const h = el('div', 'msg-helper');
    const meta = el('div', 'meta');
    meta.append(el('b', '', helperName(r.name)), clock(m.at));
    const text = el('div', 'text');
    if (m.question && m.action) {
      text.append(m.text);
      text.append(actionCard(r, m));
    } else if (m.question) {
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
    } else if (m.file) {
      if (m.text) text.append(m.text);
      text.append(shownEl(r, m.file));
    } else {
      text.append(m.text);
    }
    h.append(glyph(m.open ? 'ask' : 'grow', 16, { tile: true }), meta, text);
    h._mid = mid;
    out.push(h);
  }
  if (r.kind === 'grow' && !r.question) {
    const w = el('div', 'working');
    w.append(el('span', 'spin'), r.activity || r.title || 'Working…');
    out.push(w);
  }
  if (r.kind === 'fail' && r.message) out.push(el('div', 'problem', r.message));
  if (r.paused) {
    // A resting helper reads nothing until it's resumed; say so where
    // the message just went.
    const n = el('div', 'resting');
    n.append(el('span', '', `${helperName(r.name)} is resting. Messages wait in its inbox and it reads them when you resume it.`));
    const b = el('button', 'btn small', 'Resume');
    b.onclick = () => run(`${helperName(r.name)} resumed`, () => App.Resume(targetOf(r.key), r.name));
    n.append(b);
    out.push(n);
  }
  if (r.kind === 'seed') { const w = el('div', 'working'); w.append(el('span', 'spin'), r.stage ? `${r.stage[0].toUpperCase()}${r.stage.slice(1)}…` : 'Starting up…'); out.push(w); }
  if (!msgs.length && r.kind !== 'grow' && r.kind !== 'seed') out.push(el('div', 'day', 'No messages yet.'));
  const forId = `${r.key}/${r.name}`;
  const fresh = seen.msgsFor !== forId;
  const ids = new Set();
  for (const n of out) {
    if (!n._mid) continue;
    ids.add(n._mid);
    if (!fresh && !seen.msgs.has(n._mid)) n.classList.add('enter');
  }
  seen.msgs = ids;
  seen.msgsFor = forId;
  inner.replaceChildren(...out);
}

/* Files a helper showed you (show_user). They stay in the helper's pod;
   each is read once per session of the app and kept as a data URL, so the
   chat's re-renders don't fetch again. */

const shownCache = new Map();
const isImage = (type) => /^image\/(png|jpeg|gif|webp|svg\+xml)/.test(type || '');
const fileName = (p) => p.split('/').pop();
const sizeLabel = (n) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function loadShown(r, file) {
  const k = `${r.key}/${r.name}|${file}`;
  let c = shownCache.get(k);
  if (c) return c;
  c = { state: 'loading' };
  shownCache.set(k, c);
  App.ReadShown(targetOf(r.key), r.name, file).then((f) => {
    Object.assign(c, { state: 'ok', type: f.type, size: f.size, url: `data:${f.type.split(';')[0]};base64,${f.data}` });
  }, (e) => {
    Object.assign(c, { state: 'error', error: friendly(e) });
    shownCache.delete(k); // try again on the next render
    shownCache.set(`${k}|failed`, c);
  }).finally(() => {
    for (const n of document.querySelectorAll('.shown')) if (n.dataset.k === k) n.replaceWith(shownEl(r, file));
  });
  return c;
}

function saveShown(r, file) {
  App.SaveShown(targetOf(r.key), r.name, file).then((dest) => { if (dest) toast(`Saved to ${dest.replace(/^\/Users\/[^/]+/, '~')}`); }, (e) => toast(friendly(e), true));
}

function shownEl(r, file) {
  const k = `${r.key}/${r.name}|${file}`;
  const c = shownCache.get(k) || shownCache.get(`${k}|failed`) || loadShown(r, file);
  const box = el('div', 'shown');
  box.dataset.k = k;
  if (c.state === 'ok' && isImage(c.type)) {
    const img = el('img');
    img.src = c.url;
    img.alt = fileName(file);
    const b = el('button', 'shown-img');
    b.title = 'Open';
    b.append(img);
    b.onclick = () => openViewer(r, file, c);
    box.append(b);
    return box;
  }
  const chip = el('div', 'shown-file');
  chip.append(el('span', 'shown-icon', (fileName(file).split('.').pop() || 'file').slice(0, 4)));
  const info = el('div', 'shown-info');
  info.append(el('b', '', fileName(file)), el('span', '',
    c.state === 'loading' ? 'Loading…' : c.state === 'error' ? c.error : `${sizeLabel(c.size)} · ${file}`));
  chip.append(info);
  if (c.state === 'error') {
    const again = el('button', 'btn ghost', 'Try again');
    again.onclick = () => { shownCache.delete(`${k}|failed`); box.replaceWith(shownEl(r, file)); };
    chip.append(again);
  } else if (c.state === 'ok') {
    const save = el('button', 'btn ghost', 'Save…');
    save.onclick = () => saveShown(r, file);
    chip.append(save);
  }
  box.append(chip);
  return box;
}

function openViewer(r, file, c) {
  const d = $('#viewer');
  $('#viewer-name').textContent = fileName(file);
  $('#viewer-img').src = c.url;
  $('#viewer-img').alt = fileName(file);
  $('#viewer-save').onclick = () => saveShown(r, file);
  openModal(d);
}
$('#viewer-close').onclick = () => dismiss($('#viewer'));

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
      if (r.paused) toast(`Delivered. ${helperName(r.name)} reads it when you resume it.`);
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
  const attach = el('button', 'attach');
  attach.setAttribute('aria-label', 'Send files');
  attach.title = 'Send files (or drop them here)';
  attach.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 11.5 12.6 19a5 5 0 0 1-7.1-7.1l7.8-7.8a3.3 3.3 0 0 1 4.7 4.7l-7.6 7.6a1.7 1.7 0 0 1-2.4-2.4l7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  attach.onclick = () => upload(r, null);
  inner.prepend(attach);
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
  ask({ title: `Remove ${helperName(r.name)}?`, body: 'It stops, and its files and conversation are deleted. This can’t be undone.', ok: 'Remove' }).then((yes) => {
    if (!yes) return;
    closeTerminal();
    state.sel = null;
    run(`${helperName(r.name)} removed`, () => App.Delete(targetOf(r.key), r.name));
  });
}

/* Permission requests: a helper asked to do something with your access
   (open a port, start another helper). The card says what, in words, and
   Allow carries it out as you. */

// Every parameter Allow will use is shown, by name: the card is the only
// place you see what you're authorizing. A custom container image or user
// gets a warning; parameters the app doesn't know are shown as they are.
const ACTION_LABELS = {
  exposePort: { title: (p) => `Open port ${p.port || '?'}`, fields: { port: 'Port', name: 'Name', pod: 'Pod', session: 'Helper' } },
  createSession: { title: () => 'Start another helper', fields: { task: 'Task', repo: 'Project', image: 'Container image', cpu: 'CPUs', memory: 'Memory', user: 'Runs as user', name: 'Name' } },
  enableFeature: { title: (p) => `Turn on ${p.feature || 'a feature'}`, fields: { feature: 'Feature' } },
};

function actionDetails(a) {
  // Own properties only: a parameter named "constructor" or "toString"
  // must show like any other, not vanish into Object.prototype.
  const kind = Object.hasOwn(ACTION_LABELS, a.type) ? ACTION_LABELS[a.type] : null;
  const p = a.params || {};
  const rows = [];
  const warn = [];
  const known = kind?.fields || {};
  const isKnown = (k) => Object.hasOwn(known, k);
  for (const k of [...Object.keys(known), ...Object.keys(p).filter((k) => !isKnown(k)).sort()]) {
    if (!Object.hasOwn(p, k) || p[k] == null || p[k] === '') continue;
    const v = p[k];
    if (typeof v !== 'string') warn.push(`“${k}” isn’t plain text; it’s shown as sent.`);
    rows.push([isKnown(k) ? known[k] : k, typeof v === 'string' ? v : JSON.stringify(v, null, 2)]);
  }
  if (a.type === 'createSession' && p.image) warn.push('It asks for its own container image, not the garden’s default.');
  if (a.type === 'createSession' && p.user) warn.push(`It asks to run as user ${p.user}.`);
  if (!kind) warn.push(`The app doesn’t know “${a.type}” requests; read the details before allowing.`);
  return { title: kind ? kind.title(p) : a.type, rows, warn };
}

function actionCard(r, m) {
  const { title: what, rows, warn } = actionDetails(m.action);
  const card = el('div', 'ask-card action' + (m.open ? '' : ' answered'));
  card.append(el('b', 'act-what', what));
  if (rows.length) {
    const dl = el('dl', 'act-params');
    for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v));
    card.append(dl);
  }
  for (const w of warn) card.append(el('div', 'act-warn', w));
  if (m.open) {
    const opts = el('div', 'opts');
    const allow = el('button', 'btn small allow', 'Allow');
    allow.onclick = () => answer(r, m, 'allow');
    const deny = el('button', 'btn small', 'Deny');
    deny.onclick = () => answer(r, m, 'deny');
    opts.append(allow, deny);
    card.append(opts);
  } else {
    const a = el('div', 'answer');
    const allowed = /^(allow|yes)$/i.test(m.answer || '');
    a.append(allowed ? 'You allowed it' : m.answer ? 'You denied it' : 'No longer waiting');
    const res = m.action.result || '';
    if (allowed && res) {
      a.append(': ');
      if (/^https?:\/\//.test(res)) {
        const link = el('button', 'linkish', res);
        link.onclick = () => BrowserOpenURL(res);
        a.append(link);
      } else a.append(res);
    }
    card.append(a);
  }
  return card;
}

/* Changes: what the helper changed in its project, read live from its
   workspace (committed work on its branch plus anything not committed
   yet). Read when the tab opens and on Refresh, not on every tick. */

async function loadChanges(r, keepSel = false) {
  const c = state.changes;
  const forId = `${r.key}/${r.name}`;
  if (c.for !== forId) Object.assign(c, { data: null, sel: '', patch: null, error: '' });
  c.for = forId;
  c.loading = true;
  redrawChanges(r);
  try {
    c.data = await App.Changes(targetOf(r.key), r.name);
    c.error = '';
  } catch (e) { c.error = friendly(e); }
  c.loading = false;
  if (state.changes.for !== forId) return;
  const files = c.data?.files || [];
  if (!keepSel || !files.some((f) => f.path === c.sel)) c.sel = files[0]?.path || '';
  if (c.sel) await loadPatch(r, c.sel); else redrawChanges(r);
}

async function loadPatch(r, path) {
  const c = state.changes;
  const forId = c.for;
  c.sel = path;
  c.patch = { loading: true };
  redrawChanges(r);
  let p;
  try { p = await App.FilePatch(targetOf(r.key), r.name, path); } catch (e) { p = { error: friendly(e) }; }
  if (state.changes.for !== forId || c.sel !== path) return;
  c.patch = p;
  redrawChanges(r);
}

function redrawChanges(r) {
  const old = document.querySelector('#pane-body .changes');
  if (old && state.mode === 'changes') old.replaceWith(changesEl(r));
}

function changesEl(r) {
  const c = state.changes;
  const d = c.for === `${r.key}/${r.name}` ? c.data : null;
  const box = el('div', 'changes');
  const head = el('div', 'ch-head');
  if (d?.branch) head.append(el('span', 'ch-branch', d.branch));
  const files = d?.files || [];
  if (files.length) {
    const sum = el('span', 'ch-sum');
    sum.append(`${files.length} file${files.length === 1 ? '' : 's'} `, el('b', 'plus', `+${d.added}`), ' ', el('b', 'minus', `−${d.deleted}`));
    head.append(sum);
  }
  if ((d?.bundles || []).length) head.append(el('span', 'ch-out', `${d.bundles.length} finished bundle${d.bundles.length === 1 ? '' : 's'} waiting to be pushed`));
  head.append(el('div', 'fill'));
  const again = el('button', 'btn small ghost', c.loading ? 'Reading…' : 'Refresh');
  again.disabled = !!c.loading;
  again.onclick = () => loadChanges(r, true);
  const pull = el('button', 'btn small', 'Pull…');
  pull.title = 'Copy the project, with its history and uncommitted changes, into a new folder on this computer. The helper’s own git settings and hooks stay behind.';
  pull.disabled = !(r.phase === 'Running' && !r.paused) || !!d?.note;
  pull.onclick = () => run('', async () => {
    toast('Pulling…');
    const res = await App.Pull(targetOf(r.key), r.name);
    if (res?.dest) toast(`Pulled into ${res.dest.replace(/^\/Users\/[^/]+/, '~')}${res.note ? `. ${res.note}` : ''}`, !!res.note);
  });
  head.append(again, pull);
  box.append(head);

  const note = c.error || d?.note || (!d ? '' : !files.length ? 'Nothing changed yet.' : '');
  if (!d && !c.error) { const w = el('div', 'ch-note'); w.append(el('span', 'spin'), 'Reading the workspace…'); box.append(w); return box; }
  if (note) { box.append(el('div', 'ch-note' + (c.error ? ' bad' : ''), note)); return box; }

  const body = el('div', 'ch-body');
  const list = el('div', 'ch-files');
  for (const f of files) {
    const b = el('button', 'ch-file');
    b.setAttribute('aria-current', String(f.path === c.sel));
    const i = f.path.lastIndexOf('/');
    const name = el('span', 'ch-name');
    if (i >= 0) name.append(el('span', 'ch-dir', f.path.slice(0, i + 1)));
    name.append(f.path.slice(i + 1));
    const size = el('span', 'ch-size');
    if (f.added < 0) size.append('binary');
    else size.append(el('b', 'plus', `+${f.added}`), ' ', el('b', 'minus', `−${f.deleted}`));
    const dot = el('span', 'ch-dot' + (f.committed ? ' on' : ''));
    dot.title = f.committed ? 'Committed on its branch' : 'Not committed yet';
    b.append(dot, name, size);
    b.title = f.path;
    b.onclick = () => loadPatch(r, f.path);
    list.append(b);
  }
  body.append(list, patchEl(c.patch));
  box.append(body);
  return box;
}

function patchEl(p) {
  const view = el('div', 'ch-patch');
  if (!p || p.loading) { const w = el('div', 'ch-note'); w.append(el('span', 'spin'), 'Loading…'); view.append(w); return view; }
  if (p.error) { view.append(el('div', 'ch-note bad', p.error)); return view; }
  const lines = (p.text || '').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const table = el('div', 'diff');
  let a = 0;
  let b = 0;
  let started = false;
  for (const l of lines) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(l);
    if (h) {
      started = true;
      a = Number(h[1]);
      b = Number(h[2]);
      const row = el('div', 'dl hunk');
      row.append(el('span', 'ln', '⋯'), el('span', 'ln', '⋯'), el('span', 'tx', h[3].trim() || ' '));
      table.append(row);
      continue;
    }
    if (!started) {
      if (/^Binary files/.test(l)) table.append(el('div', 'ch-note', 'A binary file: no text to compare.'));
      continue;
    }
    if (l.startsWith('\\')) continue; // "\ No newline at end of file"
    const kind = l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx';
    const row = el('div', `dl ${kind}`);
    row.append(el('span', 'ln', kind === 'add' ? '' : String(a)), el('span', 'ln', kind === 'del' ? '' : String(b)), el('span', 'tx', l.slice(1) || ' '));
    if (kind !== 'add') a++;
    if (kind !== 'del') b++;
    table.append(row);
  }
  if (!table.children.length) table.append(el('div', 'ch-note', 'No differences in text.'));
  view.append(table);
  if (p.cut) view.append(el('div', 'ch-note', 'This change is long: the rest is cut. Pull the project to see all of it.'));
  return view;
}

/* Sending files: drop them on the conversation, or press the paper clip.
   They land in the helper's /workspace/uploads and it's told where. */

async function upload(r, paths) {
  const t = targetOf(r.key);
  try {
    if (paths) toast(paths.length === 1 ? `Sending ${paths[0].split('/').pop()}…` : `Sending ${paths.length} files…`);
    const sent = await (paths ? App.Upload(t, r.name, paths) : App.PickUpload(t, r.name));
    if (!sent || !sent.length) return;
    toast(sent.length === 1 ? `Sent ${sent[0].split('/').pop()} to ${helperName(r.name)}` : `Sent ${sent.length} files to ${helperName(r.name)}`);
    refresh();
  } catch (e) { toast(friendly(e), true); }
}

try {
  OnFileDrop((x, y, paths) => {
    const r = selectedRow();
    if (!r || state.view !== 'helpers' || !paths?.length) return;
    if (isTermMode(state.mode)) { toast('Drop files on the chat to send them', true); return; }
    upload(r, paths);
  }, true);
} catch { /* no native drop (web build) */ }

/* Several helpers at once. */

const unfinished = (r) => r.kind !== 'done' && r.kind !== 'fail' && !r.command;

// manyDialog sends one message to the helpers you tick (all unfinished
// ones to start with), across gardens.
function manyDialog() {
  const rows = allRows().filter(unfinished);
  if (!rows.length) { toast('No helpers to message', true); return; }
  const form = el('form');
  form.className = 'many';
  const list = el('div', 'many-list');
  const all = el('label', 'check many-all');
  const allBox = el('input');
  allBox.type = 'checkbox';
  allBox.checked = true;
  all.append(allBox, `All ${rows.length} helpers`);
  const boxes = [];
  for (const t of state.targets) {
    const mine = rows.filter((r) => r.key === keyOf(t));
    if (!mine.length) continue;
    list.append(el('div', 'many-garden', gardenName(t)));
    for (const r of mine) {
      const l = el('label', 'check');
      const c = el('input');
      c.type = 'checkbox';
      c.checked = true;
      c._r = r;
      boxes.push(c);
      l.append(c, helperName(r.name), el('span', 'many-what', r.paused ? 'resting: reads it on resume' : (r.title || r.task || '')));
      list.append(l);
    }
  }
  const count = () => boxes.filter((c) => c.checked).length;
  allBox.onchange = () => { for (const c of boxes) c.checked = allBox.checked; sync(); };
  const ta = el('textarea');
  ta.rows = 3;
  ta.placeholder = 'Demo at 10: wrap up and open pull requests';
  const label = el('label', 'field');
  label.append('Message', ta);
  const send = el('button', 'btn primary');
  send.type = 'submit';
  const sync = () => {
    const n = count();
    allBox.checked = n === boxes.length;
    allBox.indeterminate = n > 0 && n < boxes.length;
    send.textContent = n ? `Send to ${n}` : 'Send';
    send.disabled = !n || !ta.value.trim();
  };
  for (const c of boxes) c.onchange = sync;
  ta.oninput = sync;
  sync();
  form.append(all, list, label, actionsRow(wbtn('Cancel', 'ghost', () => dismiss($('#wizard'))), send));
  form.onsubmit = async (e) => {
    e.preventDefault();
    send.disabled = true;
    try {
      const to = boxes.filter((c) => c.checked).map((c) => ({ target: targetOf(c._r.key), session: c._r.name }));
      const res = await App.SendMany(to, ta.value);
      $('#wizard').close();
      const ok = (res.delivered || []).length;
      const bad = res.failed || [];
      toast(bad.length ? `Sent to ${ok}. Not delivered: ${bad.join('; ')}` : `Sent to ${ok} helper${ok === 1 ? '' : 's'}`, bad.length > 0);
      refresh();
    } catch (err) { toast(friendly(err), true); sync(); }
  };
  wizard(el('h2', '', 'Message several helpers'), form);
}
$('#many-btn').onclick = manyDialog;

// deliverDialog passes a note, and optionally a file from this helper's
// workspace, to another helper.
function deliverDialog(r) {
  const others = allRows().filter((x) => unfinished(x) && !(x.key === r.key && x.name === r.name));
  if (!others.length) { toast('There’s no other helper to send to', true); return; }
  const form = el('form');
  form.style.cssText = 'padding:0;display:flex;flex-direction:column;gap:13px';
  const to = el('label', 'field');
  to.append('To');
  const sel = el('select');
  for (const x of others) sel.append(new Option(`${helperName(x.name)} · ${gardenName(targetOf(x.key))}`, `${x.key}|${x.name}`));
  to.append(sel);
  const note = el('label', 'field');
  const ta = el('textarea');
  ta.rows = 3;
  ta.placeholder = `What ${helperName(r.name)} found, or what to do next`;
  note.append('Note', ta);
  const file = field('File from ' + helperName(r.name), 'file', { placeholder: 'notes/findings.md (in its project) or a full path' }, 'optional');
  const send = el('button', 'btn primary', 'Send');
  send.type = 'submit';
  form.append(to, note, file, el('p', 'hint', 'The file is copied into the other helper’s uploads folder, and it’s told where. Up to 25 MB.'),
    actionsRow(wbtn('Cancel', 'ghost', () => dismiss($('#wizard'))), send));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const [key, name] = sel.value.split('|');
    send.disabled = true;
    try {
      await App.Deliver({ target: targetOf(r.key), session: r.name }, { target: targetOf(key), session: name }, ta.value, new FormData(form).get('file') || '');
      $('#wizard').close();
      toast(`Sent to ${helperName(name)}`);
      refresh();
    } catch (err) { toast(friendly(err), true); send.disabled = false; }
  };
  wizard(el('h2', '', `Send from ${helperName(r.name)} to another helper`), form);
}

/* Modals: one rule for every dialog. A click on the dimmed area, Esc or
   Cancel closes it; if anything was typed or changed, it asks first. A
   dialog marked data-lock (setup running) stays open. */

const fieldsOf = (d) => [...d.querySelectorAll('input, textarea, select')]
  .map((f) => (f.type === 'checkbox' || f.type === 'radio' ? f.checked : f.value)).join('\u0001');
// settle remembers what the fields hold now, so only the person's own
// edits count as "something entered".
const settle = (d) => { d._snap = fieldsOf(d); };
const modals = []; // open dialogs, topmost last
function openModal(d) {
  if (!d.open) { d.showModal(); modals.push(d); }
  settle(d);
}

// ask is the small confirm dialog; it resolves true on the danger button.
function ask({ title, body, ok, keep = 'Keep' }) {
  const d = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  $('#confirm-ok').textContent = ok;
  $('#confirm-keep').textContent = keep;
  d.returnValue = '';
  openModal(d);
  // A close event from an earlier ask can arrive after this one opened;
  // it's stale while the dialog is open again.
  return new Promise((resolve) => { d.onclose = () => { if (!d.open) resolve(d.returnValue === 'ok'); }; });
}

async function dismiss(d) {
  const c = $('#confirm-dialog');
  if (d.dataset.lock || (d !== c && c.open)) return;
  if (d._snap != null && fieldsOf(d) !== d._snap) {
    const yes = await ask({ title: 'Discard what you entered?', body: 'Closing this window loses it.', ok: 'Discard', keep: 'Keep editing' });
    if (!yes) return;
  }
  d.close('cancel');
}

for (const d of document.querySelectorAll('dialog')) {
  // Only a press and release both outside the box count, so dragging a
  // text selection out of a field doesn't close anything.
  const outside = (e) => {
    const r = d.getBoundingClientRect();
    return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
  };
  let downOutside = false;
  d.addEventListener('pointerdown', (e) => { downOutside = outside(e); });
  d.addEventListener('click', (e) => { if (downOutside && outside(e)) dismiss(d); downOutside = false; });
  d.addEventListener('cancel', (e) => { e.preventDefault(); dismiss(d); });
  d.addEventListener('close', () => { const i = modals.indexOf(d); if (i >= 0) modals.splice(i, 1); });
}
// Esc goes to the topmost dialog wherever focus is. Handled here because
// the browser only lets a page cancel its own Esc-close once.
document.addEventListener('keydown', (e) => {
  const top = modals.filter((d) => d.open).pop();
  if (e.key !== 'Escape' || !top) return;
  e.preventDefault();
  e.stopPropagation();
  dismiss(top);
}, true);

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
  // Below the button, or above it when there's no room (the ? button sits
  // at the bottom of the rail).
  const below = r.bottom + 6;
  m.style.top = `${below + m.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - 6 - m.offsetHeight) : below}px`;
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

const isTermMode = (m) => m === 'terminal' || m === 'shell';

async function openTerminal(r, wrap, kind = 'terminal') {
  if (state.term && state.term.kind === kind) { wrap.append(state.term.host); state.term.fit.fit(); state.term.term.focus(); return; }
  if (state.term) closeTerminal();
  const host = el('div', 'term');
  wrap.append(host);
  const term = new Terminal({ fontFamily: "'Geist Mono Variable', ui-monospace, Menlo, monospace", fontSize: 12.5, lineHeight: 1.15, cursorBlink: true, allowProposedApi: true, theme, scrollback: 0 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  const entry = { id: null, key: r.key, name: r.name, kind, term, fit, host, closed: false };
  state.term = entry;
  const shell = kind === 'shell';
  term.write(`\x1b[2m${shell ? (r.phase === 'Running' && !r.paused ? `opening a shell beside ${helperName(r.name)}…` : `starting a shell on ${helperName(r.name)}’s files (it’s not running, so this takes a moment)…`) : `connecting to ${helperName(r.name)}…`}\x1b[0m\r\n`);
  // A helper that was just started isn't attachable until its agent
  // container runs. The app answers "starting: <step>" meanwhile; show each
  // new step and try again. Other errors get a few retries, then show.
  let last = '';
  for (let fails = 0; ;) {
    try {
      entry.id = await (shell ? App.OpenShell : App.OpenTerminal)(targetOf(r.key), r.name, term.cols, term.rows);
      if (state.term !== entry) { App.CloseTerminal(entry.id); return; } // left while connecting
      break;
    } catch (e) {
      if (state.term !== entry) return;
      const msg = String(e?.message ?? e);
      if (msg.startsWith('starting: ')) {
        const step = msg.slice(10);
        if (step !== last) term.write(`\x1b[2m${step}…\x1b[0m\r\n`);
        last = step;
      } else if (++fails >= 5) {
        term.write(`\r\n\x1b[31m${friendly(e)}\x1b[0m\r\n`);
        entry.closed = true;
        return;
      }
      await new Promise((ok) => setTimeout(ok, 2000));
      if (state.term !== entry) return;
    }
  }
  if (last) term.write('\x1b[2mready\x1b[0m\r\n');
  EventsOn(`term:${entry.id}`, (b64) => term.write(fromB64(b64)));
  EventsOn(`term-closed:${entry.id}`, (reason) => {
    entry.closed = true;
    term.write(`\r\n\x1b[2m[${shell && !reason ? 'shell closed' : 'disconnected'}${reason ? `: ${reason}` : ''}]\x1b[0m\r\n`);
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
      let gs = null;
      try { v = await App.Health(g.target); } catch { /* unreachable */ }
      if (v) { try { gs = await App.GardenSettings(g.target); } catch { /* shown in the sheet */ } }
      h = state.health[key] = { h: v, gs, at: Date.now() };
    }
    return gardenRow(g, f, h.h, h.gs);
  }));
  $('#gv-rows').replaceChildren(...rows);
}

function gardenRow(g, f, h, gs) {
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
    const set = el('button', 'icon-btn', '');
    set.setAttribute('aria-label', `${gardenName(t)} settings`);
    set.title = 'Garden settings';
    set.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    set.onclick = () => gardenSettings(t);
    actions.append(b, set);
  }
  row.append(glyph(kind, 20, { tile: true }), name, status, helpers, disk, actions);

  const notes = [];
  if (asleep) h = null;
  if (n?.diskPressure) notes.push(['bad', 'Out of disk: new helpers can’t start until space is freed on this computer.']);
  if (h && (h.runtimeMissing || []).length) notes.push(['', 'An update is available for this garden.', 'Update', async () => { await App.UpgradeRuntime(t); toast('Updated'); state.health = {}; renderGardens(); }]);
  if (h && !h.sandbox && h.sandboxAvailable) notes.push(['', 'Helpers here run without the sandbox, though it’s installed.', 'Turn on', async () => { await App.SetSandbox(t, true); toast('Sandbox on: new helpers run sealed off'); state.health = {}; renderGardens(); }]);
  if (h && h.signIn === 'none') notes.push(['', 'Helpers can’t sign in here yet.', 'copy']);
  const fresh = unseenRefusals(t, gs);
  if (!asleep && fresh.length) notes.push(['', `Helpers here were turned away from ${fresh.length === 1 ? fresh[0].host : `${fresh.length} sites`} not on your list.`, 'Review', async () => gardenSettings(t)]);
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

/* Garden settings: internet access and Claude sign-in */

// Refusals the person has already looked at, per garden, so the Gardens
// view only asks about new ones.
const seenKey = (t) => `refusals-seen:${keyOf(t)}`;
function seenRefusals(t) {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey(t)) || '[]')); } catch { return new Set(); }
}
function markRefusalsSeen(t, gs) {
  try { localStorage.setItem(seenKey(t), JSON.stringify([...new Set([...seenRefusals(t), ...(gs?.refused || []).map((r) => r.host)])])); } catch { /* private window */ }
}
function unseenRefusals(t, gs) {
  if (!gs || gs.egress?.mode !== 'allowlist') return [];
  const seen = seenRefusals(t);
  return (gs.refused || []).filter((r) => !seen.has(r.host));
}

const EGRESS = {
  open: ['Anywhere', 'Helpers can reach any address on any port.'],
  fenced: ['Web only', 'Helpers can reach websites (ports 80 and 443) and nothing else outside this garden.'],
  allowlist: ['Sites you allow', 'Helpers reach only the sites below. Everything else is refused and listed here for you to decide.'],
};

async function gardenSettings(t) {
  let gs;
  try { gs = await App.GardenSettings(t); } catch (e) { toast(friendly(e), true); return; }
  state.health[keyOf(t)] = { ...(state.health[keyOf(t)] || {}), gs };
  markRefusalsSeen(t, gs);
  const body = el('div', 'gs');
  const again = async (done) => {
    if (done) toast(done);
    try { gs = await App.GardenSettings(t); } catch (e) { toast(friendly(e), true); return; }
    markRefusalsSeen(t, gs);
    draw();
  };
  const act = (fn, done) => async () => {
    try { await fn(); await again(done); } catch (e) { toast(friendly(e), true); }
  };
  function draw() {
    const eg = gs.egress || {};
    const net = el('section', 'gs-sec');
    net.append(el('h3', '', 'Internet access'));
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'What helpers may reach');
    for (const [mode, [label]] of Object.entries(EGRESS)) {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(eg.mode === mode));
      b.onclick = async () => {
        if (eg.mode === mode) return;
        if (mode === 'open' && !(await ask({ title: 'Let helpers reach anything?', body: 'Helpers could connect to any address on any port, including services on your own network.', ok: 'Allow everything', keep: 'Cancel' }))) return;
        b.disabled = true;
        await act(() => App.SetEgressMode(t, mode), `${gardenName(t)}: ${label.toLowerCase()}`)();
      };
      seg.append(b);
    }
    net.append(seg, el('p', 'hint', EGRESS[eg.mode]?.[1] || ''));
    if (/NOT ENFORCED/.test(eg.enforced || '')) net.append(el('p', 'hint bad', 'This computer’s network doesn’t enforce the limit, so helpers aren’t actually held to it.'));
    if (eg.mode === 'allowlist') {
      if (eg.proxy && eg.proxy !== 'running') net.append(el('p', 'hint warn', eg.proxy === 'starting' ? 'The filter is starting: helpers can reach nothing until it’s up.' : `The filter isn’t running: ${eg.proxy}`));
      const add = el('form', 'gs-add');
      const inp = el('input');
      Object.assign(inp, { placeholder: 'example.com, or .example.com for its subdomains too', spellcheck: false, autocomplete: 'off' });
      inp.setAttribute('autocapitalize', 'off');
      inp.setAttribute('aria-label', 'Site to allow');
      const go = el('button', 'btn small', 'Allow');
      add.append(inp, go);
      add.onsubmit = (e) => { e.preventDefault(); const h = inp.value.trim(); if (h) act(() => App.AllowHost(t, h), `${h} allowed: helpers can reach it within a minute or two`)(); };
      const list = el('ul', 'gs-hosts');
      for (const h of eg.hosts || []) {
        const li = el('li');
        const x = el('button', 'icon-btn', '');
        x.title = `Remove ${h}`;
        x.setAttribute('aria-label', `Remove ${h}`);
        x.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        x.onclick = act(() => App.RemoveHost(t, h), `${h} removed`);
        li.append(el('span', '', h), x);
        list.append(li);
      }
      if (!(eg.hosts || []).length) list.append(el('li', 'hint', 'Nothing allowed yet.'));
      net.append(add, list);
      const refused = gs.refused || [];
      if (refused.length) {
        net.append(el('h4', '', 'Turned away lately'));
        const rl = el('ul', 'gs-refused');
        for (const r of refused.slice(0, 20)) {
          const li = el('li');
          const what = el('div');
          what.append(el('b', '', r.host), el('span', 'hint', `${r.count}× · last ${clock(r.last)}${r.lookup ? ' · looked up, not connected: allowing it may not help' : ''}`));
          const ok = el('button', 'btn small', 'Allow');
          ok.onclick = act(() => App.AllowHost(t, r.host), `${r.host} allowed`);
          li.append(what, ok);
          rl.append(li);
        }
        net.append(rl, el('p', 'hint', 'A helper asking for a site nobody expected is worth a look before you allow it.'));
      }
    }

    const key = el('section', 'gs-sec');
    key.append(el('h3', '', 'Claude sign-in'));
    const m = gs.model || {};
    const row = (...b) => { const a = el('div', 'gs-acts'); a.append(...b); return a; };
    const btn = (label, fn, cls = 'btn small') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };
    if (m.mode === 'gateway') {
      key.append(el('p', '', 'Your key stays in this garden’s site filter, which adds it to Claude requests on the way out. Helpers never hold it.'));
      key.append(row(btn('Give helpers the key again', act(() => App.SetGateway(t, false), 'Helpers hold the key again: new ones pick it up'))));
    } else if (m.mode === 'federation') {
      key.append(el('p', '', 'Helpers sign in through a Claude Console federation rule. No key is stored here.'));
      key.append(el('p', 'hint', `Rule ${m.federation?.rule || ''} · organization ${m.federation?.organization || ''}`));
      if (m.leftover) key.append(el('p', 'hint warn', 'An old key is still stored here, unused, where helpers could read it.'));
      key.append(row(
        ...(m.leftover ? [btn('Remove the old key', async () => { if (await ask({ title: 'Remove the stored key?', body: 'Helpers keep signing in through federation. To go back to a key later, add it again.', ok: 'Remove', keep: 'Keep' })) act(() => App.RemoveStoredKey(t), 'Key removed')(); })] : []),
        btn('Turn off federation', act(() => App.ClearFederation(t), 'Federation off: helpers use a stored key')),
      ));
    } else {
      key.append(el('p', '', m.mode === 'none' ? 'Helpers can’t sign in here yet.' : 'Each helper holds your key while it works.'));
      const acts = [];
      if (m.mode === 'none') acts.push(btn('Add key', () => signInDialog(t), 'btn small primary'));
      else {
        const gw = btn('Keep the key out of helpers', act(() => App.SetGateway(t, true), 'Key moved: new helpers never hold it'));
        if (eg.mode !== 'allowlist') { gw.disabled = true; gw.title = 'Needs “Sites you allow” above: the key lives in that filter'; }
        acts.push(gw);
      }
      acts.push(btn('Use federation…', () => fedForm()));
      key.append(row(...acts));
      if (m.mode !== 'none' && eg.mode !== 'allowlist') key.append(el('p', 'hint', 'Keeping the key out of helpers needs “Sites you allow”: the filter is where the key lives.'));
    }
    body.replaceChildren(net, key);
  }
  function fedForm() {
    const form = el('form');
    form.style.cssText = 'padding:0;display:flex;flex-direction:column;gap:12px';
    form.append(
      field('Federation rule', 'rule', { placeholder: 'fdrl_…', required: true }),
      field('Organization', 'organization', { placeholder: 'the organization ID from the Claude Console', required: true }),
      field('Service account', 'serviceAccount', { placeholder: 'svac_…' }, 'optional'),
      field('Workspace', 'workspace', { placeholder: 'wrkspc_…' }, 'needed when the rule covers several'),
      el('p', 'hint', 'Create the rule in the Claude Console for this garden’s service account tokens. None of these IDs is a secret.'),
    );
    const save = el('button', 'btn primary', 'Use federation');
    save.type = 'submit';
    form.append(actionsRow(wbtn('Back', 'ghost', () => gardenSettings(t)), save));
    form.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await App.SetFederation(t, Object.fromEntries(new FormData(form)));
        toast('Federation on: new helpers sign in without a key');
        gardenSettings(t);
      } catch (err) { toast(friendly(err), true); save.disabled = false; }
    };
    wizard(el('h2', '', `Federation for ${gardenName(t)}`), form);
  }
  draw();
  wizard(el('h2', '', `${gardenName(t)} settings`), body, actionsRow(wbtn('Done', 'primary', () => { $('#wizard').close(); state.health = {}; if (state.view === 'gardens') renderGardens(); })));
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
    ['Check for updates…', '', checkNow],
    ['Settings', '', openSettings],
    ['Copy diagnostics', '', () => App.CopyDiagnostics().then(() => toast('Diagnostics copied: paste them into your message to support')).catch((err) => toast(friendly(err), true))],
  ]);
};

function openSettings() {
  Promise.all([App.GetSettings(), App.Updater()]).then(([cur, updater]) => {
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
      ...(updater ? [check('autoUpdate', 'Install updates automatically when the app quits', cur.autoUpdate)] : []),
      el('p', 'hint', 'Closing the window keeps Tiny Systems running, so helpers can still reach you. Quit with ⌘Q.'),
    );
    const save = el('button', 'btn primary', 'Save');
    save.type = 'submit';
    form.append(actionsRow(wbtn('Cancel', 'ghost', () => dismiss($('#wizard'))), save));
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const d = new FormData(form);
      try {
        await App.SaveSettings({ openAtLogin: d.has('openAtLogin'), startVMs: d.has('startVMs'), checkUpdates: d.has('checkUpdates'), autoUpdate: d.has('autoUpdate') });
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
  setSource('git');
  newFolder = null;
  showFolder();
  loadPresets();
  openModal($('#new-dialog'));
}

// Presets: saved New helper choices, kept on this Mac.
const PRESET_FIELDS = ['repo', 'agent', 'model', 'image', 'cpu', 'memory', 'sandbox'];
let presets = [];
async function loadPresets(pick = '') {
  try { presets = (await App.Presets()) || []; } catch { presets = []; }
  const sel = $('#new-preset');
  sel.replaceChildren(new Option('None', ''), ...presets.map((p) => new Option(p.name, p.name)));
  sel.value = presets.some((p) => p.name === pick) ? pick : '';
  $('#new-preset-row').hidden = !presets.length;
  $('#preset-forget').hidden = !sel.value;
  $('#preset-name').value = sel.value;
}
$('#new-preset').onchange = () => {
  const p = presets.find((x) => x.name === $('#new-preset').value);
  const f = $('#new-form');
  for (const k of PRESET_FIELDS) if (f.elements[k]) f.elements[k].value = p?.[k] || '';
  if (p?.repo) setSource('git');
  if (p && PRESET_FIELDS.some((k) => k !== 'repo' && p[k])) f.querySelector('details.advanced').open = true;
  $('#preset-forget').hidden = !p;
  $('#preset-name').value = p?.name || '';
};
$('#preset-save').onclick = async () => {
  const f = $('#new-form');
  const p = { name: $('#preset-name').value.trim() };
  for (const k of PRESET_FIELDS) p[k] = (f.elements[k]?.value || '').trim();
  if (f.dataset.source === 'folder') p.repo = '';
  try { await App.SavePreset(p); toast(`Preset ${p.name} saved`); await loadPresets(p.name); } catch (e) { toast(friendly(e), true); }
};
$('#preset-forget').onclick = async () => {
  const name = $('#new-preset').value;
  try { await App.DeletePreset(name); toast(`Preset ${name} forgotten`); await loadPresets(); } catch (e) { toast(friendly(e), true); }
};
$('#new-btn').onclick = () => openNew();

// Where the project comes from: a git URL, or a folder on this Mac (sent
// as it stands), optionally with its Claude Code conversation to continue.
let newFolder = null;
function setSource(v) {
  for (const b of document.querySelectorAll('#new-source button')) b.setAttribute('aria-pressed', String(b.dataset.source === v));
  $('#new-repo').hidden = v !== 'git';
  $('#new-folder').hidden = v !== 'folder';
  $('#new-form').dataset.source = v;
}
for (const b of document.querySelectorAll('#new-source button')) b.onclick = () => setSource(b.dataset.source);
function showFolder() {
  const f = newFolder;
  $('#new-folder-name').textContent = f ? f.path.replace(/^\/Users\/[^/]+/, '~') : 'No folder chosen';
  $('#new-continue-row').hidden = !f?.session;
  $('#new-continue').checked = !!f?.session;
  $('#new-continue-note').textContent = f?.recent ? 'Claude Code wrote to it seconds ago: quit it there first, or the two copies will drift apart.' : 'The helper picks up the conversation where you left it.';
  $('#new-continue-note').classList.toggle('warn', !!f?.recent);
}
$('#new-folder-pick').onclick = async () => {
  try {
    const p = await App.PickFolder('Send this folder to the helper');
    if (!p) return;
    newFolder = await App.Folder(p);
    showFolder();
  } catch (e) { toast(friendly(e), true); }
};
$('#new-cancel').onclick = () => dismiss($('#new-dialog'));
$('#new-form').onsubmit = async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const fromMac = e.target.dataset.source === 'folder';
  if (fromMac && !newFolder) { toast('Choose a folder first', true); return; }
  $('#new-dialog').close();
  const t = targetOf(d.garden);
  try {
    const task = (d.task || '').trim();
    const name = await App.NewSession(t, { task, repo: fromMac ? '' : d.repo, dir: fromMac ? newFolder.path : '', continue: fromMac && $('#new-continue').checked, agent: d.agent, model: d.model, image: d.image, cpu: d.cpu || '', memory: d.memory || '', sandbox: d.sandbox || '' });
    toast(`${helperName(name)} started`);
    setView('helpers');
    await refresh();
    // No task: a blank session, so open straight into its terminal.
    select(keyOf(t), name, task || fromMac ? 'chat' : 'terminal');
  } catch (err) { toast(friendly(err), true); }
};

/* Add a garden: a short guided flow */

const wz = { req: null };
const wizard = (...c) => { const d = $('#wizard'); delete d.dataset.lock; $('#wz').replaceChildren(...c); openModal(d); };
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
  form.append(keyBlock(), actionsRow(wbtn('Cancel', 'ghost', () => dismiss($('#wizard'))), save));
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
  wizard(el('h2', '', 'Add a garden'), el('p', 'lead', 'Where should your helpers live?'), places, actionsRow(wbtn('Cancel', 'ghost', () => dismiss($('#wizard')))));
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
  $('#wizard').dataset.lock = '1'; // setup is running: Close unlocks when it ends
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
  delete $('#wizard').dataset.lock;
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
EventsOn('ship:done', (name, files) => { toast(`${helperName(name)} has the folder (${files} files)`); refresh(); });
EventsOn('ship:failed', (name, why) => { toast(`${helperName(name)} didn’t get the folder: ${why}`, true); refresh(); });

async function reloadTargets() {
  state.targets = (await App.Targets()) || [];
  state.health = {};
  refresh();
}
$('#add-garden').onclick = stepWhere;

/* Updates. A release build has Sparkle, which checks, shows what's new
   and installs (Settings decides whether it waits to be asked). Without
   it (0.1.0, 0.1.1, development builds) a quiet note offers the
   download and the person decides. */

async function checkNow() {
  try { if (await App.CheckForUpdates()) return; } catch {}
  let u;
  try { u = await App.CheckUpdate(); } catch { u = null; }
  if (u && u.available) { try { localStorage.removeItem('update-skipped'); } catch {} checkUpdate(); return; }
  toast(`You have the latest version (${await App.Version()})`);
}

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
