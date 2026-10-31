// Render /<loc>/<page>.html for every translated page.
//   node scripts/site-i18n/build.mjs [loc ...]
// Each page = the English page with its segments swapped for translations,
// plus: <html lang/dir>, self canonical, a full hreflang cluster, og:locale,
// og:url, JSON-LD inLanguage, relative links fixed for the /<loc>/ folder,
// and (legal pages) an "English version governs" notice. Missing segments
// fall back to English. English source pages get the same hreflang cluster.
import fs from 'node:fs';
import path from 'node:path';
import {
  JSDOM, ROOT, CONTENT, ORIGIN, LOCALES, RTL, HREFLANG, OG_LOCALE, LEGAL,
  sitePages, segmentsOf, hash, readJson,
} from './common.mjs';

const pages = sitePages();
const trPath = (loc, page) => path.join(CONTENT, loc, page.replace(/\.html$/, '.json'));
const hasTr = (loc, page) => fs.existsSync(trPath(loc, page));
// Locales a page exists in (English always).
const localesOf = (page) => LOCALES.filter((loc) => hasTr(loc, page));
const urlOf = (loc, page) => (loc === 'en' ? `${ORIGIN}/${page}` : `${ORIGIN}/${loc}/${page}`);

// Legal notice, per locale (site-i18n/legal-notice.json: { loc: text }).
const NOTICE_FILE = path.join(ROOT, 'site-i18n', 'legal-notice.json');
const NOTICES = fs.existsSync(NOTICE_FILE) ? readJson(NOTICE_FILE) : {};

function setHreflang(doc, page) {
  doc.querySelectorAll('link[rel="alternate"][hreflang]').forEach((l) => l.remove());
  const head = doc.head;
  const add = (lang, href) => {
    const l = doc.createElement('link');
    l.setAttribute('rel', 'alternate');
    l.setAttribute('hreflang', lang);
    l.setAttribute('href', href);
    head.appendChild(l);
  };
  add('x-default', urlOf('en', page));
  add('en', urlOf('en', page));
  for (const loc of localesOf(page)) add(HREFLANG[loc] || loc, urlOf(loc, page));
}

