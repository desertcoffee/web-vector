// The ui`` markup language.
//
//   ui`
//     column gap=8 pad="12 16" {
//       text "Hello, ${name}" size=20 bold
//       row gap=6 { link "Docs" on:click=${openDocs}; text "|" dim; link "About" }
//       ${items.map((it) => ui`text ${it.label} key=${it.id}`)}
//     }`
//
// Grammar (KDL-flavoured; a node ends at a newline, `;` or `}`):
//   children := (node | hole)*
//   node     := TYPE [content] (attr | hole)* ['{' children '}']
//   content  := "string" | number | hole       text for text/link/button, the name for icon
//   attr     := name ['=' value]                a bare name is `true`; a hole spreads an object of props
//   value    := "string" | number | ident | hole
// Strings can contain ${holes}. `//` starts a comment.
//
// A child hole may hold a node, an array of nodes, a string or number (becomes text),
// or null/false (renders nothing). Parsed templates are cached per call site.

export const ELEMENTS = new Set([
  'column',
  'row',
  'box',
  'stack',
  'scroll',
  'text',
  'link',
  'button',
  'input',
  'icon',
  'divider',
  'spacer',
]);

export class UINode {
  constructor(type, content, props, children) {
    this.type = type;
    this.content = content;
    this.props = props;
    this.children = children;
  }
}

/** Builder form of the DSL: h('row', { gap: 4 }, h('text', { content: 'hi' })). */
export function h(type, props, ...children) {
  if (!ELEMENTS.has(type)) throw new Error(`ui: unknown element "${type}"`);
  const { content = null, ...rest } = props ?? {};
  return new UINode(type, content, rest, children);
}

const cache = new WeakMap();

/** Tagged template. Returns a node, or an array when the template has several roots. */
export function ui(strings, ...values) {
  let tpl = cache.get(strings);
  if (!tpl) {
    tpl = parse(strings.raw);
    cache.set(strings, tpl);
  }
  const nodes = buildList(tpl, values);
  return nodes.length === 1 ? nodes[0] : nodes;
}

// ---------------------------------------------------------------------------
// Lexer: walks the template's raw chunks; a hole sits between consecutive chunks.

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)/y;
const IDENT = /[A-Za-z_][\w:.-]*/y;

function lex(raw) {
  const toks = [];
  let ci = 0;
  let s = raw[0];
  let i = 0;
  let line = 1;
  const fail = (msg) => {
    throw new SyntaxError(`ui: ${msg} (template line ${line})`);
  };
  for (;;) {
    if (i >= s.length) {
      if (ci === raw.length - 1) break;
      toks.push({ t: 'hole', index: ci, line });
      s = raw[++ci];
      i = 0;
      continue;
    }
    const c = s[i];
    if (c === '\n') {
      toks.push({ t: 'nl', line });
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '{' || c === '}' || c === ';' || c === '=') {
      toks.push({ t: c, line });
      i++;
    } else if (c === '"' || c === "'") {
      const parts = [];
      let buf = '';
      i++;
      for (;;) {
        if (i >= s.length) {
          if (ci === raw.length - 1) fail('unterminated string');
          parts.push(buf, { hole: ci });
          buf = '';
          s = raw[++ci];
          i = 0;
          continue;
        }
        const d = s[i];
        if (d === c) {
          i++;
          break;
        }
        if (d === '\\') {
          const e = s[i + 1];
          buf += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
          continue;
        }
        if (d === '\n') line++;
        buf += d;
        i++;
      }
      parts.push(buf);
      toks.push({ t: 'str', parts: parts.filter((p) => p !== ''), line });
    } else {
      NUMBER.lastIndex = i;
      IDENT.lastIndex = i;
      const num = NUMBER.exec(s);
      const id = !num && IDENT.exec(s);
      if (num) {
        toks.push({ t: 'num', value: Number(num[0]), line });
        i += num[0].length;
      } else if (id) {
        toks.push({ t: 'id', value: id[0], line });
        i += id[0].length;
      } else fail(`unexpected "${c}"`);
    }
  }
  toks.push({ t: 'eof', line });
  return toks;
}

