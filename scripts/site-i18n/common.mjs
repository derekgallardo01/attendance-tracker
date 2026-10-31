// Shared config + segmentation for the static per-locale site generator.
// extract.mjs → site-i18n/content/en/<page>.json (segments to translate)
// validate.mjs → checks site-i18n/content/<loc>/<page>.json against en
// build.mjs → renders /<loc>/<page>.html from the English page + translations
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const { JSDOM } = require('../../backend/node_modules/jsdom');

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTENT = path.join(ROOT, 'site-i18n', 'content');
export const ORIGIN = 'https://attendancetracker.dev';

// The 59 non-English app locales (codes match js/strings.js and /<loc>/ dirs).
export const LOCALES = 'es pt hi tl ms id vi fr de it nl pl tr th ar ko zh ja ta te bn ur zh-CN ru uk ro he mr sv cs da fi hu so sw am si el no ca ne ml mn kn gu pa kk lv lt lo my km ceb bg hr sr sk sl af'.split(' ');
export const RTL = new Set(['ar', 'he', 'ur']);
// hreflang values (BCP 47) for our locale codes.
export const HREFLANG = { zh: 'zh-Hant', 'zh-CN': 'zh-Hans', no: 'nb', tl: 'fil' };
// og:locale (language_TERRITORY).
export const OG_LOCALE = { es: 'es_ES', pt: 'pt_BR', fr: 'fr_FR', de: 'de_DE', it: 'it_IT', nl: 'nl_NL', ja: 'ja_JP', ko: 'ko_KR', zh: 'zh_TW', 'zh-CN': 'zh_CN', ru: 'ru_RU', ar: 'ar_AR', hi: 'hi_IN', tr: 'tr_TR', pl: 'pl_PL', vi: 'vi_VN', id: 'id_ID', th: 'th_TH', uk: 'uk_UA', he: 'he_IL', sv: 'sv_SE', no: 'nb_NO', da: 'da_DK', fi: 'fi_FI', cs: 'cs_CZ', ro: 'ro_RO', hu: 'hu_HU', el: 'el_GR', bg: 'bg_BG', hr: 'hr_HR', sr: 'sr_RS', sk: 'sk_SK', sl: 'sl_SI', ms: 'ms_MY', tl: 'tl_PH', bn: 'bn_BD', ta: 'ta_IN', te: 'te_IN', mr: 'mr_IN', ur: 'ur_PK', sw: 'sw_KE' };

// Pages that are app UI (translated at runtime by js/strings.js) or are
// already-localized landing pages, never generated per locale.
export const EXCLUDE = new Set([
  'index.html', 'pricing.html', 'history.html', 'team.html', 'share.html', 'verify.html', 'setup.html',
  'download.html', 'admin.html', 'help.html', 'unsubscribe.html', 'google114b85a1b49d499d.html',
  'asistencia-google-meet.html', 'lista-de-presenca-google-meet.html', 'diem-danh-google-meet.html',
]);
// Legal pages: translated, but the English version governs.
export const LEGAL = new Set(['privacy.html', 'terms.html', 'refunds.html', 'student-data-privacy.html']);

export function sitePages() {
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !EXCLUDE.has(f)).sort();
}

export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

const INLINE = new Set(['A', 'STRONG', 'EM', 'B', 'I', 'SPAN', 'CODE', 'SMALL', 'SUP', 'SUB', 'BR', 'IMG', 'U', 'MARK', 'ABBR', 'TIME', 'KBD', 'S', 'Q', 'CITE', 'WBR']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'TEMPLATE', 'PRE', 'CANVAS', 'VIDEO', 'SELECT']);
const ATTRS = ['alt', 'title', 'placeholder', 'aria-label'];
const JSONLD_KEYS = new Set(['name', 'description', 'text', 'headline', 'caption', 'abstract', 'articleBody', 'reviewBody']);
const HEAD_META = [
  ['title', null],
  ['meta[name="description"]', 'content'],
  ['meta[property="og:title"]', 'content'],
  ['meta[property="og:description"]', 'content'],
  ['meta[property="og:image:alt"]', 'content'],
  ['meta[name="twitter:title"]', 'content'],
  ['meta[name="twitter:description"]', 'content'],
];

