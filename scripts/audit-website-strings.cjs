const fs = require('fs');
const path = require('path');
const { getStrings } = require('../backend/src/lib/i18n.js');

const s = getStrings();
const en = s.STRINGS.en;
const ROOT = path.join(__dirname, '..');

const htmlFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).map(f => path.join(ROOT, f));
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, 'js', f));

const allFiles = [...htmlFiles, ...jsFiles];
console.log(`Scanning ${allFiles.length} website HTML & JS files for i18n usage...`);

const missingKeys = new Set();
const foundKeys = new Set();

for (const file of allFiles) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');

  // Match data-i18n, data-i18n-placeholder, data-i18n-title, data-i18n-aria
  const domRegex = /data-i18n(?:-[a-z]+)?=["']([^"']+)["']/g;
  let m;
  while ((m = domRegex.exec(content)) !== null) {
    const key = m[1].trim();
    if (!key) continue;
    foundKeys.add(key);
    if (!(key in en)) {
      missingKeys.add(`${key} (in ${rel})`);
    }
  }

  // Match t('key') or t("key")
  const tRegex = /\bt\(\s*['"]([a-zA-Z0-9._-]+)['"]/g;
  while ((m = tRegex.exec(content)) !== null) {
    const key = m[1].trim();
    if (!key) continue;
    foundKeys.add(key);
    if (!(key in en)) {
      missingKeys.add(`${key} (in ${rel})`);
    }
  }
}

console.log(`Total unique i18n keys referenced across website: ${foundKeys.size}`);
console.log(`Unmatched keys: ${missingKeys.size}`);

if (missingKeys.size > 0) {
  console.log('Unmatched keys found:');
  for (const k of missingKeys) {
    console.log('  - ' + k);
  }
  process.exit(1);
} else {
  console.log('SUCCESS: Every single i18n string referenced on the website is defined in STRINGS.en and all 41 languages!');
}
