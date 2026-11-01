// Hacker News on the vector display, read-only, with live data from the HN Search API
// (hn.algolia.com). Built with the ui`` DSL.
//
// Routes live in location.hash (#/news/2, #/item/123, #/user/pg, ...), so back and forward
// work. Data loads asynchronously through api.js; pages show a loading line until it lands
// and the runtime re-renders when it does. Nothing is ever sent to HN.

import { ui } from '../../src/ui/index.js';
import {
  load,
  retry,
  known,
  hoursAgo,
  dayRange,
  storyQuery,
  commentQuery,
  storyFromHit,
  commentFromHit,
  itemFromApi,
  rankByGravity,
  htmlToText,
} from './api.js';

const PAGE_SIZE = 30;
const RANK_W = 36;
const VOTE_W = 12;
const INDENT = RANK_W + VOTE_W + 16;
const COMMENT_INDENT = 34;
const LABEL_W = 96;

const state = {
  collapsed: new Set(),
  search: '',
};

// -- routing -------------------------------------------------------------------

export function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'news', arg: arg ? decodeURIComponent(arg) : null };
}

const go = (name, arg) => {
  location.hash = arg == null ? `#/${name}` : `#/${name}/${encodeURIComponent(arg)}`;
};

// -- helpers -------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ago(time) {
  const m = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${plural(m, 'minute')} ago`;
  if (m < 1440) return `${plural(Math.floor(m / 60), 'hour')} ago`;
  if (m < 43200) return `${plural(Math.floor(m / 1440), 'day')} ago`;
  if (m < 525600) return `${plural(Math.floor(m / 43200), 'month')} ago`;
  return `${plural(Math.floor(m / 525600), 'year')} ago`;
}

const countThread = (list) => list.reduce((n, c) => n + 1 + countThread(c.kids), 0);
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const prettyDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const heading = (text) => ui`row { spacer size=${INDENT}; text ${text} dim size=11 }`;

function loading(label) {
  // The dots are separate items so each new one is traced on its own.
  const dots = 1 + (Math.floor(Date.now() / 320) % 3);
  return ui`
    row {
      spacer size=${INDENT}
      text ${label} dim size=11
      ${Array.from({ length: dots }, (_, i) => ui`text "." dim size=11 key=${`dot${i}`}`)}
    }`;
}

/** Render a load() record: its value when ready, otherwise a loading or error line. */
function when(res, render, { label = 'Fetching from hn.algolia.com', missing = 'Not found.', missingStatus = [404] } = {}) {
  if (res.status === 'ok') return render(res.value);
  if (res.status === 'loading') return loading(label);
  if (missingStatus.includes(res.error?.status)) return heading(missing);
  return ui`
    row gap=10 {
      spacer size=${INDENT}
      text "Couldn't reach hn.algolia.com (${res.error?.message ?? 'network error'})." dim size=11
      link "retry" size=11 underline on:click=${() => retry(res)}
    }`;
}

// -- pieces ----------------------------------------------------------------------

const NAV = [
  ['newest', 'new'],
  ['past', 'past'],
  ['newcomments', 'comments'],
  ['ask', 'ask'],
  ['show', 'show'],
  ['jobs', 'jobs'],
];

function header(r) {
  const nav = NAV.map(([name, label], i) => ui`
    ${i ? ui`text "|"` : null}
    link ${label} bright=${r.name === name} on:click=${() => go(name)}`);
  return ui`
    row key=header color=alt fill=hatch hatch=2.5 pad="6 8" gap=14 align=center {
      box pad="2 4" { text "Y" bold size=13 }
      link "Hacker News" bold size=13 on:click=${() => go('news')}
      row gap=8 { ${nav} }
      spacer
      text "read-only" dim
    }`;
}

// Read-only: the arrow is there because HN shows it, but it doesn't do anything.
const voteMark = (item) =>
  item.type === 'job' ? ui`spacer size=${VOTE_W}` : ui`icon "upvote" size=${VOTE_W - 2} pad="0 1" dim`;

function titleLink(s) {
  // Like HN: links go out to the article (in a new tab); text posts open their thread.
  // `wrap` lets a long title give up width to its domain instead of running off the tube.
  return s.url
    ? ui`link ${s.title} size=13 wrap href=${s.url}`
    : ui`link ${s.title} size=13 wrap on:click=${() => go('item', s.id)}`;
}

function subtext(s, comments = s.comments) {
  if (s.type === 'job') return ui`row size=10 dim { link ${ago(s.time)} on:click=${() => go('item', s.id)} }`;
  return ui`
    row gap=8 size=10 dim {
      text "${plural(s.points, 'point')} by"
      link ${s.by ?? '[deleted]'} on:click=${() => s.by && go('user', s.by)}
      link ${ago(s.time)} on:click=${() => go('item', s.id)}
      text "|"
      link ${comments ? plural(comments, 'comment') : 'discuss'} on:click=${() => go('item', s.id)}
    }`;
}

function storyRow(s, rank, comments) {
  return ui`
    row key=${s.id} gap=8 {
      ${rank == null ? null : ui`text "${rank}." width=${RANK_W} align=right dim`}
      ${voteMark(s)}
      column gap=7 {
        row gap=10 {
          ${titleLink(s)}
          ${s.site ? ui`link "(${s.site})" size=10 dim on:click=${() => go('from', s.site)}` : null}
        }
        ${subtext(s, comments)}
      }
    }`;
}

function storyList(list, { start = 0, more = null } = {}) {
  if (!list.length) return heading('Nothing here.');
  return ui`
    column gap=15 {
      ${list.map((s, i) => storyRow(s, start + i + 1))}
      ${more ? ui`row pad="6 0 0 0" { spacer size=${INDENT}; link "More" on:click=${more} }` : null}
    }`;
}

// Big threads re-render often (every keystroke in the search box, every collapse), so an
// unchanged comment reuses its node instead of re-instantiating the template.
const commentMemo = new WeakMap();

function commentRow(c, depth) {
  const collapsed = state.collapsed.has(c.id);
  const sig = `${collapsed}|${depth}|${ago(c.time)}`;
  const hit = commentMemo.get(c);
  if (hit?.sig === sig) return hit.node;
  const toggle = () => (collapsed ? state.collapsed.delete(c.id) : state.collapsed.add(c.id));
  const node = ui`
    row key=${c.id} gap=8 {
      spacer size=${depth * COMMENT_INDENT}
      ${c.dead ? ui`spacer size=${VOTE_W}` : voteMark(c)}
      column grow=1 gap=8 {
        row gap=8 size=10 dim {
          ${c.dead ? ui`text "[deleted]"` : ui`link ${c.by} on:click=${() => go('user', c.by)}`}
          link ${ago(c.time)} on:click=${() => go('item', c.id)}
          link ${collapsed ? `[${countThread([c])} more]` : '[-]'} on:click=${toggle}
        }
        ${collapsed || !c.text ? null : ui`text ${c.text} wrap size=11`}
      }
    }`;
  commentMemo.set(c, { sig, node });
  return node;
}

function threadRows(list, depth, out = []) {
  for (const c of list) {
    out.push(commentRow(c, depth));
    if (!state.collapsed.has(c.id)) threadRows(c.kids, depth + 1, out);
  }
  return out;
}

function commentFeed(list) {
  if (!list.length) return heading('No comments.');
  return ui`
    column gap=16 {
      ${list.map((c) => ui`
        row key=${c.id} gap=8 {
          spacer size=${RANK_W}
          ${voteMark(c)}
          column grow=1 gap=8 {
            row gap=8 size=10 dim {
              link ${c.by} on:click=${() => go('user', c.by)}
              link ${ago(c.time)} on:click=${() => go('item', c.id)}
              text "|"
              link "parent" on:click=${() => go('item', c.parent)}
              text "| on:"
              link ${c.story.title} wrap on:click=${() => go('item', c.story.id)}
            }
            text ${c.text} wrap size=11
          }
        }`)}
    }`;
}

const field = (label, value) => ui`row gap=10 { text ${label} width=${LABEL_W} dim; ${value} }`;

// -- data --------------------------------------------------------------------------

const stories = (path, params, opts = {}) =>
  load(path, storyQuery(params), { map: (d) => ({ list: d.hits.map(storyFromHit), pages: d.nbPages }), ...opts });
const comments = (path, params) =>
  load(path, commentQuery(params), { map: (d) => ({ list: d.hits.map(commentFromHit), pages: d.nbPages }) });
// Ranked lists fetch a window of recent stories and order them the way HN does.
const ranked = (tags, hours) =>
  load('/search', storyQuery({ tags, numericFilters: `created_at_i>${hoursAgo(hours)}`, hitsPerPage: 100 }), {
    map: (d) => rankByGravity(d.hits.map(storyFromHit)),
  });

// -- pages -------------------------------------------------------------------------

function newsPage(page) {
  const front = load('/search', storyQuery({ tags: 'front_page', hitsPerPage: 50 }), {
    map: (d) => rankByGravity(d.hits.map(storyFromHit)),
  });
  if (page === 1) return when(front, (list) => storyList(list.slice(0, PAGE_SIZE), { more: () => go('news', 2) }));
  // Past the front page, continue with the next-best stories of the last two days.
  const recent = load(
    '/search',
    storyQuery({ tags: 'story', numericFilters: `created_at_i>${hoursAgo(48)},points>3`, hitsPerPage: 200 }),
    { map: (d) => rankByGravity(d.hits.map(storyFromHit)) },
  );
  return when(front, (top) =>
    when(recent, (list) => {
      const onFront = new Set(top.map((s) => s.id));
      const rest = list.filter((s) => !onFront.has(s.id));
      const start = (page - 2) * PAGE_SIZE;
      const more = start + PAGE_SIZE < rest.length ? () => go('news', page + 1) : null;
      return storyList(rest.slice(start, start + PAGE_SIZE), { start: top.length + start, more });
    }),
  );
}

function newestPage(page) {
  const res = stories('/search_by_date', { tags: 'story', hitsPerPage: PAGE_SIZE, page: page - 1 });
  return when(res, ({ list, pages }) =>
    storyList(list, { start: (page - 1) * PAGE_SIZE, more: page < pages ? () => go('newest', page + 1) : null }),
  );
}

function pastPage(arg) {
  const yesterday = isoDay(Date.now() - 86400000);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(arg ?? '') && arg <= yesterday ? arg : yesterday;
  const [from, to] = dayRange(day);
  const res = stories('/search', { tags: 'story', numericFilters: `created_at_i>=${from},created_at_i<${to}`, hitsPerPage: PAGE_SIZE });
  const shift = (days) => isoDay(Date.parse(`${day}T00:00:00Z`) + days * 86400000);
  return ui`
    column gap=14 {
      row gap=8 size=11 {
        spacer size=${INDENT}
        text "Stories from ${prettyDay(day)}." dim
        text "Go back a" dim
        link "day" underline on:click=${() => go('past', shift(-1))}
        ${day < yesterday ? ui`text "or forward a" dim; link "day" underline on:click=${() => go('past', shift(1))}` : null}
      }
      ${when(res, ({ list }) => storyList(list))}
    }`;
}

function itemPage(id) {
  const res = load(`/items/${encodeURIComponent(id)}`, {}, { map: itemFromApi });
  if (res.status !== 'ok') {
    // Show what we already know about the story from a list while its thread loads.
    const s = known.get(Number(id));
    return ui`column gap=16 { ${s ? storyRow(s, null) : null}; ${when(res, () => null, { label: 'Loading thread', missing: 'No such item.' })} }`;
  }
  const s = res.value;
  if (s.type === 'comment') {
    return ui`
      column gap=16 {
        row gap=8 size=10 dim {
          spacer size=${VOTE_W + 8}
          ${s.parent ? ui`link "parent" on:click=${() => go('item', s.parent)}; text "|"` : null}
          ${s.storyId ? ui`link "context" on:click=${() => go('item', s.storyId)}` : null}
        }
        column gap=16 { ${threadRows([{ ...s, dead: !s.by }], 0)} }
      }`;
  }
  return ui`
    column gap=16 {
      ${storyRow(s, null, s.comments)}
      ${s.text ? ui`row { spacer size=${VOTE_W + 8}; text ${s.text} wrap size=11 width=900 }` : null}
      ${s.options.length ? ui`
        column gap=8 size=11 {
          ${s.options.map((o, i) => ui`row gap=10 key=${`opt${i}`} { spacer size=${VOTE_W + 8}; text ${o.text}; text "${plural(o.points, 'point')}" dim }`)}
        }` : null}
      column gap=16 pad="6 0 0 0" { ${threadRows(s.kids, 0)} }
    }`;
}

function userPage(name) {
  const res = load(`/users/${encodeURIComponent(name)}`, {}, {
    ttl: 300_000,
    map: (u) => ({ name: u.username, karma: u.karma ?? 0, about: htmlToText(u.about) }),
  });
  return when(
    res,
    (u) => ui`
      column gap=10 pad="0 0 0 ${INDENT}" size=11 {
        ${field('user:', ui`text ${u.name}`)}
        ${field('karma:', ui`text ${u.karma}`)}
        ${field('about:', ui`text ${u.about || '-'} wrap width=700`)}
        row gap=6 size=10 {
          spacer size=${LABEL_W + 4}
          link "submissions" underline on:click=${() => go('submitted', name)}
          text "|" dim
          link "comments" underline on:click=${() => go('threads', name)}
        }
      }`,
    // The users endpoint answers an unknown name with a 500, not a 404.
    { missing: 'No such user.', missingStatus: [404, 500] },
  );
}

function body(r) {
  const page = Math.max(1, Number(r.arg) || 1);
  switch (r.name) {
    case 'news':
      return newsPage(page);
    case 'newest':
      return newestPage(page);
    case 'past':
      return pastPage(r.arg);
    case 'newcomments':
      return when(comments('/search_by_date', { tags: 'comment', hitsPerPage: PAGE_SIZE }), ({ list }) => commentFeed(list));
    case 'ask':
      return when(ranked('ask_hn', 72), (list) => storyList(list.slice(0, PAGE_SIZE)));
    case 'show':
      return ui`
        column gap=14 {
          ${heading('Please read the Show HN rules and tips before posting.')}
          ${when(ranked('show_hn', 72), (list) => storyList(list.slice(0, PAGE_SIZE)))}
        }`;
    case 'jobs':
      return ui`
        column gap=14 {
          ${heading('These are jobs at YC startups.')}
          ${when(stories('/search_by_date', { tags: 'job', hitsPerPage: PAGE_SIZE }), ({ list }) => storyList(list))}
        }`;
    case 'item':
      return itemPage(r.arg);
    case 'user':
      return userPage(r.arg ?? '');
    case 'submitted':
      return ui`
        column gap=14 {
          ${heading(`${r.arg}'s submissions`)}
          ${when(stories('/search_by_date', { tags: `story,author_${r.arg}`, hitsPerPage: PAGE_SIZE }), ({ list }) => storyList(list))}
        }`;
    case 'threads':
      return ui`
        column gap=14 {
          ${heading(`${r.arg}'s comments`)}
          ${when(comments('/search_by_date', { tags: `comment,author_${r.arg}`, hitsPerPage: PAGE_SIZE }), ({ list }) => commentFeed(list))}
        }`;
    case 'from': {
      // URL search matches whole tokens, so "github.com/user" is asked for as "github.com user"
      // and the results are narrowed to the exact site afterwards.
      const site = r.arg ?? '';
      const res = stories('/search_by_date', { query: site.replace(/\//g, ' '), restrictSearchableAttributes: 'url', tags: 'story', hitsPerPage: 50 });
      const matches = (s) => s.site === site || (!site.includes('/') && s.site?.startsWith(`${site}/`));
      return ui`
        column gap=14 {
          ${heading(`Stories from ${site}`)}
          ${when(res, ({ list }) => storyList(list.filter(matches)))}
        }`;
    }
    case 'search':
      return ui`
        column gap=14 {
          ${heading(`Search results for "${r.arg}"`)}
          ${when(stories('/search', { query: r.arg ?? '', tags: 'story', hitsPerPage: PAGE_SIZE }), ({ list }) => storyList(list))}
        }`;
    default:
      return heading('Unknown page.');
  }
}

const FOOTER = [
  ['Guidelines', 'https://news.ycombinator.com/newsguidelines.html'],
  ['FAQ', 'https://news.ycombinator.com/newsfaq.html'],
  ['Lists', 'https://news.ycombinator.com/lists'],
  ['API', 'https://github.com/HackerNews/API'],
  ['Security', 'https://news.ycombinator.com/security.html'],
  ['Legal', 'https://www.ycombinator.com/legal/'],
  ['Apply to YC', 'https://www.ycombinator.com/apply/'],
  ['Contact', 'mailto:hn@ycombinator.com'],
];

function footer() {
  const search = () => {
    const q = state.search.trim();
    if (q) go('search', q);
  };
  return ui`
    column key=footer gap=12 pad="26 0 14 0" align=center width=fill {
      divider color=alt
      row gap=8 size=10 {
        ${FOOTER.map(([label, href], i) => ui`
          ${i ? ui`text "|" dim` : null}
          link ${label} dim href=${href}`)}
      }
      row gap=8 size=10 {
        text "Search:" dim
        input key=search value=${state.search} width=240 on:input=${(v) => (state.search = v)} on:submit=${search}
      }
    }`;
}

export function view() {
  const r = route();
  return ui`
    column pad="12 20 0 20" {
      ${header(r)}
      scroll key=${`page:${r.name}/${r.arg ?? ''}`} pad="14 0 0 0" {
        ${body(r)}
        spacer
        ${footer()}
      }
    }`;
}
