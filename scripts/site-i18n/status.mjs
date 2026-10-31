// Translation coverage + freshness per locale.
//   node scripts/site-i18n/status.mjs [--pages]
// "stale" = translated ids no longer in the English source (copy changed);
// "missing" = English segments without a translation. Re-run extract.mjs
// after editing an English page, then translate only the missing ids.
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT, LOCALES, readJson, sitePages } from './common.mjs';

const pages = sitePages().map((p) => p.replace(/\.html$/, '.json'));
const en = Object.fromEntries(pages.filter((p) => fs.existsSync(path.join(CONTENT, 'en', p))).map((p) => [p, readJson(path.join(CONTENT, 'en', p))]));
const totalSegs = Object.values(en).reduce((a, j) => a + j.segments.length, 0);
const rows = [];
for (const loc of LOCALES) {
  let done = 0; let missing = 0; let stale = 0; let pagesDone = 0;
  for (const [p, src] of Object.entries(en)) {
    const f = path.join(CONTENT, loc, p);
    if (!fs.existsSync(f)) { missing += src.segments.length; continue; }
    const tr = readJson(f).translations || {};
    const ids = new Set(src.segments.map((s) => s.id));
    const have = src.segments.filter((s) => typeof tr[s.id] === 'string' && tr[s.id].trim()).length;
    done += have; missing += src.segments.length - have;
    stale += Object.keys(tr).filter((id) => !ids.has(id)).length;
    if (have === src.segments.length) pagesDone++;
  }
  rows.push([loc, pagesDone, done, missing, stale]);
}
const complete = rows.filter((r) => r[3] === 0).length;
console.log(`${Object.keys(en).length} pages, ${totalSegs} segments per locale; ${complete}/${LOCALES.length} locales complete`);
for (const [loc, pagesDone, done, missing, stale] of rows) {
  if (process.argv.includes('--all') || done) console.log(`${loc.padEnd(6)} pages ${String(pagesDone).padStart(2)}/${Object.keys(en).length}  segments ${done}/${totalSegs}${stale ? `  stale ${stale}` : ''}`);
}