const hasText = (el) => /[\p{L}\p{N}]/u.test(el.textContent || '');
function isUnitCandidate(el) {
  if (SKIP.has(el.tagName) || INLINE.has(el.tagName)) return false;
  if (el.hasAttribute('data-no-translate') || el.getAttribute('translate') === 'no') return false;
  return true;
}
// Deepest block-level elements that hold text; inline markup stays inside.
function hasBlockChild(el) {
  for (const c of el.children) {
    if (SKIP.has(c.tagName)) continue;
    if (!INLINE.has(c.tagName) || hasBlockChild(c)) return true;
  }
  return false;
}
function directText(el) {
  for (const n of el.childNodes) if (n.nodeType === 3 && /[\p{L}\p{N}]/u.test(n.nodeValue)) return true;
  return false;
}

// Walk a page and yield { kind, key, text, node, attr } for every translatable bit.
export function segmentsOf(doc) {
  const out = [];
  for (const [sel, attr] of HEAD_META) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const text = attr ? el.getAttribute(attr) : el.textContent;
    if (text && text.trim()) out.push({ kind: 'head', key: sel, text, node: el, attr });
  }
  const walk = (el) => {
    for (const c of el.children) {
      if (SKIP.has(c.tagName)) continue;
      for (const a of ATTRS) {
        const v = c.getAttribute(a);
        if (v && /[\p{L}]/u.test(v)) out.push({ kind: 'attr', key: a, text: v, node: c, attr: a });
      }
      if (!isUnitCandidate(c)) {
        // Inline element directly in a layout container (nav links, buttons):
        // its own segment, since no block parent will carry it.
        if (INLINE.has(c.tagName) && !hasBlockChild(c) && hasText(c) && c.tagName !== 'BR') {
          out.push({ kind: 'html', key: c.tagName.toLowerCase(), text: c.innerHTML.trim(), node: c });
          for (const d of c.querySelectorAll('*')) {
            for (const a of ATTRS) {
              const v = d.getAttribute(a);
              if (v && /[\p{L}]/u.test(v)) out.push({ kind: 'attr', key: a, text: v, node: d, attr: a });
            }
          }
        } else walk(c);
        continue;
      }
      if (!hasBlockChild(c)) {
        if (hasText(c)) out.push({ kind: 'html', key: c.tagName.toLowerCase(), text: c.innerHTML.trim(), node: c });
        // attributes of inline descendants (img alt, a title)
        for (const d of c.querySelectorAll('*')) {
          for (const a of ATTRS) {
            const v = d.getAttribute(a);
            if (v && /[\p{L}]/u.test(v)) out.push({ kind: 'attr', key: a, text: v, node: d, attr: a });
          }
        }
      } else {
        if (directText(c)) {
          // Mixed block: text nodes beside block children — translate each text node.
          for (const n of c.childNodes) {
            if (n.nodeType === 3 && /[\p{L}]/u.test(n.nodeValue)) out.push({ kind: 'textnode', key: c.tagName.toLowerCase(), text: n.nodeValue.trim(), node: n });
          }
        }
        walk(c);
      }
    }
  };
  walk(doc.body);
  // JSON-LD string values
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s, i) => {
    let data;
    try { data = JSON.parse(s.textContent); } catch { return; }
    const visit = (v, k) => {
      if (Array.isArray(v)) v.forEach((x) => visit(x, k));
      else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) visit(vv, kk);
      else if (typeof v === 'string' && JSONLD_KEYS.has(k) && /[\p{L}]{2}/u.test(v) && !/^https?:/.test(v)) {
        out.push({ kind: 'jsonld', key: `${i}:${k}`, text: v, node: s });
      }
    };
    visit(data, null);
  });
  return out;
}

export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
