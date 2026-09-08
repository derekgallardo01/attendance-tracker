// Renders the proposed icon.svg to every size the app + Google consoles use.
// 120 = OAuth consent screen logo size. Maskable = full-bleed background with
// the motif inset for Android safe zones.
const path = require('path');
const fs = require('fs');
const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));

const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'));
const sizes = [32, 48, 96, 120, 128, 192, 512];

// Maskable variant: paint the gradient edge-to-edge, shrink the artwork.
const maskable = svg.toString()
  .replace('<rect x="8" y="8" width="112" height="112" rx="26" ry="26"', '<rect x="0" y="0" width="128" height="128" rx="0" ry="0"')
  .replace('viewBox="0 0 128 128" width="128" height="128">', 'viewBox="0 0 128 128" width="128" height="128"><g transform="translate(64 64) scale(0.999) translate(-64 -64)">')
  .replace('</svg>', '</g></svg>');

(async () => {
  for (const size of sizes) {
    await sharp(svg).resize(size, size).png().toFile(path.join(__dirname, `icon-${size}.png`));
    console.log(`icon-${size}.png`);
  }
  for (const size of [192, 512]) {
    await sharp(Buffer.from(maskable)).resize(size, size).png().toFile(path.join(__dirname, `icon-${size}-maskable.png`));
    console.log(`icon-${size}-maskable.png`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