function fixLinks(doc, loc) {
  const fix = (el, attr) => {
    const v = el.getAttribute(attr);
    if (!v || /^(https?:|mailto:|tel:|#|data:|\/\/|javascript:)/i.test(v)) return;
    if (v.startsWith('/')) {
      if (v === '/' || v.startsWith('/?')) el.setAttribute(attr, `/?lang=${loc}`);
      return;
    }
    const [file, rest = ''] = v.split(/(?=[?#])/);
    if (pages.includes(file) && hasTr(loc, file)) return; // sibling translated page
    el.setAttribute(attr, `../${file}${file === 'pricing.html' && !rest ? `?lang=${loc}` : ''}${rest}`);
  };
  doc.querySelectorAll('[href]').forEach((el) => { if (el.tagName !== 'LINK' || el.getAttribute('rel') !== 'alternate') fix(el, 'href'); });
  doc.querySelectorAll('[src]').forEach((el) => fix(el, 'src'));
}

export function renderPage(page, loc) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const tr = readJson(trPath(loc, page)).translations || {};
  let missing = 0;
  const jsonldMaps = new Map();
  for (const s of segmentsOf(doc)) {
    const t = tr[hash(`${s.kind}|${s.text}`)];
    if (typeof t !== 'string' || !t.trim()) { missing++; continue; }
    if (s.kind === 'html') s.node.innerHTML = t;
    else if (s.kind === 'attr' || (s.kind === 'head' && s.attr)) s.node.setAttribute(s.attr, t);
    else if (s.kind === 'head') s.node.textContent = t;
    else if (s.kind === 'textnode') s.node.nodeValue = s.node.nodeValue.replace(s.text, t);
    else if (s.kind === 'jsonld') {
      if (!jsonldMaps.has(s.node)) jsonldMaps.set(s.node, new Map());
      jsonldMaps.get(s.node).set(s.text, t);
    }
  }
  for (const [script, map] of jsonldMaps) {
    const data = JSON.parse(script.textContent);
    const swap = (v) => (Array.isArray(v) ? v.map(swap)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
      : typeof v === 'string' && map.has(v) ? map.get(v) : v);
    const out = swap(data);
    const tag = (o) => { if (o && typeof o === 'object' && !Array.isArray(o) && o['@type']) o.inLanguage = HREFLANG[loc] || loc; };
    if (Array.isArray(out['@graph'])) out['@graph'].forEach(tag); else tag(out);
    script.textContent = `\n${JSON.stringify(out, null, 2)}\n`;
  }

  doc.documentElement.setAttribute('lang', HREFLANG[loc] || loc);
  doc.documentElement.setAttribute('dir', RTL.has(loc) ? 'rtl' : 'ltr');
  doc.documentElement.setAttribute('data-site-locale', loc); // js/strings.js honors this
  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', urlOf(loc, page));
  const ogUrl = doc.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute('content', urlOf(loc, page));
  let ogLocale = doc.querySelector('meta[property="og:locale"]');
  if (!ogLocale) {
    ogLocale = doc.createElement('meta');
    ogLocale.setAttribute('property', 'og:locale');
    doc.head.appendChild(ogLocale);
  }
  ogLocale.setAttribute('content', OG_LOCALE[loc] || loc.replace('-', '_'));
  setHreflang(doc, page);
  fixLinks(doc, loc);
  // Google Translate widgets are obsolete on real translations.
  doc.querySelectorAll('#google_translate_element, script[src*="translate.google"]').forEach((el) => el.remove());

  if (LEGAL.has(page) && NOTICES[loc]) {
    const h1 = doc.querySelector('h1');
    const note = doc.createElement('p');
    note.setAttribute('class', 'legal-translation-notice');
    note.setAttribute('style', 'border:1px solid #30363d;border-radius:8px;padding:10px 12px;font-size:13px;opacity:.85');
    note.textContent = NOTICES[loc];
    if (h1) h1.after(note); else doc.body.prepend(note);
  }
  return { html: dom.serialize(), missing };
}

// English sources carry the same hreflang cluster (no other changes).
function updateEnglishCluster(page) {
  if (!localesOf(page).length) return false;
  const file = path.join(ROOT, page);
  const src = fs.readFileSync(file, 'utf8');
  const links = [`<link rel="alternate" hreflang="x-default" href="${urlOf('en', page)}" />`, `<link rel="alternate" hreflang="en" href="${urlOf('en', page)}" />`,
    ...localesOf(page).map((loc) => `<link rel="alternate" hreflang="${HREFLANG[loc] || loc}" href="${urlOf(loc, page)}" />`)];
  const stripped = src.replace(/[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*" \/>\r?\n/g, '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const next = stripped.replace(/(<link rel="canonical"[^>]*>\r?\n)/, `$1${links.map((l) => `  ${l}`).join(eol)}${eol}`);
  if (next !== src) { fs.writeFileSync(file, next); return true; }
  return false;
}

if (process.argv[1].endsWith('build.mjs')) {
  const locs = process.argv.slice(2).length ? process.argv.slice(2) : LOCALES;
  let built = 0;
  let missing = 0;
  for (const loc of locs) {
    for (const page of pages.filter((p) => hasTr(loc, p))) {
      const r = renderPage(page, loc);
      fs.mkdirSync(path.join(ROOT, loc), { recursive: true });
      fs.writeFileSync(path.join(ROOT, loc, page), r.html);
      built++;
      missing += r.missing;
    }
  }
  let english = 0;
  for (const page of pages) if (updateEnglishCluster(page)) english++;
  const urls = writeSitemap();
  console.log(`built ${built} pages (${missing} untranslated segments fell back to English); hreflang updated on ${english} English pages; sitemap-i18n.xml: ${urls} URLs`);
}

// sitemap-i18n.xml: every translated URL with its full alternate cluster
// (referenced from robots.txt; the main sitemap.xml keeps the English pages).
function writeSitemap() {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"', '        xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
  let n = 0;
  for (const page of pages) {
    const locs = localesOf(page);
    if (!locs.length) continue;
    const alts = [['x-default', urlOf('en', page)], ['en', urlOf('en', page)], ...locs.map((l) => [HREFLANG[l] || l, urlOf(l, page)])];
    for (const loc of locs) {
      lines.push('  <url>', `    <loc>${urlOf(loc, page)}</loc>`);
      for (const [hl, href] of alts) lines.push(`    <xhtml:link rel="alternate" hreflang="${hl}" href="${href}" />`);
      lines.push('  </url>');
      n++;
    }
  }
  lines.push('</urlset>', '');
  fs.writeFileSync(path.join(ROOT, 'sitemap-i18n.xml'), lines.join('\n'));
  return n;
}
