#!/usr/bin/env node
/**
 * Attendance Tracker — Automated Daily Backlink Discovery, Queue & Follow-Up Routine
 *
 * Usage:
 *   node scripts/daily-backlink-routine.cjs --status
 *   node scripts/daily-backlink-routine.cjs --ingest --queue --limit 30
 *   node scripts/daily-backlink-routine.cjs --follow-up --dry-run --limit 10
 *   node scripts/daily-backlink-routine.cjs --follow-up --send --limit 10
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');
const EXPORTS_DIR = path.join(DOCS_DIR, 'ahrefs-exports');
const DOWNLOADS_DIR = 'C:\\Users\\Derek\\Downloads';
const QUEUE_FILE = path.join(DOCS_DIR, 'daily-outreach-queue.json');
const FOLLOWUP_LOG_FILE = path.join(DOCS_DIR, 'followup-dispatch-log.json');

function resolveResendApiKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  for (const rel of ['.env', 'backend/.env']) {
    const p = path.join(ROOT_DIR, rel);
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, 'utf8').match(/^RESEND_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return '';
}
const RESEND_API_KEY = resolveResendApiKey();
const FROM_EMAIL = 'Derek Gallardo <derek@attendancetracker.dev>';
const REPLY_TO = 'derek@attendancetracker.dev';

// Excluded non-editorial / mega-platform / UGC / paste / directory scraper domains
const EXCLUDED_DOMAINS = new Set([
  'google.com', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com',
  'linkedin.com', 'instagram.com', 'reddit.com', 'pinterest.com', 'tiktok.com',
  'github.com', 'gitlab.com', 'medium.com', 'substack.com', 'wikipedia.org',
  'wikimedia.org', 'wordpress.org', 'wordpress.com', 'blogspot.com', 't.co',
  'bit.ly', 'youtu.be', 'apple.com', 'microsoft.com', 'amazon.com',
  'cloudflare.com', 'mozilla.org', 'chrome.google.com', 'chromewebstore.google.com',
  'attendancetracker.dev', 'tactiq.io', 'scribbl.co', 'attendlist.com',
  'claycodes.org', 'meetlist.io', 'codebeautify.org', 'linktr.ee', 'diigo.com',
  'threadreaderapp.com', 'gnomio.com', 'softonic.com', 'patreon.com',
  'ko-fi.com', 'buymeacoffee.com', 'archive.org', 'scribd.com', 'slideshare.net',
  'issuu.com', 'yumpu.com', 'padlet.com', 'wakelet.com', 'symbaloo.com',
  'pearltrees.com', 'scoop.it', 'evernote.com', 'notion.so', 'notion.site',
  'canva.com', 'prezi.com', 'genial.ly', 'iteslj.org', 'livejournal.com',
  'tumblr.com', 'quora.com', 'vimeo.com', 'dailymotion.com', 'soundcloud.com',
  'spotify.com', 'discord.com', 'telegram.org', 'whatsapp.com', 'line.me',
  'naver.com', 'hatena.ne.jp', 'ameblo.jp', 'note.com', 'qiita.com', 'zenn.dev',
  'baidu.com', 'zhihu.com', 'csdn.net', 'jianshu.com', 'weibo.com', 'qq.com',
  '163.com', 'sohu.com', 'bilibili.com', 'vk.com', 'ok.ru', 'yandex.ru'
]);

// Known replied or bounced addresses/domains to skip on follow-ups
const DO_NOT_FOLLOW_UP_DOMAINS = new Set([
  'usf.edu.br', 'hypescribe.com', 'whisperbot.ai', 'plaud.ai', 'screenapp.io',
  'govisually.com', 'dupple.com', 'rottenwifi.com', 'itechguides.com',
  'sprintzeal.com', 'autogpt.net', 'univasf.edu.br', 'cultofpedagogy.com',
  'shakeuplearning.com', 'controlaltachieve.com', 'ditchthattextbook.com',
  'coworker.ai', 'keepproductive.com', 'toolfinder.com', 'toolfolio.com',
  'pgconcept.com', 'remote.tools', 'fathom.video', 'getmarlee.com',
  'klap.app', 'ringy.com', 'capsulink.com', 'gentrop.com', 'marketinglad.io',
  'themarketingagency.ca', 'companionlink.com', 'aitoptools.com', 'outofbit.it',
  'borjagiron.com', 'talentedladiesclub.com', 'wallstreetmojo.com',
  'superpowerdaily.com', 'zerodevice.net', 'clepher.com', 'amitsarda.xyz',
  'insightpartners.com', 'ultimatetools.eu', 'cloudo3.com',
  'productivityshift.com', 'findmyaitool.io', 'chiarasangels.net',
  'calbizjournal.com', 'nealschaffer.com', 'techbullion.com', 'fast.io',
  'zipdo.co', 'isenacode.com', 'isenacode.net', 'skrapp.io', 'assemblyai.com',
  'nimdzi.com', 'webcatalog.io', 'remotefirstjobs.com', 'freetech4teachers.com',
  'ericcurts@gmail.com'
]);

function extractRootDomain(input) {
  if (!input) return '';
  let host = String(input).trim().toLowerCase();
  try {
    if (host.includes('://')) {
      host = new URL(host).hostname.toLowerCase();
    } else if (host.includes('@')) {
      host = host.split('@').pop().toLowerCase();
    } else {
      host = host.split('/')[0].toLowerCase();
    }
  } catch (_) {
    host = host.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  }
  host = host.replace(/^www\d*\./, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const twoPartTlds = new Set([
    'edu.br', 'org.br', 'com.br', 'gov.br', 'edu.pe', 'edu.ar', 'edu.mx',
    'edu.co', 'edu.my', 'edu.tw', 'com.tw', 'org.tw', 'edu.pk', 'edu.vn',
    'com.vn', 'edu.rs', 'ac.id', 'co.id', 'net.id', 'ac.jp', 'co.jp',
    'ac.in', 'co.in', 'edu.au', 'com.au', 'org.uk', 'co.uk', 'ac.uk',
    'qc.ca', 'edu.it', 'com.hk', 'com.sg', 'edu.tr', 'k12.ca.us', 'k12.tx.us',
    'k12.ny.us', 'k12.fl.us', 'k12.il.us', 'k12.nj.us', 'k12.pa.us'
  ]);
  const lastTwo = parts.slice(-2).join('.');
  if (twoPartTlds.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

function addDomainVariants(set, dom) {
  if (!dom) return;
  set.add(dom);
  // Also normalize Brazilian .edu.br <-> .br university equivalents (e.g., ufjf.edu.br <-> ufjf.br)
  if (dom.endsWith('.edu.br')) {
    set.add(dom.replace(/\.edu\.br$/, '.br'));
  } else if (dom.endsWith('.br') && !dom.endsWith('.com.br') && !dom.endsWith('.org.br') && !dom.endsWith('.gov.br')) {
    set.add(dom.replace(/\.br$/, '.edu.br'));
  }
}

function loadContactedState() {
  const contactedDomains = new Set();
  const contactedEmails = new Set();
  const allDispatched = [];

  if (fs.existsSync(DOCS_DIR)) {
    const files = fs.readdirSync(DOCS_DIR).filter(
      (f) => f.endsWith('-dispatch-log.json') && f !== 'followup-dispatch-log.json'
    );

    for (const file of files) {
      const fullPath = path.join(DOCS_DIR, file);
      try {
        const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        const entries = Array.isArray(raw)
          ? raw.map((item, idx) => [String(idx), item])
          : raw && typeof raw === 'object'
          ? Object.entries(raw)
          : [];

        for (const [key, entry] of entries) {
          if (!entry || typeof entry !== 'object') continue;
          const toList = Array.isArray(entry.to)
            ? entry.to
            : entry.to
            ? [entry.to]
            : entry.email
            ? [entry.email]
            : [];
          const ccList = Array.isArray(entry.cc) ? entry.cc : entry.cc ? [entry.cc] : [];
          for (const email of [...toList, ...ccList]) {
            const clean = String(email).trim().toLowerCase();
            if (clean && clean.includes('@')) {
              contactedEmails.add(clean);
              addDomainVariants(contactedDomains, extractRootDomain(clean));
            }
          }
          for (const urlField of [entry.targetUrl, entry.url, entry.domain, entry.pageUrl]) {
            if (urlField) {
              addDomainVariants(contactedDomains, extractRootDomain(urlField));
            }
          }
          allDispatched.push({
            waveFile: file,
            key,
            ...entry
          });
        }
      } catch (_) {
        // Ignore malformed log
      }
    }
  }

  // Also scan scripts/send-*.cjs to capture every targetUrl / page URL referenced in outreach scripts
  if (fs.existsSync(SCRIPTS_DIR)) {
    const scriptFiles = fs.readdirSync(SCRIPTS_DIR).filter(
      (f) => f.startsWith('send-') && f.endsWith('.cjs')
    );
    const urlRegex = /https?:\/\/[^\s"'`)<>]+/g;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    for (const sf of scriptFiles) {
      try {
        const src = fs.readFileSync(path.join(SCRIPTS_DIR, sf), 'utf8');
        const urls = src.match(urlRegex) || [];
        for (const u of urls) {
          const dom = extractRootDomain(u);
          if (dom && dom !== 'attendancetracker.dev' && dom !== 'api.resend.com') {
            addDomainVariants(contactedDomains, dom);
          }
        }
        const emails = src.match(emailRegex) || [];
        for (const e of emails) {
          const clean = e.toLowerCase();
          if (clean !== 'derek@attendancetracker.dev' && clean !== 'derekgallardo01@gmail.com') {
            contactedEmails.add(clean);
            addDomainVariants(contactedDomains, extractRootDomain(clean));
          }
        }
      } catch (_) {
        // Ignore read error
      }
    }
  }

  return { contactedDomains, contactedEmails, allDispatched };
}

function ingestDownloadsCsvs() {
  if (!fs.existsSync(DOWNLOADS_DIR)) return [];
  if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  const relevantPrefixes = [
    'chrome.google.com-webstore-detail-meet-atten',
    'chrome.google.com-webstore-detail-google-mee',
    'support.google.com-meet',
    'scribbl.co',
    'tactiq.io',
    'attendlist.com',
    'claycodes.org',
    'meetlist.io'
  ];

  const existingFiles = new Set(fs.readdirSync(EXPORTS_DIR));
  const dlFiles = fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.endsWith('.csv'));
  const ingested = [];

  for (const file of dlFiles) {
    const lower = file.toLowerCase();
    if (!relevantPrefixes.some((p) => lower.startsWith(p))) continue;
    const utf8Name = file.replace(/\.csv$/i, '-utf8.csv');
    if (existingFiles.has(utf8Name) || existingFiles.has(file)) continue;

    const srcPath = path.join(DOWNLOADS_DIR, file);
    const destPath = path.join(EXPORTS_DIR, utf8Name);
    const buf = fs.readFileSync(srcPath);

    let text;
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      text = buf.slice(2).toString('utf16le');
    } else {
      text = buf.toString('utf8');
    }
    fs.writeFileSync(destPath, text, 'utf8');
    ingested.push(utf8Name);
  }

  return ingested;
}

function parseTsvOrCsvLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function computeOpportunityScore(row) {
  const dr = parseFloat(row.dr) || 0;
  let score = Math.min(45, dr * 0.45);

  if (!row.isNofollow) score += 10;

  const targetLower = (row.targetUrl || '').toLowerCase();
  const isDeadExtension =
    targetLower.includes('nenibigflkdikhamlnekfppbganmojlg') ||
    targetLower.includes('appcnhiefcidclcdjeahgklghghihfok');

  if (isDeadExtension) {
    score += 35;
  } else if (targetLower.includes('claycodes.org') || targetLower.includes('meetlist.io')) {
    score += 20;
  }

  const dom = row.rootDomain;
  const isEduOrGov =
    dom.endsWith('.edu') ||
    dom.includes('.edu.') ||
    dom.includes('.ac.') ||
    dom.endsWith('.gov') ||
    dom.endsWith('.org');

  const contextText = `${row.pageTitle || ''} ${row.anchor || ''} ${row.refPageUrl || ''}`.toLowerCase();

  // Specific attendance & roster tracking keywords
  const isDirectMeetingAttendance =
    contextText.includes('attendance') ||
    contextText.includes('presença') ||
    contextText.includes('asistencia') ||
    contextText.includes('điểm danh') ||
    contextText.includes('點名') ||
    contextText.includes('anwesenheit') ||
    contextText.includes('presenze') ||
    contextText.includes('roster');

  // Video conferencing, remote work & online teaching keywords
  const isMeetOrVideo =
    contextText.includes('google meet') ||
    contextText.includes('google classroom') ||
    contextText.includes('hangouts meet') ||
    contextText.includes('video conferenc') ||
    contextText.includes('videoconferenc') ||
    contextText.includes('reunión') ||
    contextText.includes('reuni') ||
    contextText.includes('meeting') ||
    contextText.includes('remote work') ||
    contextText.includes('online teaching') ||
    contextText.includes('online class') ||
    contextText.includes('course development') ||
    contextText.includes('virtual classroom') ||
    contextText.includes('remote teach') ||
    contextText.includes('zoom') ||
    contextText.includes('microsoft teams');

  // Extension / Add-on keywords (must be in software context, not university extension service)
  const isExtensionContext =
    contextText.includes('chrome extension') ||
    contextText.includes('browser extension') ||
    contextText.includes('add-on') ||
    contextText.includes('addon') ||
    contextText.includes('web store');

  // Exclude false positives: agricultural cooperative extension subdomains unless meeting-related
  if (dom.includes('extension.') && !isDirectMeetingAttendance && !isMeetOrVideo) {
    return 0;
  }
  // Exclude government registers and mailing list archives
  if ((dom.includes('federalregister.gov') || dom.includes('govinfo.gov') || row.refPageUrl.includes('hyperkitty')) && !isDirectMeetingAttendance) {
    return 0;
  }

  let relevanceBonus = 0;
  if (isDirectMeetingAttendance) relevanceBonus += 25;
  if (isMeetOrVideo) relevanceBonus += 15;
  if (isExtensionContext) relevanceBonus += 10;

  // Strict guard: if there is ZERO meeting/attendance context and it is NOT a dead extension link, reject
  if (relevanceBonus === 0 && !isDeadExtension) {
    return 0;
  }

  score += relevanceBonus;
  if (isEduOrGov) score += 10;

  return Math.min(100, Math.round(score * 10) / 10);
}

function buildDailyOutreachQueue(limit = 30) {
  const { contactedDomains } = loadContactedState();
  if (!fs.existsSync(EXPORTS_DIR)) return { totalUncontactedDomainsInPool: 0, queueCount: 0, queue: [] };

  const csvFiles = fs.readdirSync(EXPORTS_DIR).filter((f) => f.endsWith('.csv'));
  const domainMap = new Map();

  for (const file of csvFiles) {
    const content = fs.readFileSync(path.join(EXPORTS_DIR, file), 'utf8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;

    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const headers = parseTsvOrCsvLine(lines[0], delimiter).map((h) => h.trim().toLowerCase());

    const idxRefUrl = headers.findIndex((h) => h === 'referring page url');
    const idxTitle = headers.findIndex((h) => h === 'referring page title');
    const idxDr = headers.findIndex((h) => h === 'domain rating');
    const idxTargetUrl = headers.findIndex((h) => h === 'target url');
    const idxAnchor = headers.findIndex((h) => h === 'anchor');
    const idxNofollow = headers.findIndex((h) => h === 'nofollow');

    if (idxRefUrl === -1) continue;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseTsvOrCsvLine(lines[i], delimiter);
      const refPageUrl = (cols[idxRefUrl] || '').trim();
      if (!refPageUrl.startsWith('http')) continue;
      const lowerRefUrl = refPageUrl.toLowerCase();
      if (lowerRefUrl.endsWith('.pdf') || lowerRefUrl.endsWith('.xml') || lowerRefUrl.endsWith('.rss')) continue;

      const rootDomain = extractRootDomain(refPageUrl);
      if (!rootDomain || EXCLUDED_DOMAINS.has(rootDomain) || contactedDomains.has(rootDomain)) {
        continue;
      }

      const dr = parseFloat(cols[idxDr]) || 0;
      const pageTitle = (cols[idxTitle] || '').trim();
      const targetUrl = (cols[idxTargetUrl] || '').trim();
      const anchor = (cols[idxAnchor] || '').trim();
      const isNofollow = String(cols[idxNofollow] || '').toLowerCase() === 'true';
      if (isNofollow) continue;

      const candidate = {
        rootDomain,
        dr,
        refPageUrl,
        pageTitle,
        targetUrl,
        anchor,
        isNofollow,
        sourceCsv: file
      };
      candidate.opportunityScore = computeOpportunityScore(candidate);

      const existing = domainMap.get(rootDomain);
      if (!existing || candidate.opportunityScore > existing.opportunityScore) {
        domainMap.set(rootDomain, candidate);
      }
    }
  }

  const ranked = Array.from(domainMap.values()).sort(
    (a, b) => b.opportunityScore - a.opportunityScore || b.dr - a.dr
  );

  const selected = ranked.slice(0, limit);
  const payload = {
    generatedAt: new Date().toISOString(),
    totalUncontactedDomainsInPool: ranked.length,
    queueCount: selected.length,
    queue: selected
  };

  fs.writeFileSync(QUEUE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function sendViaResend(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300 && parsed.id) {
              resolve(parsed);
            } else {
              reject(new Error(`Resend HTTP ${res.statusCode}: ${data}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runFollowUps({ send = false, limit = 10 }) {
  const { allDispatched } = loadContactedState();
  let followupLog = {};
  if (fs.existsSync(FOLLOWUP_LOG_FILE)) {
    try {
      followupLog = JSON.parse(fs.readFileSync(FOLLOWUP_LOG_FILE, 'utf8'));
    } catch (_) {
      followupLog = {};
    }
  }

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const due = [];
  const seenTargets = new Set();

  for (const item of allDispatched) {
    const ts = item.sentAt || item.dispatchedAt || item.timestamp;
    const sentAtMs = ts ? Date.parse(ts) : NaN;
    if (Number.isNaN(sentAtMs) || now - sentAtMs < sevenDaysMs) continue;

    const toEmail = Array.isArray(item.to) ? item.to[0] : item.to;
    if (!toEmail) continue;
    const cleanTo = String(toEmail).trim().toLowerCase();
    const dom = extractRootDomain(cleanTo);
    const key = dom === 'gmail.com' ? cleanTo : dom;
    if (
      DO_NOT_FOLLOW_UP_DOMAINS.has(dom) ||
      DO_NOT_FOLLOW_UP_DOMAINS.has(cleanTo) ||
      followupLog[key] ||
      followupLog[cleanTo] ||
      seenTargets.has(key)
    ) {
      continue;
    }
    seenTargets.add(key);

    due.push({
      rootDomain: key,
      to: toEmail,
      name: item.name || dom,
      subject: item.subject ? `Re: ${item.subject.replace(/^Re:\s*/i, '')}` : 'Re: Google Meet attendance resource',
      targetUrl: item.targetUrl || '',
      originalSentAt: ts
    });
  }

  const batch = due.slice(0, limit);
  console.log(`[Follow-Up Engine] Eligible >= 7 days: ${due.length} | Selected batch: ${batch.length}`);

  for (const target of batch) {
    const text = [
      `Hi there,`,
      ``,
      `Just floating this to the top of your inbox in case it got buried last week.`,
      ``,
      `If you ever update your Google Meet resource page${target.targetUrl ? ` (${target.targetUrl})` : ''}, our native Google Meet REST API v2 add-on Attendance Tracker (https://attendancetracker.dev) and step-by-step guide (https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html) are live and free for educators and teams to test.`,
      ``,
      `Happy to set up a free lifetime pass for your team anytime.`,
      ``,
      `Best,`,
      `Derek Gallardo`,
      `Founder, Attendance Tracker`,
      `https://attendancetracker.dev`
    ].join('\n');

    if (!send) {
      console.log(`  [DRY-RUN Follow-Up] To: ${target.to} | Subject: ${target.subject}`);
      continue;
    }

    const res = await sendViaResend({
      from: FROM_EMAIL,
      to: [target.to],
      reply_to: REPLY_TO,
      subject: target.subject,
      text
    });
    followupLog[target.rootDomain] = {
      to: target.to,
      subject: target.subject,
      resendId: res.id,
      sentAt: new Date().toISOString()
    };
    fs.writeFileSync(FOLLOWUP_LOG_FILE, JSON.stringify(followupLog, null, 2), 'utf8');
    console.log(`  [SENT Follow-Up] To: ${target.to} | Resend ID: ${res.id}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const doSend = args.includes('--send');
  const doIngest = args.includes('--ingest') || args.includes('--status') || doSend || args.length === 0;
  const doQueue = args.includes('--queue') || args.includes('--status') || doSend || args.length === 0;
  const doFollowUp = args.includes('--follow-up') || doSend;

  let limit = 30;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = Math.max(1, parseInt(args[limitIdx + 1], 10) || 30);
  }

  const { contactedDomains, contactedEmails, allDispatched } = loadContactedState();
  console.log(`================================================================`);
  console.log(`Attendance Tracker — Daily Backlink Outreach Routine`);
  console.log(`================================================================`);
  console.log(`Total Dispatched Emails Across Waves : ${allDispatched.length}`);
  console.log(`Unique Contacted Root Domains        : ${contactedDomains.size}`);
  console.log(`Unique Contacted Email Addresses     : ${contactedEmails.size}`);

  if (doIngest) {
    const newlyIngested = ingestDownloadsCsvs();
    console.log(`Newly Ingested Ahrefs CSVs           : ${newlyIngested.length}`);
    for (const f of newlyIngested) console.log(`  + ${f}`);
  }

  if (doQueue) {
    const queueData = buildDailyOutreachQueue(limit);
    console.log(`Remaining Uncontacted Domains in CSVs: ${queueData.totalUncontactedDomainsInPool}`);
    console.log(`Top ${queueData.queueCount} Queued Targets (saved to docs/daily-outreach-queue.json):`);
    for (let i = 0; i < Math.min(15, queueData.queue.length); i++) {
      const q = queueData.queue[i];
      console.log(
        `  #${String(i + 1).padStart(2, '0')} [Score: ${String(q.opportunityScore).padStart(4, ' ')} | DR ${String(q.dr).padStart(2, ' ')}] ${q.rootDomain} -> ${q.refPageUrl}`
      );
    }
  }

  if (doFollowUp) {
    await runFollowUps({ send: doSend, limit });
  }
}

main().catch((err) => {
  console.error('[Error]', err.message);
  process.exit(1);
});
