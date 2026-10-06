const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve('e2e/node_modules/playwright'));

async function main() {
  const iconBase64 = fs.readFileSync(path.resolve('companion-extension/icons/icon-128.png')).toString('base64');
  const iconDataUrl = `data:image/png;base64,${iconBase64}`;

  const cwsDir = path.resolve('screenshots/cws');
  if (!fs.existsSync(cwsDir)) {
    fs.mkdirSync(cwsDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // --- 1. Small Promo Tile (440x280) ---
  console.log('Generating Small Promo Tile (440x280)...');
  await page.setViewportSize({ width: 440, height: 280 });

  const smallHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 440px;
    height: 280px;
    overflow: hidden;
    background: radial-gradient(circle at 85% 15%, rgba(46, 160, 67, 0.22) 0%, transparent 50%),
                radial-gradient(circle at 15% 85%, rgba(88, 166, 255, 0.18) 0%, transparent 50%),
                linear-gradient(145deg, #0d1117 0%, #161b22 100%);
    color: #f0f6fc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 20px;
    background: rgba(88, 166, 255, 0.12);
    border: 1px solid rgba(88, 166, 255, 0.35);
    color: #58a6ff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    box-shadow: 0 0 8px #4ade80;
  }
  .icon-wrapper {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 16px rgba(46, 160, 67, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
  }
  .icon-wrapper img {
    width: 50px;
    height: 50px;
    object-fit: contain;
  }
  h1 {
    font-size: 21px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #ffffff;
    margin-bottom: 4px;
    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
  }
  .sub {
    font-size: 12.5px;
    color: #8b949e;
    margin-bottom: 16px;
    font-weight: 500;
  }
  .features {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .pill {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #c9d1d9;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pill span { color: #4ade80; }
</style>
</head>
<body>
  <div class="badge">
    <div class="badge-dot"></div>
    Google Meet Add-on
  </div>
  <div class="icon-wrapper">
    <img src="${iconDataUrl}" alt="Logo">
  </div>
  <h1>Attendance Tracker</h1>
  <div class="sub">100% Reliable · Zero DOM Scraping</div>
  <div class="features">
    <div class="pill"><span>✓</span> 1-Click Sheets</div>
    <div class="pill"><span>✓</span> Classroom & Canvas</div>
    <div class="pill"><span>✓</span> 44 Languages</div>
  </div>
</body>
</html>`;

  await page.setContent(smallHtml, { waitUntil: 'load' });
  const smallTilePath = path.join(cwsDir, 'small-promo-tile-440x280.jpg');
  await page.screenshot({ path: smallTilePath, type: 'jpeg', quality: 96 });
  console.log(`Saved: ${smallTilePath}`);

  // --- 2. Marquee Promo Tile (1400x560) ---
  console.log('Generating Marquee Promo Tile (1400x560)...');
  await page.setViewportSize({ width: 1400, height: 560 });

  const marqueeHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1400px;
    height: 560px;
    overflow: hidden;
    background: radial-gradient(circle at 75% 20%, rgba(46, 160, 67, 0.28) 0%, transparent 45%),
                radial-gradient(circle at 10% 80%, rgba(88, 166, 255, 0.22) 0%, transparent 45%),
                linear-gradient(135deg, #090d13 0%, #111722 50%, #161f2e 100%);
    color: #f0f6fc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 60px 80px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .left {
    flex: 1;
    max-width: 680px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .brand-bar {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 6px 14px;
    border-radius: 24px;
    background: rgba(88, 166, 255, 0.1);
    border: 1px solid rgba(88, 166, 255, 0.3);
    margin-bottom: 20px;
  }
  .brand-bar img {
    width: 24px;
    height: 24px;
    object-fit: contain;
  }
  .brand-text {
    font-size: 13px;
    font-weight: 700;
    color: #58a6ff;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  h1 {
    font-size: 46px;
    font-weight: 900;
    line-height: 1.15;
    letter-spacing: -0.03em;
    color: #ffffff;
    margin-bottom: 16px;
    text-shadow: 0 4px 12px rgba(0,0,0,0.5);
  }
  h1 span {
    background: linear-gradient(90deg, #4ade80, #58a6ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  p.desc {
    font-size: 19px;
    line-height: 1.5;
    color: #8b949e;
    margin-bottom: 28px;
  }
  .feature-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 24px;
  }
  .feature-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 600;
    color: #c9d1d9;
  }
  .check-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(74, 222, 128, 0.15);
    border: 1px solid rgba(74, 222, 128, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #4ade80;
    font-size: 12px;
    font-weight: 800;
    flex-shrink: 0;
  }

  .right {
    width: 480px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .preview-card {
    width: 460px;
    background: rgba(22, 27, 34, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 18px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 30px rgba(74, 222, 128, 0.15);
    padding: 24px;
    backdrop-filter: blur(12px);
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .card-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 16px;
    font-weight: 700;
    color: #fff;
  }
  .live-badge {
    padding: 4px 10px;
    border-radius: 12px;
    background: rgba(74, 222, 128, 0.15);
    color: #4ade80;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4ade80;
    box-shadow: 0 0 8px #4ade80;
  }
  .stat-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 18px;
  }
  .stat-box {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 10px;
    text-align: center;
  }
  .stat-val {
    font-size: 20px;
    font-weight: 800;
    color: #fff;
    margin-bottom: 2px;
  }
  .stat-lbl {
    font-size: 11px;
    color: #8b949e;
    text-transform: uppercase;
    font-weight: 600;
  }
  .donut-row {
    display: flex;
    align-items: center;
    gap: 16px;
    background: rgba(74, 222, 128, 0.05);
    border: 1px solid rgba(74, 222, 128, 0.2);
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 16px;
  }
  .donut-val {
    font-size: 28px;
    font-weight: 900;
    color: #4ade80;
  }
  .donut-text {
    font-size: 13px;
    color: #c9d1d9;
    line-height: 1.4;
  }
  .btn-export {
    width: 100%;
    padding: 12px;
    border-radius: 10px;
    background: #238636;
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #fff;
    font-weight: 700;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(35, 134, 54, 0.4);
  }
</style>
</head>
<body>
  <div class="left">
    <div class="brand-bar">
      <img src="${iconDataUrl}" alt="Logo">
      <span class="brand-text">Official Google Meet Add-on</span>
    </div>
    <h1>The Native Attendance Tracker for <span>Google Meet</span></h1>
    <p class="desc">Automated participant roll call, exact join & leave timestamps, and direct 1-click gradebook writeback. Built natively on Google Meet APIs.</p>
    <div class="feature-grid">
      <div class="feature-item">
        <div class="check-icon">✓</div>
        1-Click Google Sheets Export
      </div>
      <div class="feature-item">
        <div class="check-icon">✓</div>
        Google Classroom & Canvas Sync
      </div>
      <div class="feature-item">
        <div class="check-icon">✓</div>
        Zero DOM Scraping (100% Immune)
      </div>
      <div class="feature-item">
        <div class="check-icon">✓</div>
        44 Localized Languages
      </div>
    </div>
  </div>

  <div class="right">
    <div class="preview-card">
      <div class="card-top">
        <div class="card-title">
          <span>Biology 101 Lecture</span>
        </div>
        <div class="live-badge">
          <div class="live-dot"></div>
          RECORDING
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-box">
          <div class="stat-val" style="color: #4ade80;">28</div>
          <div class="stat-lbl">Present</div>
        </div>
        <div class="stat-box">
          <div class="stat-val" style="color: #f59e0b;">2</div>
          <div class="stat-lbl">Late</div>
        </div>
        <div class="stat-box">
          <div class="stat-val" style="color: #f85149;">1</div>
          <div class="stat-lbl">Absent</div>
        </div>
      </div>
      <div class="donut-row">
        <div class="donut-val">93%</div>
        <div class="donut-text">
          <strong>Class Attendance Rate</strong><br>
          31 total enrolled · 52m duration
        </div>
      </div>
      <div class="btn-export">
        📊 Export to Google Sheets & LMS
      </div>
    </div>
  </div>
</body>
</html>`;

  await page.setContent(marqueeHtml, { waitUntil: 'load' });
  const marqueeTilePath = path.join(cwsDir, 'marquee-promo-tile-1400x560.jpg');
  await page.screenshot({ path: marqueeTilePath, type: 'jpeg', quality: 96 });
  console.log(`Saved: ${marqueeTilePath}`);

  await browser.close();
  console.log('Finished generating promo tiles successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
