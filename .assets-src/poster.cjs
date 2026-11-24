// Covers the "Pool" line on the signboard in the video cover image (the lodge has no pool; owner, 2026-11-24).
// Copies the blank sign area just to the right of the line over it. Safe to re-run.
// Run: node .assets-src/poster.cjs
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "public", "video", "dot-anne-tour-poster.jpg");
// [fromLeft, fromTop, width, height, toLeft, toTop]
const covers = [[1214, 706, 22, 9, 1191, 706]];

(async () => {
  sharp.cache(false);
  const src = fs.readFileSync(file);
  const layers = [];
  for (const [fromLeft, fromTop, width, height, left, top] of covers) {
    layers.push({ input: await sharp(src).extract({ left: fromLeft, top: fromTop, width, height }).toBuffer(), left, top });
  }
  fs.writeFileSync(file, await sharp(src).composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer());
  console.log("poster updated");
})();
