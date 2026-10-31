// Extract translatable segments from each English site page into
// site-i18n/content/en/<page>.json. Segment ids are content hashes, so when
// English copy changes only the changed segments need re-translation
// (see status.mjs).
//   node scripts/site-i18n/extract.mjs [page.html ...]
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, ROOT, CONTENT, sitePages, segmentsOf, hash, writeJson, LEGAL } from './common.mjs';

const pages = process.argv.slice(2).length ? process.argv.slice(2) : sitePages();
let total = 0;
let words = 0;
for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const doc = new JSDOM(html).window.document;
  const seen = new Set();
  const segments = [];
  for (const s of segmentsOf(doc)) {
    const id = hash(`${s.kind}|${s.text}`);
    if (seen.has(id)) continue; // identical text translates once
    seen.add(id);
    segments.push({ id, kind: s.kind, key: s.key, text: s.text });
    words += s.text.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  }
  writeJson(path.join(CONTENT, 'en', page.replace(/\.html$/, '.json')), { page, legal: LEGAL.has(page), segments });
  total += segments.length;
}
console.log(`${pages.length} pages, ${total} segments, ~${words} words`);
