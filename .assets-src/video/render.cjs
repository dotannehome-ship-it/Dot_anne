// Pass 2: cover the "Pool" line on the signboard in every frame of the two building shots,
// using the sign's own background from just to the right of the line in the same frame.
// Reads track.json (pass 1), fits a smooth motion curve per shot, renders from the original 1080p video,
// and encodes a 720p web copy (same settings as the current site video).
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const FF = "C:/Users/OPTISW~1/AppData/Local/Temp/claude/24e6df8f5ba1b89a/8b506361-cbac-407f-8e6e-e9fd12ddc178/scratchpad/cap/node_modules/ffmpeg-static/ffmpeg.exe";
const SRC = "C:/Users/Optisware001/Downloads/Dot Anne Home Lodge - Promo 16x9 new.mp4";
const OUT = process.argv[2] || path.join(__dirname, "dot-anne-tour.mp4");
const CHECK = path.join(__dirname, "check");
const W = 1920, H = 1080, FS = W * H * 3;

// Pool line in still-photo pixels (with a small margin for the soft edge), and how far right the clean background is.
const RECT = { x0: 1313, x1: 1344, y0: 761.5, y1: 776.5 };
const RAMP = 1; // soft edge width in still pixels
const SHIFT = 27.5;

const track = JSON.parse(fs.readFileSync(path.join(__dirname, "track.json"), "utf8"));

// Least-squares quadratic fit over well-matched frames.
function fitQuadratic(ns, vs) {
  let S = [0, 0, 0, 0, 0], T = [0, 0, 0];
  const c = ns.reduce((a, b) => a + b, 0) / ns.length;
  ns.forEach((n0, i) => {
    const n = n0 - c, v = vs[i];
    S[0]++; S[1] += n; S[2] += n * n; S[3] += n ** 3; S[4] += n ** 4;
    T[0] += v; T[1] += v * n; T[2] += v * n * n;
  });
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  const coef = [0, 1, 2].map((k) => det(M.map((row, r) => row.map((x, j) => (j === k ? T[r] : x)))) / D);
  return (n) => { const x = n - c; return coef[0] + coef[1] * x + coef[2] * x * x; };
}

// Opening shot: smooth zoom, fitted from frames 5-110 (after ~3.8 s the Pool line has left the frame).
const good = Object.entries(track).map(([n, v]) => [+n, v]).filter(([n, v]) => n >= 5 && n <= 110 && v.score > 0.6);
const fs_ = fitQuadratic(good.map((g) => g[0]), good.map((g) => g[1].s));
const ftx = fitQuadratic(good.map((g) => g[0]), good.map((g) => g[1].tx));
const fty = fitQuadratic(good.map((g) => g[0]), good.map((g) => g[1].ty));
let maxErr = 0;
for (const [n, v] of good) maxErr = Math.max(maxErr, Math.abs(fs_(n) * 1330 + ftx(n) - (v.s * 1330 + v.tx)), Math.abs(fs_(n) * 770 + fty(n) - (v.s * 770 + v.ty)));
console.log("opening shot fit from", good.length, "frames; max position error at the Pool line:", maxErr.toFixed(2), "px");

// Per-frame positions of the Pool line, lightly smoothed (7-frame moving average), instead of one curve.
const PX = 1328, PY = 769;
const meas = {};
for (const [n, v] of good) meas[n] = { s: v.s, px: v.s * PX + v.tx, py: v.s * PY + v.ty };
const ids = Object.keys(meas).map(Number).sort((a, b) => a - b);
const smooth = {};
for (const n of ids) {
  const win = ids.filter((m) => Math.abs(m - n) <= 3);
  const avg = (k) => win.reduce((a, m) => a + meas[m][k], 0) / win.length;
  smooth[n] = { s: avg("s"), px: avg("px"), py: avg("py") };
}
let jitter = 0;
for (const n of ids) jitter = Math.max(jitter, Math.abs(smooth[n].py - meas[n].py), Math.abs(smooth[n].px - meas[n].px));
console.log("opening shot: per-frame tracking, max smoothing correction", jitter.toFixed(2), "px");
function openingAt(n) {
  const first = ids[0], last = ids[ids.length - 1];
  let v;
  if (n <= first) v = smooth[first];
  else if (n >= last) v = smooth[last];
  else {
    let a = first; for (const m of ids) { if (m <= n) a = m; else break; }
    const b = ids.find((m) => m >= n);
    const f = b === a ? 0 : (n - a) / (b - a);
    v = { s: smooth[a].s + (smooth[b].s - smooth[a].s) * f, px: smooth[a].px + (smooth[b].px - smooth[a].px) * f, py: smooth[a].py + (smooth[b].py - smooth[a].py) * f };
  }
  return { s: v.s, tx: v.px - v.s * PX, ty: v.py - v.s * PY };
}

