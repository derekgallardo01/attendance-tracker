// Per-script fonts for generated PDFs. The base Noto Sans covers Latin,
// Cyrillic, Greek and Vietnamese; every other script needs its own Noto face
// or it prints as empty boxes. The faces are downloaded at image build time
// (scripts/fetch-fonts.js) — when one is missing (local dev, tests) that script
// simply falls back to the base font, exactly as before.
//
// install(doc) makes doc.text()/widthOfString() split a string into same-script
// runs and draw each run in its own font, so mixed text ("Certificate — राहुल")
// renders correctly without touching every call site.
const path = require('path');
const fs = require('fs');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

// Unicode block → script. First match wins; anything else is base/neutral.
const RANGES = [
  [0x0590, 0x05ff, 'hebrew'], [0xfb1d, 0xfb4f, 'hebrew'],
  [0x0600, 0x06ff, 'arabic'], [0x0750, 0x077f, 'arabic'], [0x08a0, 0x08ff, 'arabic'], [0xfb50, 0xfdff, 'arabic'], [0xfe70, 0xfeff, 'arabic'],
  [0x0900, 0x097f, 'devanagari'], [0x0980, 0x09ff, 'bengali'], [0x0a00, 0x0a7f, 'gurmukhi'], [0x0a80, 0x0aff, 'gujarati'],
  [0x0b80, 0x0bff, 'tamil'], [0x0c00, 0x0c7f, 'telugu'], [0x0c80, 0x0cff, 'kannada'], [0x0d00, 0x0d7f, 'malayalam'],
  [0x0d80, 0x0dff, 'sinhala'], [0x0e00, 0x0e7f, 'thai'], [0x0e80, 0x0eff, 'lao'], [0x1000, 0x109f, 'myanmar'],
  [0x1200, 0x139f, 'ethiopic'], [0x1780, 0x17ff, 'khmer'],
  [0x3040, 0x30ff, 'kana'], [0x31f0, 0x31ff, 'kana'],
  [0x1100, 0x11ff, 'hangul'], [0x3130, 0x318f, 'hangul'], [0xac00, 0xd7af, 'hangul'],
  [0x3000, 0x303f, 'han'], [0x3400, 0x4dbf, 'han'], [0x4e00, 0x9fff, 'han'], [0xf900, 0xfaff, 'han'], [0xff00, 0xffef, 'han'],
];

function scriptOf(ch) {
  const cp = ch.codePointAt(0);
  for (const [lo, hi, script] of RANGES) if (cp >= lo && cp <= hi) return script;
  return /[\p{L}]/u.test(ch) ? 'base' : null; // null = neutral (space, digit, punctuation)
}

// Split text into [script, text] runs; neutral characters join the current run.
function splitRuns(text) {
  const runs = [];
  for (const ch of String(text)) {
    const sc = scriptOf(ch);
    const last = runs[runs.length - 1];
    if (!last) runs.push([sc || 'neutral', ch]);
    else if (sc === null || sc === last[0]) last[1] += ch;
    else if (last[0] === 'neutral') { last[0] = sc; last[1] += ch; } // leading neutrals adopt the first script
    else runs.push([sc, ch]);
  }
  if (runs.length && runs[0][0] === 'neutral') runs[0][0] = 'base';
  // Kanji in Japanese text / Hanja in Korean text belong to that face.
  const cjk = runs.some(([s]) => s === 'kana') ? 'kana' : (runs.some(([s]) => s === 'hangul') ? 'hangul' : null);
  if (!cjk) return runs;
  const merged = [];
  for (const [s, t] of runs) {
    const sc = s === 'han' ? cjk : s;
    const last = merged[merged.length - 1];
    if (last && last[0] === sc) last[1] += t;
    else merged.push([sc, t]);
  }
  return merged;
}

// Han characters need the right CJK face for the language; kana → JP, hangul → KR.
const RTL = new Set(['arabic', 'hebrew']);

const CJK_BY_LOCALE = { ja: 'cjk-jp', ko: 'cjk-kr', zh: 'cjk-tc', 'zh-CN': 'cjk-sc' };
function faceFor(script, locale) {
  if (script === 'kana') return 'cjk-jp';
  if (script === 'hangul') return 'cjk-kr';
  if (script === 'han') return CJK_BY_LOCALE[locale] || 'cjk-sc';
  return script;
}

