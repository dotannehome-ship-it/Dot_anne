// Pass 1: for every frame of the two building shots, find how the still photo is scaled and shifted
// (frame = s * still + t) by matching the right-hand signboard. Writes track.json.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const sharp = require("D:/webDev/Dot_anne/node_modules/sharp");

const FF = "C:/Users/OPTISW~1/AppData/Local/Temp/claude/24e6df8f5ba1b89a/8b506361-cbac-407f-8e6e-e9fd12ddc178/scratchpad/cap/node_modules/ffmpeg-static/ffmpeg.exe";
const SRC = "C:/Users/Optisware001/Downloads/Dot Anne Home Lodge - Promo 16x9 new.mp4";
const STILL = "D:/webDev/Dot_anne/.assets-src/owner-2026-11-07/exterior.png";
const OUT = path.join(__dirname, "track.json");
const W = 1920, H = 1080;
// anchor: a frame well inside the shot where the sign is fully visible; tracking runs both ways from it
const SEGMENTS = [
  { from: 0, to: 155, anchor: 75 },
  { from: 1265, to: 1425, anchor: 1350 },
];

function makeTemplate(still, sw, step) {
  // Upper part of the sign (header down to the Pool line), which stays on screen
  const pts = [];
  for (let Y = 620; Y <= 778; Y += step) for (let X = 1305; X <= 1440; X += step) pts.push([X, Y, still[Y * sw + X]]);
  return pts;
}

function ncc(f, pts, s, tx, ty) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const x = s * p[0] + tx, y = s * p[1] + ty;
    const x0 = x | 0, y0 = y | 0;
    if (x < 0 || y < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
    const ax = x - x0, ay = y - y0, i = y0 * W + x0;
    const v = (f[i] * (1 - ax) + f[i + 1] * ax) * (1 - ay) + (f[i + W] * (1 - ax) + f[i + W + 1] * ax) * ay;
    const t = p[2];
    n++; sa += v; sb += t; saa += v * v; sbb += t * t; sab += v * t;
  }
  if (n < pts.length * 0.6) return -1;
  const cov = sab - (sa * sb) / n, va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
}

const range = (a, b, st) => { const r = []; for (let v = a; v <= b + 1e-9; v += st) r.push(+v.toFixed(4)); return r; };

function search(f, pts, sList, txFn, tyFn) {
  let best = { score: -2 };
  for (const s of sList) for (const tx of txFn(s)) for (const ty of tyFn(s)) {
    const score = ncc(f, pts, s, tx, ty);
    if (score > best.score) best = { score, s, tx, ty };
  }
  return best;
}

function loadFrames(from, to) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FF, ["-v", "error", "-i", SRC, "-vf", `select=between(n\\,${from}\\,${to})`, "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    const chunks = [];
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", (d) => process.stderr.write(d));
    ff.on("close", () => {
      const all = Buffer.concat(chunks), size = W * H, out = {};
      for (let k = 0; k * size < all.length; k++) out[from + k] = all.subarray(k * size, (k + 1) * size);
      resolve(out);
    });
    ff.on("error", reject);
  });
}

(async () => {
  const { data: still, info } = await sharp(STILL).greyscale().raw().toBuffer({ resolveWithObject: true });
  const coarse = makeTemplate(still, info.width, 8);
  const fine = makeTemplate(still, info.width, 2);
  const mid = makeTemplate(still, info.width, 5);
  const result = {};
  for (const seg of SEGMENTS) {
    const frames = await loadFrames(seg.from, seg.to);
    console.log("segment", seg.from, "-", seg.to, "frames loaded:", Object.keys(frames).length);
    const a = frames[seg.anchor];
    let best = search(a, coarse, range(1.2, 2.2, 0.02), () => range(-900, 300, 8), () => range(-500, 300, 8));
    console.log("anchor coarse", JSON.stringify(best));
    best = search(a, fine, range(best.s - 0.02, best.s + 0.02, 0.002), () => range(best.tx - 10, best.tx + 10, 1), () => range(best.ty - 10, best.ty + 10, 1));
    console.log("anchor fine", JSON.stringify(best));
    result[seg.anchor] = best;
    for (const dir of [1, -1]) {
      let prev = best;
      for (let n = seg.anchor + dir; n >= seg.from && n <= seg.to && frames[n]; n += dir) {
        let b = search(frames[n], fine, range(prev.s - 0.004, prev.s + 0.004, 0.001), () => range(prev.tx - 5, prev.tx + 5, 0.5), () => range(prev.ty - 5, prev.ty + 5, 0.5));
        if (b.score < 0.6) {
          // Lost it: wider search with a lighter template, then refine
          let w = search(frames[n], mid, range(prev.s - 0.04, prev.s + 0.04, 0.004), () => range(prev.tx - 40, prev.tx + 40, 2), () => range(prev.ty - 30, prev.ty + 30, 2));
          w = search(frames[n], fine, range(w.s - 0.004, w.s + 0.004, 0.001), () => range(w.tx - 2, w.tx + 2, 0.5), () => range(w.ty - 2, w.ty + 2, 0.5));
          if (w.score > b.score) b = w;
        }
        result[n] = b;
        if (b.score > 0.6) prev = b;
        if (n % 5 === 0) console.log(n, (n / 30).toFixed(2) + "s", JSON.stringify(b));
      }
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log("wrote", Object.keys(result).length, "frames");
})();
