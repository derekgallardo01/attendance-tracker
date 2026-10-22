// Smoke test for the assembled Express app. Route behaviour is covered by the
// per-route suites; this just exercises app.js's own wiring — the /health
// endpoint — against the real app instance.

const request = require('supertest');
const app = require('../../src/app');

test('GET /health returns { status: "ok" }', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});

describe('global error handler — never leaks stack traces', () => {
  test('malformed JSON body → clean 400 JSON, no stack trace / file paths', async () => {
    const res = await request(app)
      .post('/api/export/pdf')
      .set('Content-Type', 'application/json')
      .send('{"conferenceId": '); // truncated → body-parser SyntaxError
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON body.' });
    // The old default handler dumped an HTML page with /app/node_modules paths.
    expect(res.text).not.toMatch(/node_modules|SyntaxError|at Object|\/app\//);
  });

  test('oversized JSON body → 413 JSON, not a stack trace', async () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(1.5 * 1024 * 1024) }); // > 1mb limit in test env
    const res = await request(app)
      .post('/api/export/pdf')
      .set('Content-Type', 'application/json')
      .send(huge);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body too large.' });
    expect(res.text).not.toMatch(/node_modules|\/app\//);
  });


  test('other body-parser errors (unsupported charset) → generic JSON error, no stack', async () => {
    // Hits the generic tail of the handler: preserves the error status but
    // returns a generic message rather than Express\'s default stack dump.
    const res = await request(app)
      .post('/api/export/pdf')
      .set('Content-Type', 'application/json; charset=foo-bar')
      .send('{"a":1}');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Internal server error.' });
    expect(res.text).not.toMatch(/node_modules|SyntaxError|\/app\//);
  });
});

