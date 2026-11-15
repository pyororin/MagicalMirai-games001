// 顔のデザインデータ(app/data/design/miku-face.json)から、デザインシート(PNG)を作る。
//   node bunyutto-miku/tools/render-design-sheet.mjs [デザインJSON] [出力PNG]
// 既定: app/data/design/miku-face.json → design/miku-face-sheet.png
// 依存なし(zlib で PNG を書く)。デザインを変えたらこれを実行して、シートも更新してコミットする。
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MikuFace, setDesign, FACE_W, FACE_H, VOWEL_KEYS } from "../app/src/face.js";

const here = dirname(fileURLToPath(import.meta.url));
const designPath = resolve(process.argv[2] || join(here, "../app/data/design/miku-face.json"));
const outPath = resolve(process.argv[3] || join(here, "../design/miku-face-sheet.png"));
setDesign(JSON.parse(readFileSync(designPath, "utf8")));

const BG = [0x17, 0x20, 0x4a, 255];
const GAP = 10;
const FRAME = FACE_W / 2; // コマ送りは半分に縮小して並べる
const W = Math.max(5 * FACE_W + 6 * GAP, 9 * FRAME + 10 * GAP);
const H = GAP + FACE_H + GAP + 4 * (FRAME + GAP) + GAP;
const px = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) px.set(BG, i * 4);

const render = (w) => {
  const f = new MikuFace();
  f.render({ w: { a: 0, i: 0, u: 0, e: 0, o: 0, ...w }, beat: 0, t: 0 });
  return f.r.px; // ABGR(リトルエンディアンの RGBA)
};
const blit = (src, sw, sh, ox, oy, shrink) => {
  const dw = sw / shrink, dh = sh / shrink;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < shrink; j++) for (let i = 0; i < shrink; i++) {
      const p = src[(y * shrink + j) * sw + x * shrink + i];
      const pa = (p >>> 24) & 255;
      r += (p & 255) * pa; g += ((p >>> 8) & 255) * pa; b += ((p >>> 16) & 255) * pa; a += pa;
    }
    const n = shrink * shrink;
    const al = a / n / 255;
    if (a === 0) continue;
    const o = ((oy + y) * W + ox + x) * 4;
    px[o] = Math.round(r / a * al + px[o] * (1 - al));
    px[o + 1] = Math.round(g / a * al + px[o + 1] * (1 - al));
    px[o + 2] = Math.round(b / a * al + px[o + 2] * (1 - al));
    px[o + 3] = 255;
  }
};

// 1段目: 5つの表情
VOWEL_KEYS.forEach((v, i) => blit(render({ [v]: 1 }), FACE_W, FACE_H, GAP + i * (FACE_W + GAP), GAP, 1));
// 2〜5段目: あ → い/う/え/お のコマ送り(0〜100% を 12.5% 刻み)
["i", "u", "e", "o"].forEach((v, row) => {
  for (let k = 0; k <= 8; k++) {
    const w = { a: 1 - k / 8, i: 0, u: 0, e: 0, o: 0 };
    w[v] += k / 8;
    blit(render(w), FACE_W, FACE_H, GAP + k * (FRAME + GAP), GAP + FACE_H + GAP + row * (FRAME + GAP), 2);
  }
});

// PNG エンコード(RGBA 8bit, フィルタ無し)
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
writeFileSync(outPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
console.log("wrote", outPath, W + "x" + H);
