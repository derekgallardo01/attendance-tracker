# Marketplace store screenshots

Store-listing screenshots for the Google Workspace Marketplace, rendered from
`screenshots.html` (pure HTML/CSS, on-brand with the real app — no external
assets). Each frame is a two-column "benefit + product UI" layout.

## Files
Upload the four **1280×800** PNGs (Marketplace's recommended spec) in this order —
it front-loads the strongest value:

1. `01-live-roster.png` — *See who's really in the room* (real-time panel)
2. `02-sheets-export.png` — *One click → a clean Google Sheet* (export)
3. `03-late-no-shows.png` — *Catch every late arrival & no-show* (calendar match)
4. `04-class-attendance.png` — *Track a class across every session* (recurring %)

The `*@2x.png` files are 2560×1600 (retina) — use them on `attendancetracker.dev`
or anywhere higher resolution helps. Same aspect (16:10).

**Promo tile** (`promo-tile-440x280.png`, + `@2x`): the small card Google shows in
category/search results, rendered from `promo-tile.html`. 440×280 per spec.

## Re-rendering after edits
Edit `screenshots.html`, then render both sizes from the Playwright install in
`e2e/` (Chromium is already there):

```bash
cd e2e
node - <<'EOF'
import('@playwright/test').then(async ({ chromium }) => {
  const DIR = '../marketing/store-screenshots';
  const shots = [['shot1','01-live-roster'],['shot2','02-sheets-export'],['shot3','03-late-no-shows'],['shot4','04-class-attendance']];
  const b = await chromium.launch();
  for (const [scale, sfx] of [[1,''],[2,'@2x']]) {
    const p = await b.newPage({ viewport:{width:1280,height:800}, deviceScaleFactor:scale });
    await p.goto('file://' + require('path').resolve(DIR,'screenshots.html'));
    for (const [id,base] of shots) await p.locator('#'+id).screenshot({ path:`${DIR}/${base}${sfx}.png` });
    await p.close();
  }
  await b.close();
});
EOF
```

## Notes
- Copy in the frames mirrors `docs/marketplace-listing.md` — keep them in sync.
- The UI is a faithful mock (dark #0d1117 / green #4ade80 theme), not a live
  capture, so it stays clean and legible — the same approach as the landing-page
  panel mockup in `index.html`.
