// Hacker News, rebuilt with the ui`` DSL on the vector display. All data is sample data.
//
// Routes live in location.hash (#/news/2, #/item/45810004, #/user/kestrel, ...), so the
// browser's back and forward buttons work. Handlers mutate `state`; the runtime
// re-renders after each one, and only lines that actually changed get re-traced.

import { ui } from '../../src/ui/index.js';
import { STORIES, threadFor, profile } from './data.js';

const PAGE_SIZE = 20;
const RANK_W = 36;
const VOTE_W = 12;
const INDENT = RANK_W + VOTE_W + 16;
const COMMENT_INDENT = 34;
const LABEL_W = 96;

const SUBMITTED = [];
let nextId = 45820001;

const state = {
  me: null,
  voted: new Set(),
  hidden: new Set(),
  collapsed: new Set(),
  replyTo: null,
  draft: '',
  reply: '',
  search: '',
  login: { name: '', password: '' },
  submission: { title: '', url: '', text: '' },
  notice: null,
  next: null,
};

// -- routing -------------------------------------------------------------------

export function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'news', arg: arg ? decodeURIComponent(arg) : null };
}

const go = (name, arg) => {
  location.hash = arg == null ? `#/${name}` : `#/${name}/${encodeURIComponent(arg)}`;
};

export function onRouteChange() {
  if (route().name !== 'login') state.notice = null;
}

// -- helpers -------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const minutes = (item) => (item.time ? (Date.now() - item.time) / 60000 : item.ago);

function ago(item) {
  const m = Math.max(0, Math.round(minutes(item)));
  if (m < 1) return 'just now';
  if (m < 60) return `${plural(m, 'minute')} ago`;
  if (m < 1440) return `${plural(Math.floor(m / 60), 'hour')} ago`;
  return `${plural(Math.floor(m / 1440), 'day')} ago`;
}

const allStories = () => [...SUBMITTED, ...STORIES];
const shown = (list) => list.filter((s) => !state.hidden.has(s.id));
const findStory = (id) => allStories().find((s) => String(s.id) === String(id));
const points = (s) => s.points + (state.voted.has(s.id) ? 1 : 0);
const countThread = (list) => list.reduce((n, c) => n + 1 + countThread(c.kids), 0);
const commentCount = (s) => (s.thread ? countThread(s.thread) : s.comments);

function allComments() {
  const out = [];
  const walk = (list) => list.forEach((c) => (out.push(c), walk(c.kids)));
  for (const s of allStories()) if (s.type !== 'job') walk(threadFor(s));
  return out.sort((a, b) => minutes(a) - minutes(b));
}

// -- actions -------------------------------------------------------------------

const vote = (item) => state.voted.add(item.id);
const unvote = (item) => state.voted.delete(item.id);
const hide = (s) => state.hidden.add(s.id);

function toggle(c) {
  if (state.collapsed.has(c.id)) state.collapsed.delete(c.id);
  else state.collapsed.add(c.id);
}

function openReply(c) {
  state.replyTo = state.replyTo === c.id ? null : c.id;
  state.reply = '';
}

function requireLogin(message) {
  if (state.me) return true;
  state.notice = message;
  state.next = location.hash;
  go('login');
  return false;
}

function addComment(story, parent) {
  const text = (parent ? state.reply : state.draft).trim();
  if (!text || !requireLogin('You have to be logged in to comment.')) return;
  const c = { id: nextId++, by: state.me, text, kids: [], depth: parent ? parent.depth + 1 : 0, story, time: Date.now() };
  if (parent) {
    parent.kids.unshift(c);
    state.collapsed.delete(parent.id);
    state.replyTo = null;
    state.reply = '';
  } else {
    threadFor(story).unshift(c);
    state.draft = '';
  }
}

