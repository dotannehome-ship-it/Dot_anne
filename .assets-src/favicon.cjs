// Builds the site icons Google and browsers use from src/app/icon.png (the lotus mark):
// - src/app/icon.png      192x192, lotus cropped tighter so it reads at tiny sizes (Google prefers multiples of 48)
// - src/app/favicon.ico   48, 32 and 16 px in one .ico (PNG-encoded entries)
// Run: node .assets-src/favicon.cjs
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const app = path.join(__dirname, "..", "src", "app");
const source = path.join(__dirname, "logo", "icon-source.png");

(async () => {
  sharp.cache(false);
  // Keep the original 512px lotus as the source so re-running never compounds the crop.
  if (!fs.existsSync(source)) fs.copyFileSync(path.join(app, "icon.png"), source);
  const base = await sharp(source)
    .extract({ left: 40, top: 40, width: 432, height: 432 })
    .flatten({ background: "#ffffff" })
    .toBuffer();

  await sharp(base).resize(192, 192).png().toFile(path.join(app, "icon.png"));

  // 48px first: Next.js reads the first entry for the <link sizes> it emits, and Google wants 48x48 or larger.
  const sizes = [48, 32, 16];
  const pngs = await Promise.all(sizes.map((n) => sharp(base).resize(n, n).png().toBuffer()));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((n, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(n, e); // width
    header.writeUInt8(n, e + 1); // height
    header.writeUInt8(0, e + 2); // palette
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(app, "favicon.ico"), Buffer.concat([header, ...pngs]));
  console.log("icon.png 192x192 and favicon.ico (48/32/16) written");
})();