const FILES = {
  hebrew: 'NotoSansHebrew-Regular.ttf', arabic: 'NotoSansArabic-Regular.ttf', devanagari: 'NotoSansDevanagari-Regular.ttf',
  bengali: 'NotoSansBengali-Regular.ttf', gurmukhi: 'NotoSansGurmukhi-Regular.ttf', gujarati: 'NotoSansGujarati-Regular.ttf',
  tamil: 'NotoSansTamil-Regular.ttf', telugu: 'NotoSansTelugu-Regular.ttf', kannada: 'NotoSansKannada-Regular.ttf',
  malayalam: 'NotoSansMalayalam-Regular.ttf', sinhala: 'NotoSansSinhala-Regular.ttf', thai: 'NotoSansThai-Regular.ttf',
  lao: 'NotoSansLao-Regular.ttf', myanmar: 'NotoSansMyanmar-Regular.ttf', ethiopic: 'NotoSansEthiopic-Regular.ttf',
  khmer: 'NotoSansKhmer-Regular.ttf',
  'cjk-sc': 'NotoSansSC-Regular.otf', 'cjk-tc': 'NotoSansTC-Regular.otf', 'cjk-jp': 'NotoSansJP-Regular.otf', 'cjk-kr': 'NotoSansKR-Regular.otf',
};

// Faces actually present on disk (resolved once).
function availableFaces(dir = FONT_DIR) {
  const out = {};
  for (const [face, file] of Object.entries(FILES)) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) out[face] = p;
  }
  return out;
}
const FACES = availableFaces();

// Register the script faces on a PDFKit doc and route text through them.
// baseFont: the name already registered for Latin text ('body' or 'Helvetica').
function install(doc, baseFont, locale = 'en', faces = FACES) {
  for (const [face, file] of Object.entries(faces)) doc.registerFont(`face-${face}`, file);
  const fontFor = (script) => {
    const face = faceFor(script, locale);
    return faces[face] ? `face-${face}` : baseFont;
  };
  const origText = doc.text.bind(doc);
  const origWidth = doc.widthOfString.bind(doc);
  // PDFKit's line wrapper measures with widthOfString *while* drawing — those
  // calls must use the run's font as already set, not re-route it.
  let drawing = false;
  const draw = (...a) => { drawing = true; try { return origText(...a); } finally { drawing = false; } };

  doc.widthOfString = (str, opts) => {
    if (drawing) return origWidth(str, opts);
    const runs = splitRuns(str);
    if (runs.length === 1 && fontFor(runs[0][0]) === baseFont) return origWidth(str, opts);
    let w = 0;
    for (const [script, run] of runs) { doc.font(fontFor(script)); w += origWidth(run, opts); }
    doc.font(baseFont);
    return w;
  };

  // RTL runs: PDFKit's word wrapper drops the spaces between shaped RTL
  // words — non-breaking spaces survive (and keep a name on one line).
  const prep = (script, run) => (RTL.has(script) ? run.replace(/ /g, ' ') : run);

  doc.text = (str, ...args) => {
    if (typeof str !== 'string' && typeof str !== 'number') return origText(str, ...args);
    const runs = splitRuns(String(str));
    if (runs.length === 1) {
      doc.font(fontFor(runs[0][0]));
      const r = draw(prep(runs[0][0], String(str)), ...args);
      doc.font(baseFont);
      return r;
    }
    const opts = (typeof args[args.length - 1] === 'object' && args[args.length - 1]) ? args[args.length - 1] : {};
    const pos = typeof args[0] === 'number' ? [args[0], args[1]] : [];

    // Centered / right-aligned single lines: PDFKit aligns each `continued`
    // fragment on its own (they overlap), so lay the runs out ourselves.
    if (opts.align === 'center' || opts.align === 'right') {
      const widths = runs.map(([script, run]) => { doc.font(fontFor(script)); return origWidth(prep(script, run)); });
      const total = widths.reduce((a, b) => a + b, 0);
      const x0 = pos.length ? pos[0] : doc.x;
      const y0 = pos.length ? pos[1] : doc.y;
      const box = opts.width || (doc.page.width - doc.page.margins.right - x0);
      if (total <= box) {
        let x = x0 + (opts.align === 'center' ? (box - total) / 2 : box - total);
        let lineHeight = 0;
        runs.forEach(([script, run], i) => {
          doc.font(fontFor(script));
          lineHeight = Math.max(lineHeight, doc.currentLineHeight(true));
          draw(prep(script, run), x, y0, { lineBreak: false });
          x += widths[i];
        });
        doc.font(baseFont);
        doc.x = x0;
        doc.y = y0 + lineHeight;
        return doc;
      }
    }

    // Otherwise chain runs with `continued`, carrying x/y + options from the call.
    runs.forEach(([script, run], i) => {
      doc.font(fontFor(script));
      const last = i === runs.length - 1;
      if (i === 0) draw(prep(script, run), ...pos, { ...opts, continued: !last });
      else draw(prep(script, run), { ...opts, continued: !last });
    });
    doc.font(baseFont);
    return doc;
  };
  return doc;
}

module.exports = { scriptOf, splitRuns, faceFor, availableFaces, install, FILES, FONT_DIR };