function logIn(next) {
  const name = state.login.name.trim();
  if (!name) {
    state.notice = 'Bad login.';
    return;
  }
  state.me = name;
  state.login = { name: '', password: '' };
  state.notice = null;
  state.next = null;
  location.hash = next ?? '#/news';
}

function submitStory() {
  const f = state.submission;
  const title = f.title.trim();
  if (!title) return;
  const url = f.url.trim();
  const site = url ? url.replace(/^\w+:\/\//, '').replace(/^www\./, '').split('/')[0] : null;
  const type = title.startsWith('Ask HN') ? 'ask' : title.startsWith('Show HN') ? 'show' : 'story';
  SUBMITTED.unshift({ id: nextId++, title, site, text: f.text.trim() || null, points: 1, by: state.me, time: Date.now(), comments: 0, type });
  state.submission = { title: '', url: '', text: '' };
  go('newest');
}

// -- pieces ----------------------------------------------------------------------

const NAV = [
  ['newest', 'new'],
  ['past', 'past'],
  ['newcomments', 'comments'],
  ['ask', 'ask'],
  ['show', 'show'],
  ['jobs', 'jobs'],
  ['submit', 'submit'],
];

function header(r) {
  const nav = NAV.map(([name, label], i) => ui`
    ${i ? ui`text "|"` : null}
    link ${label} bright=${r.name === name} on:click=${() => go(name)}`);
  const account = state.me
    ? ui`link ${state.me} on:click=${() => go('user', state.me)}; text "(1)"; text "|"; link "logout" on:click=${() => (state.me = null)}`
    : ui`link "login" on:click=${() => go('login')}`;
  return ui`
    row key=header color=alt fill=hatch hatch=2.5 pad="6 8" gap=14 align=center {
      box pad="2 4" { text "Y" bold size=13 }
      link "Hacker News" bold size=13 on:click=${() => go('news')}
      row gap=8 { ${nav} }
      spacer
      row gap=8 { ${account} }
    }`;
}

function voteButton(item) {
  if (item.type === 'job' || state.voted.has(item.id)) return ui`spacer size=${VOTE_W}`;
  return ui`icon "upvote" size=${VOTE_W - 2} pad="0 1" dim on:click=${() => vote(item)}`;
}

function subtext(s) {
  if (s.type === 'job') return ui`row size=10 dim { link ${ago(s)} on:click=${() => go('item', s.id)} }`;
  const n = commentCount(s);
  return ui`
    row gap=8 size=10 dim {
      text "${plural(points(s), 'point')} by"
      link ${s.by} on:click=${() => go('user', s.by)}
      link ${ago(s)} on:click=${() => go('item', s.id)}
      ${state.voted.has(s.id) ? ui`text "|"; link "unvote" on:click=${() => unvote(s)}` : null}
      text "|"
      link "hide" on:click=${() => hide(s)}
      text "|"
      link ${n ? plural(n, 'comment') : 'discuss'} on:click=${() => go('item', s.id)}
    }`;
}

function storyRow(s, rank) {
  return ui`
    row key=${s.id} gap=8 {
      ${rank == null ? null : ui`text "${rank}." width=${RANK_W} align=right dim`}
      ${voteButton(s)}
      column gap=7 {
        row gap=10 {
          link ${s.title} size=13 on:click=${() => go('item', s.id)}
          ${s.site ? ui`link "(${s.site})" size=10 dim on:click=${() => go('from', s.site)}` : null}
        }
        ${subtext(s)}
      }
    }`;
}

function storyList(list, { start = 0, more = null } = {}) {
  if (!list.length) return ui`row { spacer size=${INDENT}; text "Nothing here yet." dim }`;
  return ui`
    column gap=15 {
      ${list.map((s, i) => storyRow(s, start + i + 1))}
      ${more ? ui`row pad="6 0 0 0" { spacer size=${INDENT}; link "More" on:click=${more} }` : null}
    }`;
}

const heading = (text) => ui`row { spacer size=${INDENT}; text ${text} dim size=11 }`;

function commentRow(c, depth) {
  const collapsed = state.collapsed.has(c.id);
  return ui`
    row key=${c.id} gap=8 {
      spacer size=${depth * COMMENT_INDENT}
      ${voteButton(c)}
      column grow=1 gap=8 {
        row gap=8 size=10 dim {
          link ${c.by} on:click=${() => go('user', c.by)}
          text ${ago(c)}
          link ${collapsed ? `[${countThread([c])} more]` : '[-]'} on:click=${() => toggle(c)}
        }
        ${collapsed ? null : ui`text ${c.text} wrap size=11`}
        ${collapsed ? null : ui`link "reply" size=9 dim underline on:click=${() => openReply(c)}`}
        ${state.replyTo === c.id ? replyForm(c) : null}
      }
    }`;
}

function replyForm(c) {
  return ui`
    row gap=8 pad="2 0" {
      input key=reply value=${state.reply} placeholder="reply..." width=440 autofocus on:input=${(v) => (state.reply = v)} on:submit=${() => addComment(c.story, c)}
      button "reply" on:click=${() => addComment(c.story, c)}
      link "cancel" size=10 dim on:click=${() => (state.replyTo = null)}
    }`;
}

function threadRows(list, depth, out = []) {
  for (const c of list) {
    out.push(commentRow(c, depth));
    if (!state.collapsed.has(c.id)) threadRows(c.kids, depth + 1, out);
  }
  return out;
}

function commentFeed(list) {
  if (!list.length) return heading('No comments yet.');
  return ui`
    column gap=16 {
      ${list.slice(0, 30).map((c) => ui`
        row key=${c.id} gap=8 {
          spacer size=${RANK_W}
          ${voteButton(c)}
          column grow=1 gap=8 {
            row gap=8 size=10 dim {
              link ${c.by} on:click=${() => go('user', c.by)}
              text ${ago(c)}
              text "| on:"
              link ${c.story.title} on:click=${() => go('item', c.story.id)}
            }
            text ${c.text} wrap size=11
          }
        }`)}
    }`;
}

const field = (label, value) => ui`row gap=10 { text ${label} width=${LABEL_W} dim; ${value} }`;

// -- pages -------------------------------------------------------------------------

function itemPage(id) {
  const s = findStory(id);
  if (!s) return heading('No such item.');
  return ui`
    column gap=16 {
      ${storyRow(s, null)}
      ${s.text ? ui`row { spacer size=${VOTE_W + 6}; text ${s.text} wrap size=11 width=900 }` : null}
      ${s.type === 'job' ? null : ui`
        row gap=10 {
          spacer size=${VOTE_W}
          input key=draft value=${state.draft} placeholder="add a comment..." width=560 on:input=${(v) => (state.draft = v)} on:submit=${() => addComment(s, null)}
          button "add comment" on:click=${() => addComment(s, null)}
        }
        column gap=16 pad="6 0 0 0" { ${threadRows(threadFor(s), 0)} }`}
    }`;
}

function loginPage(notice, next) {
  const submit = () => logIn(next);
  return ui`
    column gap=12 pad="0 0 0 ${INDENT}" size=11 {
      ${notice ? ui`text ${notice}` : null}
      text "Login" bold size=13
      ${field('username:', ui`input key=user value=${state.login.name} width=260 autofocus on:input=${(v) => (state.login.name = v)} on:submit=${submit}`)}
      ${field('password:', ui`input key=pass password value=${state.login.password} width=260 on:input=${(v) => (state.login.password = v)} on:submit=${submit}`)}
      row { spacer size=${LABEL_W + 10}; button "login" on:click=${submit} }
      text "Sample data: any username works and nothing leaves this page." dim size=10
    }`;
}

function submitPage() {
  if (!state.me) return loginPage('You have to be logged in to submit.', '#/submit');
  const f = state.submission;
  return ui`
    column gap=12 pad="0 0 0 ${INDENT}" size=11 {
      ${field('title', ui`input key=title value=${f.title} width=520 autofocus on:input=${(v) => (f.title = v)} on:submit=${submitStory}`)}
      ${field('url', ui`input key=url value=${f.url} width=520 on:input=${(v) => (f.url = v)} on:submit=${submitStory}`)}
      ${field('text', ui`input key=text value=${f.text} width=520 on:input=${(v) => (f.text = v)} on:submit=${submitStory}`)}
      row { spacer size=${LABEL_W + 10}; button "submit" on:click=${submitStory} }
      row { spacer size=${LABEL_W + 10}; text "Leave url blank to submit a question for discussion. If there is no url, text will appear at the top of the thread." dim size=10 wrap width=620 }
    }`;
}

function userPage(name) {
  const u = profile(name);
  const mine = name === state.me;
  return ui`
    column gap=10 pad="0 0 0 ${INDENT}" size=11 {
      ${field('user:', ui`text ${u.name}`)}
      ${field('created:', ui`text ${mine ? 'just now' : u.created}`)}
      ${field('karma:', ui`text ${mine ? 1 : u.karma}`)}
      ${field('about:', ui`text ${u.about || '-'} wrap width=620`)}
      row gap=6 size=10 {
        spacer size=${LABEL_W + 4}
        link "submissions" underline on:click=${() => go('submitted', name)}
        text "|" dim
        link "comments" underline on:click=${() => go('threads', name)}
      }
    }`;
}

function body(r) {
  const byPoints = (a, b) => points(b) - points(a);
  const byAge = (a, b) => minutes(a) - minutes(b);
  switch (r.name) {
    case 'news': {
      const page = Math.max(1, Number(r.arg) || 1);
      const list = shown(STORIES);
      const start = (page - 1) * PAGE_SIZE;
      const more = start + PAGE_SIZE < list.length ? () => go('news', page + 1) : null;
      return storyList(list.slice(start, start + PAGE_SIZE), { start, more });
    }
    case 'newest':
      return storyList(shown(allStories()).sort(byAge));
    case 'past': {
      const day = new Date(Date.now() - 86400000).toDateString();
      return ui`column gap=14 { ${heading(`Stories from ${day}`)}; ${storyList(shown(STORIES).sort(byPoints))} }`;
    }
    case 'newcomments':
      return commentFeed(allComments());
    case 'ask':
      return storyList(shown(allStories()).filter((s) => s.type === 'ask'));
    case 'show':
      return ui`column gap=14 { ${heading('Please read the Show HN rules and tips before posting.')}; ${storyList(shown(allStories()).filter((s) => s.type === 'show'))} }`;
    case 'jobs':
      return ui`column gap=14 { ${heading('These are jobs at YC startups (sample listings).')}; ${storyList(shown(STORIES).filter((s) => s.type === 'job'))} }`;
    case 'item':
      return itemPage(r.arg);
    case 'user':
      return userPage(r.arg ?? '');
    case 'submitted':
      return ui`column gap=14 { ${heading(`${r.arg}'s submissions`)}; ${storyList(allStories().filter((s) => s.by === r.arg))} }`;
    case 'threads':
      return ui`column gap=14 { ${heading(`${r.arg}'s comments`)}; ${commentFeed(allComments().filter((c) => c.by === r.arg))} }`;
    case 'from':
      return ui`column gap=14 { ${heading(`Stories from ${r.arg}`)}; ${storyList(shown(allStories()).filter((s) => s.site === r.arg))} }`;
    case 'search': {
      const q = (r.arg ?? '').toLowerCase();
      const hits = allStories().filter((s) => s.title.toLowerCase().includes(q));
      return ui`column gap=14 { ${heading(`Search results for "${r.arg}"`)}; ${storyList(hits)} }`;
    }
    case 'login':
      return loginPage(state.notice, state.next);
    case 'submit':
      return submitPage();
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
