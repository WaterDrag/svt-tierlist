import {
  createEmpty, normalize, unranked, mergeFavorites, toExport, fromImport, newTier, manualItem,
} from './logic.js';

const firebaseConfig = {
  apiKey: 'AIzaSyACdUP5Q-WfsXEGxlSVgdfypPIGzfAdcek',
  authDomain: 'svtextension.firebaseapp.com',
  projectId: 'svtextension',
  storageBucket: 'svtextension.firebasestorage.app',
  messagingSenderId: '1033464931769',
  appId: '1:1033464931769:web:47492e29062fb155dac268',
};
const FB = 'https://www.gstatic.com/firebasejs/11.6.0';
const DEMO = new URLSearchParams(location.search).has('demo');
const DEMO_KEY = 'svt_tier_demo';
const SIZE_KEY = 'svt_tier_size';

const $ = id => document.getElementById(id);

let state = null;
let store = null;      // { save(state) } podle režimu
let saveTimer = null;
let dragging = false;
let waitingSnapshot = null;
let pendingFavs = null;
let sortables = [];
let extensionSeen = false;

function setStatus(text, isError) {
  $('status').textContent = text;
  $('status').classList.toggle('error', !!isError);
}

function favStatus() {
  if (!state) return;
  if (state.favsTs) {
    const kdy = new Date(state.favsTs).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
    const zdroj = extensionSeen ? 'Rozšíření připojeno' : 'Rozšíření tady nenalezeno';
    setStatus(`${zdroj} · oblíbené z ${kdy}`);
  } else if (extensionSeen) {
    setStatus('Rozšíření připojeno, ale ještě nemá oblíbené. Otevři jednou Svět seriálů.');
  } else {
    setStatus('Rozšíření tady nenalezeno, zatím bez oblíbených.');
  }
}

// ── Vykreslení ───────────────────────────────────────────────
function tileEl(id, inTray) {
  const item = state.items[id];
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.id = id;
  el.title = item.title;
  if (item.poster) {
    const img = document.createElement('img');
    img.src = item.poster;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.draggable = false;
    el.append(img);
  }
  const title = document.createElement('div');
  title.className = 'tile-title';
  title.textContent = item.title;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'tile-x';
  x.textContent = '✕';
  const akce = inTray
    ? (item.source === 'manual' ? 'Smazat' : 'Skrýt')
    : 'Vrátit do Nezařazených';
  x.title = akce;
  x.setAttribute('aria-label', `${akce}: ${item.title}`);
  x.addEventListener('click', e => {
    e.stopPropagation();
    if (!inTray) removeFromTiers(id);
    else if (item.source === 'manual') delete state.items[id];
    else state.hidden.push(id);
    commit();
  });
  el.append(title, x);
  if (item.site) {
    const site = document.createElement('span');
    site.className = 'tile-site';
    site.textContent = item.site;
    el.append(site);
  }
  return el;
}

function tierEl(tier, index) {
  const row = document.createElement('section');
  row.className = 'tier';
  row.style.setProperty('--tier', tier.color);

  const head = document.createElement('div');
  head.className = 'tier-head';
  const label = document.createElement('textarea');
  label.className = 'tier-label';
  label.value = tier.label;
  label.maxLength = 24;
  label.rows = tier.label.length > 4 ? 3 : 1;
  label.classList.toggle('long', tier.label.length > 4);
  label.setAttribute('aria-label', 'Název tieru');
  label.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); label.blur(); } });
  label.addEventListener('change', () => { tier.label = label.value.trim(); commit(); });

  const tools = document.createElement('div');
  tools.className = 'tier-tools';
  const tool = (text, title, fn, disabled) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.disabled = !!disabled;
    b.addEventListener('click', fn);
    tools.append(b);
  };
  tool('↑', 'Posunout nahoru', () => moveTier(index, -1), index === 0);
  tool('↓', 'Posunout dolů', () => moveTier(index, 1), index === state.tiers.length - 1);

  const colorLabel = document.createElement('label');
  colorLabel.title = 'Barva';
  colorLabel.textContent = '●';
  const color = document.createElement('input');
  color.type = 'color';
  color.value = tier.color;
  color.setAttribute('aria-label', 'Barva tieru');
  color.addEventListener('change', () => { tier.color = color.value; commit(); });
  colorLabel.append(color);
  tools.append(colorLabel);

  tool('✕', 'Smazat tier', () => {
    if (tier.items.length && !confirm(`Smazat tier „${tier.label}“? Jeho anime se vrátí do Nezařazených.`)) return;
    state.tiers.splice(index, 1);
    commit();
  });
  head.append(label, tools);

  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  tiles.dataset.tier = tier.id;
  tier.items.filter(id => state.items[id]).forEach(id => tiles.append(tileEl(id, false)));

  row.append(head, tiles);
  return row;
}

