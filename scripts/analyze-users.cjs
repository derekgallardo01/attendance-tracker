const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'lifetime_user_activity.csv');
const content = fs.readFileSync(csvPath, 'utf8');

const { normalizeLocale, getStrings } = require('../backend/src/lib/i18n.js');
const { getAvailableLocales } = getStrings();
const supportedLocales = new Set(getAvailableLocales().map(l => l.code));

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const header = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = vals[idx] || '';
    });
    rows.push(obj);
  }
  return rows;
}

function parseLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i+1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

const rows = parseCSV(content);

// Linguistic detection based on geo (city/country), domain, and name
function detectUserLanguages(r) {
  const geo = (r.geo || '').trim();
  const domain = (r.domain || '').trim().toLowerCase();
  const email = (r.email || '').trim().toLowerCase();
  const parts = geo.split(',').map(p => p.trim());
  const country = parts.length > 0 ? parts[parts.length - 1].toUpperCase() : '';
  const city = parts.length > 1 ? parts[0] : '';

  // 1. Check specific subnational cities/regions in multilingual countries
  if (country === 'IN') {
    if (city === 'Kochi' || city === 'Kollam') {
      return [{ code: 'ml', name: 'Malayalam', native: true, fallback: 'hi' }];
    }
    if (city === 'Surat') {
      return [{ code: 'gu', name: 'Gujarati', native: true, fallback: 'hi' }];
    }
    if (city === 'Chennai' || city === 'Auroville' || city === 'Coimbatore' || /trichy/i.test(email)) {
      return [{ code: 'ta', name: 'Tamil', native: true, fallback: 'hi' }];
    }
    if (city === 'Hyderabad') {
      return [{ code: 'te', name: 'Telugu', native: true, fallback: 'hi' }];
    }
    if (city === 'Pune' || city === 'Mumbai') {
      return [{ code: 'mr', name: 'Marathi', native: true, fallback: 'hi' }];
    }
    if (city === 'Kolkata' || /jisgroup/i.test(domain)) {
      return [{ code: 'bn', name: 'Bengali', native: true, fallback: 'hi' }];
    }
    return [{ code: 'hi', name: 'Hindi', native: true, fallback: 'en' }];
  }

  if (country === 'ES') {
    if (city === 'Elizondo' || /navarra/i.test(domain)) {
      return [{ code: 'eu', name: 'Basque', native: true, fallback: 'es' }];
    }
    return [{ code: 'es', name: 'Spanish', native: true, fallback: 'es' }];
  }

  if (country === 'KZ') {
    return [{ code: 'kk', name: 'Kazakh', native: true, fallback: 'ru' }];
  }

  if (country === 'MN') {
    return [{ code: 'mn', name: 'Mongolian', native: true, fallback: 'en' }];
  }

  if (country === 'MV') {
    return [{ code: 'dv', name: 'Dhivehi', native: true, fallback: 'en' }];
  }

  if (country === 'ZA') {
    return [{ code: 'zu', name: 'isiZulu', native: true, fallback: 'en' }];
  }

  if (country === 'RW') {
    return [{ code: 'rw', name: 'Kinyarwanda', native: true, fallback: 'fr' }];
  }

  if (country === 'BW') {
    return [{ code: 'tn', name: 'Setswana', native: true, fallback: 'en' }];
  }

  if (country === 'PH') {
    if (city === 'Cebu City' || city === 'Calape' || city === 'Koronadal') {
      return [{ code: 'ceb', name: 'Cebuano', native: true, fallback: 'tl' }];
    }
    return [{ code: 'tl', name: 'Tagalog', native: true, fallback: 'tl' }];
  }

  // Country fallback from platform
  const norm = normalizeLocale(null, country);
  return [{ code: norm, name: norm, native: true, fallback: 'en' }];
}

// Audit stats
const langStats = {};

for (const r of rows) {
  const events = parseInt(r.totalEvents, 10) || 0;
  const exportsCount = parseInt(r.exportsCount, 10) || 0;
  const langs = detectUserLanguages(r);

  for (const l of langs) {
    if (!langStats[l.code]) {
      langStats[l.code] = {
        code: l.code,
        name: l.name,
        isSupported: supportedLocales.has(l.code),
        fallback: l.fallback,
        userCount: 0,
        totalEvents: 0,
        exportsCount: 0,
        users: [],
      };
    }
    langStats[l.code].userCount++;
    langStats[l.code].totalEvents += events;
    langStats[l.code].exportsCount += exportsCount;
    langStats[l.code].users.push({
      email: r.email,
      name: r.displayName,
      geo: r.geo,
      events,
      exportsCount
    });
  }
}

console.log('='.repeat(80));
console.log('ATTENDANCE TRACKER — SIGNUP LANGUAGE COVERAGE AUDIT');
console.log('='.repeat(80));
console.log(`Total active user signups analyzed: ${rows.length}`);
console.log(`Platform supported locales: ${supportedLocales.size}`);
console.log('');

console.log('UNCOVERED LANGUAGES (Languages spoken by signed-up users with NO native UI dictionary):');
console.log('-'.repeat(80));

const uncovered = Object.values(langStats)
  .filter(l => !l.isSupported)
  .sort((a, b) => b.totalEvents - a.totalEvents);

console.log(
  '| Language | Code | Users | Total Events | Exports | Fallback Status | Priority |'
);
console.log(
  '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |'
);

for (const l of uncovered) {
  let priority = 'P3 (Low)';
  if (l.totalEvents > 800) priority = 'P0 (Critical)';
  else if (l.totalEvents > 300) priority = 'P1 (High)';
  else if (l.totalEvents > 50) priority = 'P2 (Medium)';

  console.log(
    `| **${l.name}** | \`${l.code}\` | ${l.userCount} | **${l.totalEvents}** | ${l.exportsCount} | Falls back to \`${l.fallback}\` | **${priority}** |`
  );
}

console.log('\nTop Uncovered Language User Details:');
for (const l of uncovered) {
  console.log(`\n### ${l.name} (\`${l.code}\`): ${l.totalEvents} events, ${l.userCount} users`);
  l.users.sort((a,b) => b.events - a.events).slice(0, 5).forEach(u => {
    console.log(`  - ${u.email} (${u.name || 'Anonymous'}) [${u.geo || 'No geo'}] — ${u.events} events, ${u.exportsCount} exports`);
  });
}
