// Download the per-script Noto fonts used by generated PDFs into assets/fonts
// (run at Docker build time; see Dockerfile). Idempotent: existing files are
// kept. Fails the build if any font can't be fetched, so a deploy never ships
// with silently missing scripts.
const fs = require('fs');
const path = require('path');
const { FILES, FONT_DIR } = require('../src/lib/pdfFonts');

const NOTO = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts';
const CJK = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF';

function urlFor(file) {
  const m = /^NotoSans(SC|TC|JP|KR)-Regular\.otf$/.exec(file);
  if (m) return `${CJK}/${m[1]}/${file}`;
  const family = file.replace(/-Regular\.ttf$/, '');
  return `${NOTO}/${family}/hinted/ttf/${file}`;
}

(async () => {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  for (const file of Object.values(FILES)) {
    const dest = path.join(FONT_DIR, file);
    if (fs.existsSync(dest)) continue;
    const res = await fetch(urlFor(file));
    if (!res.ok) throw new Error(`font download failed: ${file} (${res.status})`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log('font', file);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