// ---------------------------------------------------------------------------
// Parser: produces a template tree whose values reference holes by index.

function parse(raw) {
  const toks = lex(raw);
  let p = 0;
  const peek = () => toks[p];
  const fail = (msg, tok = peek()) => {
    throw new SyntaxError(`ui: ${msg} (template line ${tok.line})`);
  };
  const NAMES = { str: 'a string', num: 'a number', hole: 'a ${} value', nl: 'end of line', eof: 'end of template' };
  const describe = (tok) => (tok.t === 'id' ? `"${tok.value}"` : (NAMES[tok.t] ?? `"${tok.t}"`));

  const value = (tok) => {
    switch (tok.t) {
      case 'str':
        return { parts: tok.parts };
      case 'num':
        return { lit: tok.value };
      case 'hole':
        return { hole: tok.index };
      case 'id':
        return { lit: tok.value === 'true' ? true : tok.value === 'false' ? false : tok.value };
      default:
        return fail(`expected a value, found ${describe(tok)}`, tok);
    }
  };

  const node = () => {
    const tok = toks[p++];
    if (!ELEMENTS.has(tok.value)) fail(`unknown element "${tok.value}"`, tok);
    const n = { type: tok.value, content: null, attrs: [], spreads: [], children: [] };
    const first = peek();
    if (first.t === 'str' || first.t === 'num' || first.t === 'hole') {
      p++;
      n.content = value(first);
    }
    for (;;) {
      const t = peek();
      if (t.t === 'id') {
        p++;
        if (ELEMENTS.has(t.value) && peek().t !== '=') {
          fail(`"${t.value}" starts a new element; separate nodes with a newline or ";"`, t);
        }
        if (peek().t === '=') {
          p++;
          n.attrs.push([t.value, value(toks[p++])]);
        } else n.attrs.push([t.value, { lit: true }]);
      } else if (t.t === 'hole') {
        p++;
        n.spreads.push(t.index);
      } else break;
    }
    if (peek().t === '{') {
      p++;
      n.children = children(true);
      p++;
    }
    const end = peek();
    if (end.t !== 'nl' && end.t !== ';' && end.t !== '}' && end.t !== 'eof') {
      fail(`unexpected ${describe(end)} after "${n.type}" (separate nodes with a newline or ";")`, end);
    }
    return n;
  };

  const children = (inBlock) => {
    const list = [];
    for (;;) {
      const tok = peek();
      if (tok.t === 'nl' || tok.t === ';') p++;
      else if (tok.t === '}') {
        if (inBlock) return list;
        fail('unexpected "}"');
      } else if (tok.t === 'eof') {
        if (inBlock) fail('missing "}"');
        return list;
      } else if (tok.t === 'hole') {
        p++;
        list.push({ hole: tok.index });
      } else if (tok.t === 'id') list.push(node());
      else fail(`unexpected ${describe(tok)}`);
    }
  };

  return children(false);
}

// ---------------------------------------------------------------------------
// Instantiation

const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

function resolveValue(v, values) {
  if ('lit' in v) return v.lit;
  if ('hole' in v) return values[v.hole];
  return v.parts.map((part) => (typeof part === 'string' ? part : (values[part.hole] ?? ''))).join('');
}

function buildList(list, values) {
  return list.map((item) => (item.type ? buildNode(item, values) : values[item.hole]));
}

function buildNode(n, values) {
  const props = {};
  let content = n.content ? resolveValue(n.content, values) : null;
  if (isPlainObject(content)) {
    Object.assign(props, content);
    content = null;
  }
  for (const i of n.spreads) Object.assign(props, values[i]);
  for (const [k, v] of n.attrs) props[k] = resolveValue(v, values);
  return new UINode(n.type, content, props, buildList(n.children, values));
}