function render() {
  sortables.forEach(s => s.destroy());
  sortables = [];

  $('tiers').replaceChildren(...state.tiers.map(tierEl));
  const tray = unranked(state);
  $('tray').replaceChildren(...tray.map(id => tileEl(id, true)));
  $('trayCount').textContent = tray.length ? `(${tray.length})` : '';
  $('trayEmpty').hidden = tray.length > 0;

  const hidden = state.hidden.filter(id => state.items[id]);
  $('hiddenWrap').hidden = !hidden.length;
  $('hiddenCount').textContent = `(${hidden.length})`;
  $('hiddenList').replaceChildren(...hidden.map(id => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `↩ ${state.items[id].title}`;
    b.addEventListener('click', () => {
      state.hidden = state.hidden.filter(h => h !== id);
      commit();
    });
    return b;
  }));

  document.querySelectorAll('.tiles').forEach(el => {
    sortables.push(new Sortable(el, {
      group: 'tier',
      animation: 120,
      filter: '.tile-x',
      preventOnFilter: false,
      delay: 120,
      delayOnTouchOnly: true,
      onStart: () => { dragging = true; },
      onEnd: onDragEnd,
    }));
  });
}

function onDragEnd() {
  dragging = false;
  state.tiers.forEach(t => {
    const el = document.querySelector(`.tiles[data-tier="${CSS.escape(t.id)}"]`);
    t.items = [...el.children].map(c => c.dataset.id);
  });
  if (waitingSnapshot) waitingSnapshot = null;   // tahle změna přepíše to, co mezitím přišlo
  commit();
}

function removeFromTiers(id) {
  state.tiers.forEach(t => { t.items = t.items.filter(i => i !== id); });
}

function moveTier(index, delta) {
  const [t] = state.tiers.splice(index, 1);
  state.tiers.splice(index + delta, 0, t);
  commit();
}

// ── Ukládání ─────────────────────────────────────────────────
function commit() {
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await store.save(state);
    } catch (e) {
      console.error(e);
      setStatus(`Nepodařilo se uložit: ${chyba(e)}`, true);
    }
  }, 500);
}

function chyba(e) {
  const code = e && e.code || '';
  if (code === 'permission-denied') return 'databáze to odmítla, zkontroluj pravidla Firestore.';
  if (code === 'auth/unauthorized-domain') return 'tahle adresa není povolená ve Firebase (Authentication → Settings → Authorized domains).';
  if (code === 'auth/popup-blocked') return 'prohlížeč zablokoval přihlašovací okno.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'přihlašovací okno bylo zavřené.';
  return (e && e.message) || String(e);
}

function onRemoteState(raw) {
  const next = normalize(raw);
  if (dragging) { waitingSnapshot = next; return; }
  if (saveTimer) return;   // máme novější lokální změnu, která se právě ukládá
  state = next;
  render();
  applyPendingFavs();
  favStatus();
}

