// Read-only Hacker News data from the HN Search API (https://hn.algolia.com/api).
//
// load() is a fetch-once cache that is safe to call on every render: it returns a record
// { status: 'loading' | 'ok' | 'error', value, error } and kicks off a request when there
// is nothing cached (or the cached copy is older than `ttl`, in which case the old value
// keeps showing until the new one lands). onSettle() hears about every finished request.

const BASE = 'https://hn.algolia.com/api/v1';
const STORY_FIELDS = 'title,url,author,points,num_comments,created_at_i,_tags';
const COMMENT_FIELDS = 'author,comment_text,created_at_i,story_id,story_title,parent_id';

const cache = new Map();
let settled = () => {};

export function onSettle(fn) {
  settled = fn;
}

export const pending = () => [...cache.values()].some((r) => r.loading);

export function load(path, params = {}, { ttl = 60_000, map = (data) => data } = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  let r = cache.get(url);
  if (!r) {
    r = { url, map, status: 'loading', value: null, error: null, at: 0, loading: false };
    cache.set(url, r);
  }
  const stale = r.status === 'ok' && Date.now() - r.at > ttl;
  if (!r.loading && (r.status === 'loading' || stale)) request(r);
  return r;
}

/** Try a failed request again. */
export function retry(r) {
  r.status = 'loading';
  r.error = null;
  request(r);
}

function request(r) {
  r.loading = true;
  fetch(r.url)
    .then((res) => {
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return res.json();
    })
    .then((data) => {
      r.value = r.map(data);
      r.status = 'ok';
      r.error = null;
    })
    .catch((err) => {
      r.error = err;
      // A failed background refresh keeps showing the data we already have.
      if (r.status !== 'ok') r.status = 'error';
    })
    .finally(() => {
      r.loading = false;
      r.at = Date.now();
      settled();
    });
}

// -- query helpers ---------------------------------------------------------------

/** A unix time `hours` back, rounded to the hour so request URLs (and the cache) stay stable. */
export const hoursAgo = (hours) => Math.floor(Date.now() / 3.6e6) * 3600 - hours * 3600;

/** [start, end) unix seconds of a UTC day given as YYYY-MM-DD. */
export function dayRange(day) {
  const start = Date.parse(`${day}T00:00:00Z`) / 1000;
  return [start, start + 86400];
}

export const storyQuery = (params) => ({ attributesToRetrieve: STORY_FIELDS, ...params });
export const commentQuery = (params) => ({ attributesToRetrieve: COMMENT_FIELDS, ...params });

// -- mapping -----------------------------------------------------------------------

/** Every story seen in any list, so an item page can show its header while the thread loads. */
export const known = new Map();

const parser = new DOMParser();

/** HN text is HTML (<p> separated, entities, links, <pre><code>). Reduce it to plain text. */
export function htmlToText(html) {
  if (!html) return '';
  const doc = parser.parseFromString(html, 'text/html');
  for (const p of doc.querySelectorAll('p')) p.before('\n\n');
  for (const br of doc.querySelectorAll('br')) br.replaceWith('\n');
  return doc.body.textContent
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// HN shows the first path segment for hosts where the domain alone says little.
const PATH_SITES = new Set(['github.com', 'gitlab.com', 'codeberg.org', 'twitter.com', 'x.com', 'medium.com']);

export function siteOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const first = u.pathname.split('/')[1];
    return PATH_SITES.has(host) && first ? `${host}/${first}` : host;
  } catch {
    return null;
  }
}

function kind(tags, title, type) {
  if (type === 'job' || tags.includes('job')) return 'job';
  if (type === 'poll' || tags.includes('poll')) return 'poll';
  if (tags.includes('ask_hn') || /^Ask HN/i.test(title)) return 'ask';
  if (tags.includes('show_hn') || /^Show HN/i.test(title)) return 'show';
  return 'story';
}

export function storyFromHit(h) {
  const s = {
    id: Number(h.objectID),
    title: h.title ?? '',
    url: h.url || null,
    site: siteOf(h.url),
    points: h.points ?? 0,
    by: h.author,
    time: (h.created_at_i ?? 0) * 1000,
    comments: h.num_comments ?? 0,
    type: kind(h._tags ?? [], h.title ?? '', null),
  };
  known.set(s.id, s);
  return s;
}

export const countThread = (list) => list.reduce((n, c) => n + 1 + countThread(c.kids), 0);

function commentFromItem(c) {
  return {
    id: c.id,
    by: c.author,
    text: htmlToText(c.text),
    time: (c.created_at_i ?? 0) * 1000,
    dead: !c.author,
    kids: (c.children ?? []).map(commentFromItem),
  };
}

/** A full item from /items/:id: a story (with its comment tree) or a single comment. */
export function itemFromApi(it) {
  const s = {
    id: it.id,
    title: it.title ?? '',
    url: it.url || null,
    site: siteOf(it.url),
    points: it.points ?? 0,
    by: it.author,
    time: (it.created_at_i ?? 0) * 1000,
    type: it.type === 'comment' ? 'comment' : kind([], it.title ?? '', it.type),
    text: htmlToText(it.text),
    parent: it.parent_id,
    storyId: it.story_id,
    options: (it.options ?? []).filter((o) => o && typeof o === 'object').map((o) => ({ text: htmlToText(o.text), points: o.points ?? 0 })),
    kids: (it.children ?? []).filter((c) => c.type === 'comment').map(commentFromItem),
  };
  s.comments = countThread(s.kids);
  return s;
}

export function commentFromHit(h) {
  return {
    id: Number(h.objectID),
    by: h.author,
    text: htmlToText(h.comment_text),
    time: (h.created_at_i ?? 0) * 1000,
    parent: h.parent_id,
    story: { id: h.story_id, title: h.story_title ?? '' },
    kids: [],
  };
}

/** HN-style ranking: points decay with age, (points - 1) / (hours + 2)^1.8. */
export function rankByGravity(stories) {
  const now = Date.now();
  const score = (s) => Math.max(0, s.points - 1) / Math.pow((now - s.time) / 3.6e6 + 2, 1.8);
  return [...stories].sort((a, b) => score(b) - score(a));
}