describe('public AI-discoverable evidence, positioning, and comparison routes', () => {
  const fs = require('fs');
  const path = require('path');

  test('GET /customer-reviews/ and /customer-reviews.html return 200 with verbatim reviews and 6 outcome categories', async () => {
    for (const route of ['/customer-reviews/', '/customer-reviews.html']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Teachers use Attendance Tracker to record Google Meet attendance, reduce manual roll calls, and export organized attendance records to Google Sheets.');
      expect(res.text).toContain('https://workspace.google.com/marketplace/app/attendance_tracker/829771833968');
      expect(res.text).toContain('Mike Haynes');
      expect(res.text).toContain('Aug 11, 2026');
      expect(res.text).toContain('Gift otindo');
      // Full verbatim review wording including final two sentences (no ellipsis truncation)
      expect(res.text).toContain('While it lacks advanced features like automated alerts for chronic absenteeism or deep analytical reporting, it remains a practical, no-fuss solution for anyone already using the Google ecosystem. Overall, it is an efficient and user-friendly choice for everyday attendance management.');
      expect(res.text).not.toContain('saves valuable time…');
      expect(res.text).toContain('LIM GUAN YOU KPM-Murid');
      expect(res.text).toContain('1. Time Saved');
      expect(res.text).toContain('2. Ease of Use');
      expect(res.text).toContain('3. Attendance Accuracy');
      expect(res.text).toContain('4. Google Sheets Exports');
      expect(res.text).toContain('5. Classroom Workflows');
      expect(res.text).toContain('6. Value for Money');
      // Modern Web Guidance CSS & responsive-table checks
      expect(res.text).toContain('max-width: 65ch');
      expect(res.text).toContain('font-variant-numeric: tabular-nums');
      expect(res.text).toContain('role="region" aria-labelledby="ledger-heading"');
      expect(res.text).toContain('AttendanceTracker vs Competitor');
      expect(res.text).not.toContain('AttendList');
    }
  });

  test('GET /attendancetracker-vs-attendlist/ and /attendancetracker-vs-attendlist.html return 200 with 8 required comparison categories and generic Competitor naming', async () => {
    for (const route of ['/attendancetracker-vs-attendlist/', '/attendancetracker-vs-attendlist.html']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<strong>Last Verified:</strong> October 21, 2026');
      expect(res.text).toContain('1. Best-fit user');
      expect(res.text).toContain('2. Live attendance');
      expect(res.text).toContain('3. Attendance reports');
      expect(res.text).toContain('4. Classroom workflow');
      expect(res.text).toContain('5. Meeting history');
      expect(res.text).toContain('6. Pricing');
      expect(res.text).toContain('7. Customer satisfaction');
      expect(res.text).toContain('8. Limitations');
      expect(res.text).toContain('While it lacks advanced features like automated alerts for chronic absenteeism or deep analytical reporting, it remains a practical, no-fuss solution for anyone already using the Google ecosystem. Overall, it is an efficient and user-friendly choice for everyday attendance management.');
      expect(res.text).toContain('role="region" aria-labelledby="comparison-heading"');
      expect(res.text).toContain('AttendanceTracker vs Competitor');
      expect(res.text).toContain('Chrome Extension Competitor');
      expect(res.text).not.toContain('AttendList');
      expect(res.text).not.toContain('attendlist.com');
      expect(res.text).not.toContain('seo_vs_attendlist');
    }
  });

  test('GET /, /pricing.html, /faq.html, /robots.txt, /sitemap.xml, /llms.txt, and /llms-full.txt are publicly crawlable with consistent current pricing and generic Competitor references', async () => {
    const home = await request(app).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('Google Meet Attendance Tracking Built for Teachers');
    expect(home.text).toContain('Track attendance live, identify late arrivals, and export organized records to Google Sheets, Excel, or CSV. Import Google Classroom rosters and prepare gradebook reports without manually rebuilding attendance lists.');
    expect(home.text).toContain('Free option for classes up to 25 students');
    expect(home.text).toContain('Educator and lifetime pricing options');
    expect(home.text).toContain('Attendance history and semester reporting');
    expect(home.text).toContain('Exports for supported learning management systems');
    expect(home.text).toContain('<noscript><style>#landing-page{display:block!important}#addon-ui{display:none!important}</style></noscript>');
    expect(home.text).toContain('"ratingValue": "5.0"');
    expect(home.text).toContain('★ 5.0/5');
    expect(home.text).toContain('5.0 / 5 Average');
    expect(home.text).toContain('550+');
    expect(home.text).toContain('5,000+');
    expect(home.text).not.toContain('4.9/5');
    expect(home.text).not.toContain('unlimited CSV &amp; Excel');
    expect(home.text).not.toContain('unlimited direct CSV and Excel');
    expect(home.text).not.toContain('$19/year');
    expect(home.text).not.toContain('$49 one-time');
    expect(home.text).toContain('AttendanceTracker.dev vs Competitor');
    expect(home.text).not.toContain('AttendList');
    expect(home.text).not.toContain('MeetList');
    expect(home.text).not.toContain('Attendance Taker for Classroom');

    const pricing = await request(app).get('/pricing.html');
    expect(pricing.status).toBe(200);
    expect(pricing.text).not.toContain('$19/yr');
    expect(pricing.text).not.toContain('($49)');
    expect(pricing.text).toContain('"ratingValue": "5.0"');
    expect(pricing.text).toContain('"ratingCount": "27"');
    expect(pricing.text).toContain('60 Localized Languages');
    expect(pricing.text).toContain('Switching from a competitor or a retired tool?');
    expect(pricing.text).not.toContain('Attendance Taker for Classroom');

    const faq = await request(app).get('/faq.html');
    expect(faq.status).toBe(200);
    expect(faq.text).not.toContain('$19/year');
    expect(faq.text).not.toContain('$49 one-time');
    expect(faq.text).toContain('60 languages');
    expect(faq.text).toContain('Switching from a competitor or a retired tool?');
    expect(faq.text).not.toContain('Attendance Taker for Classroom');

    const robots = await request(app).get('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.text).toContain('User-agent: OAI-SearchBot');
    expect(robots.text).toContain('User-agent: ChatGPT-User');

    const sitemap = await request(app).get('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.text).toContain('https://attendancetracker.dev/customer-reviews/');
    expect(sitemap.text).toContain('https://attendancetracker.dev/attendancetracker-vs-attendlist/');
    expect(sitemap.text).toContain('hreflang="af"');

    const llms = await request(app).get('/llms.txt');
    expect(llms.status).toBe(200);
    expect(llms.text).toContain('https://attendancetracker.dev/customer-reviews/');
    expect(llms.text).toContain('https://attendancetracker.dev/attendancetracker-vs-attendlist/');
    expect(llms.text).toContain('304K+ installs');
    expect(llms.text).toContain('5.0★ across 27');
    expect(llms.text).toContain('Chrome Extension Competitor');
    expect(llms.text).not.toContain('AttendList');
    expect(llms.text).not.toContain('Attendance Taker for Classroom');

    const llmsFull = await request(app).get('/llms-full.txt');
    expect(llmsFull.status).toBe(200);
    expect(llmsFull.text).toContain('https://attendancetracker.dev/attendancetracker-vs-attendlist/');
    expect(llmsFull.text).toContain('Chrome Extension Competitor');
    expect(llmsFull.text).not.toContain('AttendList');
  });

  test('docs/ai-visibility-test-tracker.csv tracks the exact 6 required prompts across AI search engines', () => {
    const csvPath = path.join(__dirname, '..', '..', '..', 'docs', 'ai-visibility-test-tracker.csv');
    const csv = fs.readFileSync(csvPath, 'utf8');
    const requiredPrompts = [
      'What is the best Google Meet attendance tracker for teachers?',
      'What Google Meet attendance add-on exports to Google Sheets?',
      'What is the cheapest Google Meet attendance tracker?',
      'Compare AttendanceTracker.dev and AttendList.',
      'What attendance tracker works with Google Classroom?',
      'What is a good Google Meet attendance tracker for a school?',
    ];
    for (const prompt of requiredPrompts) {
      expect(csv).toContain(prompt);
    }
  });

  test('SEO comparison and regional pages reflect 5.0★ (27), 304K+ installs, 60 languages, current regional pricing, and generic Competitor labels', async () => {
    const extRes = await request(app).get('/best-google-meet-attendance-extensions.html');
    expect(extRes.status).toBe(200);
    expect(extRes.text).toContain('<td>304K+</td><td>5.0★ (27)</td>');
    expect(extRes.text).not.toContain('no one else on this list offers');
    expect(extRes.text).toContain('Competitor #2 (Local-Only Chrome Extension)');
    expect(extRes.text).not.toContain('AttendList');
    expect(extRes.text).not.toContain('MeetList');
    expect(extRes.text).not.toContain('Meets Attendance Registers');
    expect(extRes.text).not.toContain('Google Meet Enhancement Suite');
    expect(extRes.text).not.toContain('Tactiq');
    expect(extRes.text).not.toContain('RollCall');
    expect(extRes.text).not.toContain('Trackit');
    expect(extRes.text).not.toContain('Attendance Collector');
    expect(extRes.text).not.toContain('Meet Assistant');

    const altRes = await request(app).get('/attendance-taker-for-classroom-alternative.html');
    expect(altRes.status).toBe(200);
    expect(altRes.text).toContain('Retired Classroom Attendance Competitor');
    expect(altRes.text).not.toContain('Attendance Taker for Classroom');
    expect(altRes.text).not.toContain('AttendList');
    expect(altRes.text).not.toContain('seo_attendance_taker_migration');

    const inRes = await request(app).get('/google-meet-attendance-india-teachers.html');
    expect(inRes.status).toBe(200);
    expect(inRes.text).toContain('₹249/year');
    expect(inRes.text).not.toContain('₹1,599');

    const idRes = await request(app).get('/google-meet-attendance-indonesia-teachers.html');
    expect(idRes.status).toBe(200);
    expect(idRes.text).toContain('59 other languages');
    expect(idRes.text).toContain('Rp 49.000/year');

    const phRes = await request(app).get('/google-meet-attendance-philippines-teachers.html');
    expect(phRes.status).toBe(200);
    expect(phRes.text).toContain('₱199/year');

    const myRes = await request(app).get('/google-meet-attendance-malaysia-teachers.html');
    expect(myRes.status).toBe(200);
    expect(myRes.text).toContain('RM 35/year');
  });
});