function applyPendingFavs() {
  if (!state || !pendingFavs) return;
  const { items, skItems, ts } = pendingFavs;
  pendingFavs = null;
  const merged = mergeFavorites(state, items, ts, skItems);
  const novejsi = (Number(ts) || 0) > state.favsTs;
  state = merged.state;
  if (merged.changed) commit();
  else if (novejsi) store.save(state).catch(e => console.error(e));
  favStatus();
}

// ── Most z rozšíření ─────────────────────────────────────────
window.addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.__svtTierFavs !== true) return;
  extensionSeen = true;
  const items = Array.isArray(d.items) ? d.items : [];
  const skItems = Array.isArray(d.skItems) ? d.skItems : [];
  if (items.length || skItems.length) {
    pendingFavs = { items, skItems, ts: d.ts };
    applyPendingFavs();
  }
  favStatus();
});

function askExtension() {
  window.postMessage({ __svtTierAsk: true }, location.origin);
}

// ── Akce v liště ─────────────────────────────────────────────
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] += '…';
  }
  return lines;
}

async function exportPng() {
  const W = 1600, LABEL = 150, TW = 120, TH = 180, GAP = 6, PER_ROW = Math.floor((W - LABEL - GAP) / (TW + GAP));
  const rows = state.tiers.map(t => {
    const ids = t.items.filter(id => state.items[id]);
    return { t, ids, h: Math.max(1, Math.ceil(ids.length / PER_ROW)) * (TH + GAP) + GAP };
  });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = rows.reduce((s, r) => s + r.h + 4, 0);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101218';
  ctx.fillRect(0, 0, W, canvas.height);

  setStatus('Připravuji PNG…');
  const ids = [...new Set(rows.flatMap(r => r.ids))];
  const images = new Map(await Promise.all(ids.map(async id => [id, await loadImage(state.items[id].poster)])));
  let missing = 0;

  let y = 0;
  for (const { t, ids: rowIds, h } of rows) {
    ctx.fillStyle = '#191c24';
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = t.color;
    ctx.fillRect(0, y, LABEL, h);
    ctx.fillStyle = '#14151a';
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelLines = wrapLines(ctx, t.label, LABEL - 16, 3);
    labelLines.forEach((l, i) => ctx.fillText(l, LABEL / 2, y + h / 2 + (i - (labelLines.length - 1) / 2) * 36));

    rowIds.forEach((id, i) => {
      const x = LABEL + GAP + (i % PER_ROW) * (TW + GAP);
      const ty = y + GAP + Math.floor(i / PER_ROW) * (TH + GAP);
      const img = images.get(id);
      ctx.fillStyle = '#222631';
      ctx.fillRect(x, ty, TW, TH);
      if (img) {
        const scale = Math.max(TW / img.width, TH / img.height);
        const sw = TW / scale, sh = TH / scale;
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, ty, TW, TH);
      } else if (state.items[id].poster) {
        missing++;
      }
      const grad = ctx.createLinearGradient(0, ty + TH - 70, 0, ty + TH);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,.92)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, ty + TH - 70, TW, 70);
      ctx.fillStyle = '#fff';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const lines = wrapLines(ctx, state.items[id].title, TW - 10, 3);
      lines.forEach((l, n) => ctx.fillText(l, x + 5, ty + TH - 6 - (lines.length - 1 - n) * 15));
    });
    y += h + 4;
  }

  canvas.toBlob(blob => {
    download('anime-tier-list.png', blob);
    favStatus();
    if (missing) setStatus(`PNG je hotové, ale ${missing} plakátů nešlo načíst (zůstal jen název).`, true);
  }, 'image/png');
}

function setTileSize(size) {
  document.documentElement.style.setProperty('--tile', `${size}px`);
  document.documentElement.classList.toggle('no-titles', size < 76);
}

