// Validate site translations against the English segments.
//   node scripts/site-i18n/validate.mjs [loc ...]      (default: every loc dir present)
// Translation file: site-i18n/content/<loc>/<page>.json = { page, translations: { <id>: "<text>" } }
// Checks: every id present; markup preserved (same tags, same href/src values);
// no English-identical prose; length sane. Exit 1 on errors.
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT, readJson } from './common.mjs';

const tagSig = (html) => (html.match(/<\/?[a-zA-Z][^>]*>/g) || [])
  .map((t) => t.replace(/\s(?!href|src)[a-z-]+="[^"]*"/g, '').replace(/\s+/g, ' ').toLowerCase())
  .sort().join('|');
const words = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').trim();
// Strings that legitimately stay as-is (brand, product names, URLs, codes).
const KEEP = /^(Attendance Tracker|Google Meet|Google Sheets|Google Classroom|Canvas|Moodle|Slack|Discord|Excel|CSV|PDF|FAQ|Pro|LMS|SSO|API|[\d\s.,:%$€£₹\-–—+/()#×@]+)$/i;

export function validateLocale(loc) {
  const dir = path.join(CONTENT, loc);
  const errors = [];
  let pages = 0;
  let missing = 0;
  if (!fs.existsSync(dir)) return { errors: [`${loc}: no translations`], pages, missing };
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const enFile = path.join(CONTENT, 'en', file);
    if (!fs.existsSync(enFile)) { errors.push(`${loc}/${file}: no English source (stale page?)`); continue; }
    const en = readJson(enFile);
    let tr;
    try { tr = readJson(path.join(dir, file)).translations || {}; } catch (e) { errors.push(`${loc}/${file}: bad JSON ${e.message}`); continue; }
    pages++;
    for (const seg of en.segments) {
      const t = tr[seg.id];
      if (typeof t !== 'string' || !t.trim()) { missing++; continue; }
      if (seg.kind === 'html' && tagSig(seg.text) !== tagSig(t)) errors.push(`${loc}/${file} ${seg.id}: markup changed`);
      if (/<script|javascript:/i.test(t)) errors.push(`${loc}/${file} ${seg.id}: script content`);
      const plain = words(seg.text);
      if (t.trim() === seg.text.trim() && plain.length > 12 && !KEEP.test(plain)) errors.push(`${loc}/${file} ${seg.id}: identical to English`);
      const ratio = words(t).length / Math.max(1, plain.length);
      if (plain.length > 40 && (ratio < 0.25 || ratio > 4)) errors.push(`${loc}/${file} ${seg.id}: length ratio ${ratio.toFixed(2)}`);
    }
    for (const id of Object.keys(tr)) if (!en.segments.some((s) => s.id === id)) errors.push(`${loc}/${file} ${id}: unknown id (stale)`);
  }
  return { errors, pages, missing };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('validate.mjs')) {
  const locs = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(CONTENT).filter((d) => d !== 'en');
  let bad = 0;
  for (const loc of locs) {
    const { errors, pages, missing } = validateLocale(loc);
    console.log(`${loc}: ${pages} pages, ${missing} missing segments, ${errors.length} errors`);
    for (const e of errors.slice(0, 20)) console.log('  ' + e);
    bad += errors.length;
  }
  process.exit(bad ? 1 : 0);
}