function transformFor(n) {
  if (n >= 0 && n <= 155) return openingAt(n);
  if (n >= 1255 && n <= 1430) return { s: 1.327, tx: -1.5, ty: -65.5 }; // closing shot is static (score 0.87)
  return null;
}

function cover(buf, t) {
  const { s, tx, ty } = t;
  const xa = Math.max(0, Math.floor(s * RECT.x0 + tx)), xb = Math.min(W - 1, Math.ceil(s * RECT.x1 + tx));
  const ya = Math.max(0, Math.floor(s * RECT.y0 + ty)), yb = Math.min(H - 1, Math.ceil(s * RECT.y1 + ty));
  if (xa > xb || ya > yb) return false;
  const d = SHIFT * s;
  const src = Buffer.from(buf); // read from the untouched frame
  for (let y = ya; y <= yb; y++) {
    const v = (y - ty) / s;
    const dy = Math.min(v - RECT.y0, RECT.y1 - v);
    for (let x = xa; x <= xb; x++) {
      const u = (x - tx) / s;
      const dx = Math.min(u - RECT.x0, RECT.x1 - u);
      const w = Math.max(0, Math.min(1, Math.min(dx, dy) / RAMP));
      if (w <= 0) continue;
      const xs = x + d, x0 = Math.floor(xs), a = xs - x0;
      if (x0 + 1 >= W) continue;
      for (let c = 0; c < 3; c++) {
        const p0 = src[(y * W + x0) * 3 + c], p1 = src[(y * W + x0 + 1) * 3 + c];
        const val = p0 * (1 - a) + p1 * a;
        const i = (y * W + x) * 3 + c;
        buf[i] = Math.round(buf[i] * (1 - w) + val * w);
      }
    }
  }
  return true;
}

fs.mkdirSync(CHECK, { recursive: true });
const CHECK_FRAMES = new Set([10, 30, 45, 60, 75, 90, 100, 1350]);

const dec = spawn(FF, ["-v", "error", "-i", SRC, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
const enc = spawn(FF, [
  "-v", "error", "-y",
  "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", "30", "-i", "-",
  "-i", SRC, "-map", "0:v", "-map", "1:a",
  "-vf", "scale=1280:-2", "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", OUT,
]);
enc.stderr.on("data", (d) => process.stderr.write(d));
dec.stderr.on("data", (d) => process.stderr.write(d));

let pending = Buffer.alloc(0), n = 0, covered = 0;
const writeFrame = (frame) => new Promise((res) => (enc.stdin.write(frame) ? res() : enc.stdin.once("drain", res)));

(async () => {
  for await (const chunk of dec.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= FS) {
      const frame = Buffer.from(pending.subarray(0, FS));
      pending = pending.subarray(FS);
      const t = transformFor(n);
      if (t && cover(frame, t)) covered++;
      if (CHECK_FRAMES.has(n) && t) {
        const sharp = require("D:/webDev/Dot_anne/node_modules/sharp");
        const cx = Math.round(t.s * 1300 + t.tx), cy = Math.round(t.s * 690 + t.ty);
        const left = Math.max(0, Math.min(W - 260, cx)), top = Math.max(0, Math.min(H - 200, cy));
        await sharp(frame, { raw: { width: W, height: H, channels: 3 } }).extract({ left, top, width: 260, height: 200 }).resize({ width: 520 }).png().toFile(path.join(CHECK, `f${n}.png`));
      }
      await writeFrame(frame);
      n++;
    }
  }
  enc.stdin.end();
  enc.on("close", (code) => console.log("frames", n, "covered", covered, "encoder exit", code, "->", OUT));
})();