function bindToolbar() {
  let size = 64;
  try { size = Number(localStorage.getItem(SIZE_KEY)) || size; } catch (e) {}
  $('tileSize').value = size;
  setTileSize(size);
  $('tileSize').addEventListener('input', e => {
    setTileSize(Number(e.target.value));
    try { localStorage.setItem(SIZE_KEY, e.target.value); } catch (err) {}
  });
  $('editTiers').addEventListener('click', () => {
    const on = $('tiers').classList.toggle('editing');
    $('editTiers').setAttribute('aria-pressed', String(on));
  });
  $('addTier').addEventListener('click', () => { state.tiers.push(newTier()); commit(); });
  $('addItem').addEventListener('click', () => { $('addForm').reset(); $('addDialog').showModal(); });
  $('addDialog').addEventListener('close', () => {
    if ($('addDialog').returnValue !== 'ok') return;
    const title = $('addTitle').value.trim();
    if (!title) return;
    const { id, item } = manualItem(state, title, $('addPoster').value.trim());
    state.items[id] = item;
    commit();
  });
  $('exportJson').addEventListener('click', () => {
    const text = JSON.stringify(toExport(state), null, 2);
    download('anime-tier-list.json', new Blob([text], { type: 'application/json' }));
  });
  $('exportPng').addEventListener('click', () => {
    exportPng().catch(e => { console.error(e); setStatus(`Export PNG selhal: ${chyba(e)}`, true); });
  });
  $('importJson').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = fromImport(state, JSON.parse(await file.text()));
      if (!confirm('Import nahradí současné tiery. Pokračovat?')) return;
      state = next;
      commit();
      setStatus('Import hotový.');
    } catch (err) {
      setStatus(`Import selhal: ${chyba(err)}`, true);
    }
  });
}

function showApp() {
  $('signin').hidden = true;
  $('app').hidden = false;
}

// ── Režimy ───────────────────────────────────────────────────
function startDemo() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) {}
  store = {
    async save(s) {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch (e) {}
    },
  };
  $('account').textContent = 'Zkušební režim, nic se nesynchronizuje';
  showApp();
  onRemoteState(saved || createEmpty());
  askExtension();
}

async function startFirebase() {
  setStatus('Načítám…');
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const fbAuth = auth.getAuth(app);
  const db = fs.getFirestore(app);
  let unsubscribe = null;

  $('signinBtn').addEventListener('click', async () => {
    try {
      await auth.signInWithPopup(fbAuth, new auth.GoogleAuthProvider());
    } catch (e) {
      setStatus(`Přihlášení selhalo: ${chyba(e)}`, true);
    }
  });

  auth.onAuthStateChanged(fbAuth, user => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    state = null;
    if (!user) {
      $('app').hidden = true;
      $('signin').hidden = false;
      $('account').replaceChildren();
      setStatus('');
      return;
    }
    const out = document.createElement('button');
    out.type = 'button';
    out.textContent = 'Odhlásit';
    out.addEventListener('click', () => auth.signOut(fbAuth));
    $('account').replaceChildren(user.email || '', out);

    const ref = fs.doc(db, 'tierlists', user.uid);
    store = {
      save: s => fs.setDoc(ref, { ...JSON.parse(JSON.stringify(s)), updatedAt: fs.serverTimestamp() }),
    };
    showApp();
    setStatus('Načítám tier list…');
    unsubscribe = fs.onSnapshot(ref, snap => {
      if (snap.metadata.hasPendingWrites) return;   // vlastní zápis, ten už je vykreslený
      if (snap.exists()) {
        onRemoteState(snap.data());
      } else {
        state = createEmpty();
        render();
        applyPendingFavs();
        favStatus();
        commit();
      }
    }, e => {
      console.error(e);
      setStatus(`Tier list nejde načíst: ${chyba(e)}`, true);
    });
    askExtension();
  });
}

bindToolbar();
if (DEMO) {
  startDemo();
} else {
  startFirebase().catch(e => {
    console.error(e);
    setStatus(`Aplikace se nespustila: ${chyba(e)}`, true);
  });
}
