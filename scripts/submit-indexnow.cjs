const fs = require('fs');
const https = require('https');

const KEY = '86c91a38e8f94cdaaf4b7d65bb22632d';
const HOST = 'attendancetracker.dev';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

// Read all URLs from sitemap.xml
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);

console.log(`Found ${urls.length} URLs in sitemap.xml to submit via IndexNow...`);

const payload = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: KEY_LOCATION,
  urlList: urls
});

const req = https.request(
  {
    hostname: 'api.indexnow.org',
    port: 443,
    path: '/indexnow',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload)
    }
  },
  res => {
    let body = '';
    res.on('data', chunk => (body += chunk));
    res.on('end', () => {
      console.log(`IndexNow Response Status: ${res.statusCode} ${res.statusMessage}`);
      if (res.statusCode === 200 || res.statusCode === 202) {
        console.log('SUCCESS: All URLs successfully submitted to IndexNow (Bing, Yandex, Microsoft Copilot)!');
      } else {
        console.log(`Response Body: ${body}`);
      }
    });
  }
);

req.on('error', err => {
  console.error('Error submitting to IndexNow:', err.message);
});

req.write(payload);
req.end();
