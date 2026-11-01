// Sample data for the Hacker News recreation. Every story, site, user and comment
// here is made up. Times are minutes before page load. Comment threads are generated
// deterministically from each story's id.

const S = (id, title, site, points, by, ago, comments, extra = {}) => ({
  id,
  title,
  site,
  points,
  by,
  ago,
  comments,
  type: title.startsWith('Ask HN') ? 'ask' : title.startsWith('Show HN') ? 'show' : 'story',
  ...extra,
});
const JOB = (id, title, site, ago, text) => ({ id, title, site, ago, type: 'job', text, points: 0, by: null, comments: 0 });

export const STORIES = [
  S(45810001, 'Show HN: A vector display emulator that traces every line with one beam', 'github.com/xy1024', 412, 'phosphor_dev', 180, 23, {
    text: 'I wanted the look of an old XY monitor without the high voltage. Everything on screen is a line traced by a simulated beam, with phosphor persistence, bloom and a little tube curvature. The page you are reading is drawn with it. Feedback welcome!',
  }),
  S(45810002, 'The forgotten art of the oscilloscope clock', 'solderandsignal.com', 318, 'ohms_law', 300, 18),
  S(45810003, 'SQLite as an application file format, revisited', 'fileformat.blog', 287, 'tbl_scan', 420, 26),
  S(45810004, "Ask HN: What's a tool you built for yourself that you still use daily?", null, 264, 'quietbuild', 240, 34, {
    text: "Mine is a 200-line script that turns my notes into a weekly review. I've rewritten it three times but never replaced it. What's yours?",
  }),
  S(45810005, 'Why we moved our build system back to Make', 'engineering.lumenware.io', 241, 'buildcop', 360, 21),
  S(45810006, 'A visual guide to how GPUs rasterize triangles', 'fragment.zone', 230, 'texel', 500, 12),
  S(45810007, 'Writing a tiny Forth in 300 lines of C', 'stackmachine.dev', 198, 'fourthwall', 260, 14),
  S(45810008, "The Apollo guidance computer's display keyboard, explained", 'dskyexplained.org', 187, 'luna_module', 640, 9),
  S(45810009, 'Launch HN: Tiller (YC W26) - Version control for spreadsheets', null, 176, 'tiller_team', 200, 29, {
    text: "Hi HN! We're building Tiller: branches, diffs and reviews for the spreadsheets your finance team actually lives in. Happy to answer anything, and we'd love your feedback.",
  }),
  S(45810010, 'Show HN: I made a synthesizer that runs on a 1980s pocket calculator', 'github.com/calcsynth', 168, 'keypad', 150, 16, {
    text: "It turns the keypad into a 12-tone keyboard and abuses the display driver as an oscillator. Schematics and firmware are in the repo.",
  }),
  S(45810011, 'How to read a datasheet without losing your mind', 'lowvoltage.blog', 152, 'vref', 900, 11),
  S(45810012, 'Hash tables all the way down', 'cachelines.net', 149, 'open_addr', 720, 19),
  S(45810013, 'The quiet death of the RSS reader, and why it is coming back', 'slowweb.news', 141, 'atom_feed', 1000, 27),
  S(45810014, 'Plain text accounting for small businesses', 'ledgerbook.io', 133, 'double_entry', 820, 15),
  JOB(45810015, 'Brindle Robotics (YC S24) is hiring firmware engineers', 'brindlerobotics.com', 60,
    'We build robots that sort recycling. Looking for C, C++ and Rust folks who like hardware. Remote-friendly within US time zones.'),
  S(45810016, 'A 4 KB demo that renders a city at night', 'tinydemos.art', 127, 'four_k', 1100, 8),
  S(45810017, 'Ask HN: How do you keep side projects from becoming second jobs?', null, 121, 'weekend_hacker', 380, 31, {
    text: 'Every time I start something fun it slowly turns into a support queue. How do you keep the joy without abandoning your users?',
  }),
  S(45810018, 'Notes on running a static site for 20 years', 'oldweb.garden', 117, 'html4ever', 1300, 13),
  S(45810019, "The physics of a CRT's electron gun", 'tubephysics.org', 112, 'cathode', 940, 10),
  S(45810020, 'Show HN: A terminal UI that shows your Kubernetes cluster breathing', 'github.com/kubebreathe', 98, 'podwatch', 90, 7, {
    text: 'A small TUI that animates pod churn as a breathing pattern. Mostly useless, very soothing.',
  }),
  S(45810021, 'Lessons from debugging a heisenbug in a 30-year-old codebase', 'legacycode.today', 94, 'git_blame', 1500, 12),
  S(45810022, 'Why does my laptop fan spin when the screen is off?', 'thermals.wtf', 88, 'fan_curve', 1250, 9),
  S(45810023, 'An illustrated history of the mechanical keyboard switch', 'keyclack.club', 81, 'tactile', 1700, 6),
  S(45810024, 'Ask HN: Best resources to learn compilers in 2026?', null, 77, 'lexer_yacc', 650, 20, {
    text: 'I have a CS degree but never took a compilers course. Looking for books, courses or projects you would recommend today.',
  }),
  S(45810025, 'Building a solar-powered weather station with an ESP32', 'backyardsensors.net', 73, 'dew_point', 1900, 5),
  JOB(45810026, 'Fieldnote (YC W25) is hiring a founding designer', 'fieldnote.app', 400,
    'Fieldnote helps field researchers capture structured notes offline. Come design the whole product with us.'),
  S(45810027, 'The surprising longevity of COBOL', 'mainframe.report', 66, 'copybook', 2100, 8),
  S(45810028, 'Show HN: A tiny static analyzer that finds unused CSS', 'github.com/unusedcss', 61, 'selector', 300, 4, {
    text: "It parses your templates and stylesheets and lists selectors that can't match anything. No config needed.",
  }),
  S(45810029, 'What I learned shipping a game in 8 KB of RAM', '8bitpostmortems.com', 58, 'sprite_flip', 2300, 6),
  S(45810030, 'Reverse engineering a toy laser tag protocol', 'irprotocols.dev', 52, 'carrier38k', 2500, 3),
];

