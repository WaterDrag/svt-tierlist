// Čistá logika tier listu bez DOMu a Firebase, aby šla testovat v Node.

const DEFAULT_TIERS = [
  ['S++', '#ff0000'], ['S+', '#ff2a2a'], ['S', '#ff4545'],
  ['A+', '#ff8c00'], ['A', '#ffa52c'],
  ['B+', '#a0ff3c'], ['B', '#c4ff7d'],
  ['C+', '#00ff88'], ['C', '#7dffcc'],
  ['D', '#00a0ff'], ['F', '#8f00ff'],
  ['Left to Watch', '#ff00c8'],
];

const randomId = () => Math.random().toString(36).slice(2, 10);

export function createEmpty() {
  return {
    tiers: DEFAULT_TIERS.map(([label, color]) => ({ id: randomId(), label, color, items: [] })),
    items: {},
    favIds: [],
    hidden: [],
    favsTs: 0,
  };
}

export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const base = createEmpty();
  return {
    tiers: Array.isArray(r.tiers) ? r.tiers.map(t => ({
      id: String(t.id || randomId()),
      label: String(t.label ?? ''),
      color: String(t.color || '#888888'),
      items: Array.isArray(t.items) ? t.items.map(String) : [],
    })) : base.tiers,
    items: r.items && typeof r.items === 'object' ? r.items : {},
    favIds: Array.isArray(r.favIds) ? r.favIds.map(String) : [],
    hidden: Array.isArray(r.hidden) ? r.hidden.map(String) : [],
    favsTs: Number(r.favsTs) || 0,
  };
}

export function safeUrl(url, base) {
  try {
    const u = new URL(String(url || ''), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch (e) {
    return '';
  }
}

export function slugify(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function placedIds(state) {
  return new Set(state.tiers.flatMap(t => t.items));
}

// Nezařazené: aktuální oblíbené a ručně přidané, které nejsou v tieru ani skryté.
// Seriál odebraný z oblíbených z tieru nemizí, zmizí jen z téhle přihrádky.
export function unranked(state) {
  const placed = placedIds(state);
  const hidden = new Set(state.hidden);
  const manual = Object.keys(state.items).filter(id => state.items[id].source === 'manual');
  return [...new Set([...state.favIds, ...manual])]
    .filter(id => state.items[id] && !placed.has(id) && !hidden.has(id));
}

export function mergeFavorites(state, favItems, ts) {
  const SITE = 'https://svetserialu.io';
  const next = structuredClone(state);
  const favIds = [];
  let changed = false;
  for (const f of favItems) {
    const id = String((f && f.slug) || '').toLowerCase();
    if (!id || favIds.includes(id)) continue;
    favIds.push(id);
    const old = next.items[id] || {};
    const item = {
      title: String(f.title || old.title || id),
      poster: safeUrl(f.poster, SITE) || old.poster || '',
      href: safeUrl(f.href, SITE) || old.href || '',
      source: 'fav',
    };
    if (JSON.stringify(old) !== JSON.stringify(item)) changed = true;
    next.items[id] = item;
  }
  if (JSON.stringify(next.favIds) !== JSON.stringify(favIds)) changed = true;
  next.favIds = favIds;
  next.favsTs = Number(ts) || Date.now();
  return { state: next, changed };
}

const publicItem = (state, id) => {
  const { title = id, poster = '', href = '' } = state.items[id] || {};
  return { title, poster, href };
};

export function toExport(state) {
  return {
    exportedAt: new Date().toISOString(),
    tiers: state.tiers.map(t => ({
      label: t.label,
      color: t.color,
      items: t.items.filter(id => state.items[id]).map(id => publicItem(state, id)),
    })),
    unranked: unranked(state).map(id => publicItem(state, id)),
  };
}

function itemId(item, used) {
  const m = String(item.href || '').match(/\/serial\/([^/?#]+)/i);
  const base = m ? m[1].toLowerCase() : 'm-' + (slugify(item.title) || randomId());
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
}

// Nahradí tiery z exportu. Oblíbené zůstávají, přihrádka se z nich dopočítá.
export function fromImport(state, data) {
  if (!data || !Array.isArray(data.tiers)) throw new Error('V souboru chybí seznam tiers.');
  const next = structuredClone(state);
  const used = new Set();
  const add = raw => {
    const title = String(raw && raw.title || '').trim();
    if (!title) return null;
    const href = safeUrl(raw.href);
    const id = itemId({ title, href }, used);
    next.items[id] = {
      title,
      poster: safeUrl(raw.poster) || next.items[id]?.poster || '',
      href,
      source: next.favIds.includes(id) ? 'fav' : 'manual',
    };
    return id;
  };
  next.tiers = data.tiers.map(t => ({
    id: randomId(),
    label: String(t.label ?? ''),
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#888888',
    items: (Array.isArray(t.items) ? t.items : []).map(add).filter(Boolean),
  }));
  (Array.isArray(data.unranked) ? data.unranked : []).forEach(add);
  const placed = placedIds(next);
  next.hidden = next.hidden.filter(id => !placed.has(id));
  return next;
}

export function newTier() {
  return { id: randomId(), label: 'Nový', color: '#888888', items: [] };
}

export function manualItem(state, title, poster) {
  const used = new Set(Object.keys(state.items));
  const id = itemId({ title }, used);
  return { id, item: { title, poster: safeUrl(poster), href: '', source: 'manual' } };
}