const LINES = [
  "I've been running something similar in production for about two years. The hard part was never the happy path, it was retries and partial failure.",
  'This matches my experience almost exactly.',
  'Genuinely curious: what made you choose this approach over the obvious alternative?',
  'The article buries the lede. The interesting part is the second half.',
  "Every few years someone rediscovers this, and it's always a good read.",
  "I worked on a team that tried this. It went fine until it didn't, and then it went very badly at 3am.",
  "Counterpoint: most teams don't have this problem, and the machinery to solve it costs more than it saves.",
  'Does anyone know if there is a recording of the talk this is based on?',
  "The benchmarks are interesting, but I'd love to see p99 latency and not just the averages.",
  'Back in the day we did this with a shell script and a cron job. It worked for a decade.',
  "I think you're underestimating how much of this is cultural rather than technical.",
  'Thanks for writing this up. Bookmarked for the next time someone asks me why.',
  'The diagrams alone are worth the click.',
  'Small nit: the second example has an off-by-one in the loop bounds.',
  'This is the kind of post I come here for.',
  "Is there a license file? I couldn't find one in the repo.",
  'We evaluated this last quarter. The docs were great, but the migration story was rough.',
  "Same. Took me an afternoon to set up and I haven't touched it since.",
  'Hard disagree. Simplicity is a feature, and this throws it away for very little gain.',
  'The real lesson here is to measure before you optimize.',
  'Fun fact: the original hardware did this with fewer transistors than a modern mouse.',
  "I'd pay for this if it had a self-hosted option.",
  'This reminds me of an old Usenet thread that made the same argument in 1994.',
  'Not to be that person, but the title is a bit misleading.',
  'How does this compare to the approach in the paper from last year?',
  'Upvoted for the honest section on what did not work.',
  'Plain text keeps winning. Every time.',
  'The comments here are better than the article, as usual.',
  'I tried it on a ten-year-old laptop and it was still snappy. Impressive.',
  'Author here. Happy to answer questions.',
  "That's fair. We should make that clearer in the README.",
  'Can confirm, this fixed a long-standing bug for us.',
  'My takeaway: boring technology, applied carefully, is hard to beat.',
  "I'm surprised nobody has mentioned the power consumption angle yet.",
  "I wish more projects had a section titled 'Non-goals'.",
  'The edge cases are where all the complexity lives.',
  "Ten years from now this will be the default and we'll wonder how we lived without it.",
  "Source? I've seen numbers that suggest the opposite.",
  'Good question. Short answer: caching. Long answer: also caching.',
  'This is lovely. The attention to detail really shows.',
];

const HANDLES = [
  'kestrel', 'nullpointer', 'grepper', 'mmap_enjoyer', 'segfault_sam', 'jitter', 'bytewise', 'stdin',
  'lambda_lou', 'hexdump', 'tabs_not_spaces', 'rubberduck', 'cold_start', 'yak_shaver', 'off_by_one',
  'pipefitter', 'monotonic', 'bitrot', 'dangling_ptr', 'quorum', 'tarpit', 'idempotent', 'backpressure',
  'heisen', 'sudo_make', 'chmodx', 'fsync', 'lowlatency',
];

const ABOUT = [
  'Embedded engineer. Opinions my own.',
  'I write compilers for fun and spreadsheets for money.',
  'Former sysadmin, current gardener.',
  'Building small tools for small teams.',
  'Mostly lurking. Occasionally right.',
  'Retro hardware, type systems, good coffee.',
  '',
];

// mulberry32: tiny seeded PRNG so the same story always gets the same thread.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

function compose(r) {
  const n = 1 + Math.floor(r() * r() * 4);
  const picked = new Set();
  while (picked.size < n) picked.add(LINES[Math.floor(r() * LINES.length)]);
  const parts = [...picked];
  if (parts.length > 2 && r() < 0.5) return `${parts.slice(0, 2).join(' ')}\n\n${parts.slice(2).join(' ')}`;
  return parts.join(' ');
}

/** Builds (once) and returns the comment forest for a story. */
export function threadFor(story) {
  if (story.thread) return story.thread;
  const r = rng(story.id);
  const all = [];
  const roots = [];
  for (let i = 0; i < story.comments; i++) {
    const c = { id: story.id * 1000 + i + 1, by: HANDLES[Math.floor(r() * HANDLES.length)], text: compose(r), kids: [], depth: 0, story };
    // Replies favour recent comments, which builds the deep back-and-forth chains HN is known for.
    const parent = all.length && r() < 0.6 ? all[all.length - 1 - Math.floor(r() * r() * Math.min(all.length, 8))] : null;
    if (parent && parent.depth < 5) {
      c.depth = parent.depth + 1;
      c.ago = Math.max(1, Math.round(parent.ago * (0.25 + r() * 0.7)));
      parent.kids.push(c);
    } else {
      c.ago = Math.max(1, Math.round(story.ago * (0.15 + r() * 0.8)));
      roots.push(c);
    }
    all.push(c);
  }
  story.thread = roots;
  return roots;
}

export function profile(name) {
  const h = hash(name);
  const year = 2008 + (h % 17);
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][(h >>> 4) % 12];
  return {
    name,
    created: `${month} ${1 + ((h >>> 8) % 28)}, ${year}`,
    karma: 40 + ((h >>> 3) % 24000),
    about: ABOUT[(h >>> 6) % ABOUT.length],
  };
}
