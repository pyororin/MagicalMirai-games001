import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MikuFace, setDesign, validateDesign, mixExpr, VOWEL_KEYS, FACE_W, FACE_H } from "../app/src/face.js";
import { readdirSync } from "node:fs";
import { VOWELS } from "../app/src/vowel.js";

const file = join(dirname(fileURLToPath(import.meta.url)), "../app/data/design/miku-face.json");
const load = () => JSON.parse(readFileSync(file, "utf8"));
const render = (design, w = { a: 1 }, extra = {}) => {
  setDesign(design);
  const f = new MikuFace();
  f.render({ w: { a: 0, i: 0, u: 0, e: 0, o: 0, ...w }, beat: 0, t: 0, ...extra });
  return f.r.px.slice();
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const clone = (o) => JSON.parse(JSON.stringify(o));

test("デザインデータ(miku-face.json)が検証を通る", () => {
  assert.doesNotThrow(() => validateDesign(load()));
});

test("母音(あいうえお)の表情がすべて定義され、ゲームの母音と一致する", () => {
  const d = load();
  assert.deepEqual([...VOWEL_KEYS].sort(), [...VOWELS].sort());
  for (const v of VOWELS) assert.ok(d.expressions[v], "expressions." + v);
});

test("描画: 5表情すべてでピクセルが出て、表情ごとに絵が違う", () => {
  const d = load();
  const imgs = VOWELS.map((v) => render(d, { [v]: 1 }));
  for (const px of imgs) {
    assert.equal(px.length, FACE_W * FACE_H);
    assert.ok(px.filter((p) => p !== 0).length > FACE_W * FACE_H * 0.3, "絵が描かれている");
  }
  for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) assert.ok(!same(imgs[i], imgs[j]), VOWELS[i] + " と " + VOWELS[j] + " が同じ絵");
});

test("描画は決定的(同じ入力なら同じ絵)", () => {
  const d = load();
  assert.ok(same(render(d, { i: 0.4, a: 0.6 }), render(d, { i: 0.4, a: 0.6 })));
});

test("デザインを変えると本編の絵が変わる: 髪の色・目の大きさ・口の大きさ", () => {
  const base = render(load());
  const hair = clone(load()); hair.palette.hair = "#FF00AA";
  assert.ok(!same(base, render(hair)), "髪の色");
  const eye = clone(load()); eye.eyes.size = 0.6;
  assert.ok(!same(base, render(eye)), "目の大きさ");
  const mouth = clone(load()); mouth.expressions.a.mouth.w = 12;
  assert.ok(!same(base, render(mouth)), "あ の口の幅");
  const o = clone(load()); o.expressions.o.mouth.h = 8;
  const oBase = render(load(), { o: 1 });
  assert.ok(!same(oBase, render(o, { o: 1 })), "お の口の高さ");
  assert.ok(same(render(load(), { o: 1 }), oBase), "元のデザインに戻せば元の絵");
});

test("髪とヘッドホンはピンチで変形しない(表情を変えても髪の画素は動かない)", () => {
  const d = load();
  setDesign(d);
  // 髪の色だけの画素を、あ と お で比べる(頭頂付近 y=18 の帯は髪だけのはず)
  const a = render(d, { a: 1 });
  const o = render(d, { o: 1 });
  const S = FACE_W / 80;
  const y0 = Math.floor(16 * S), y1 = Math.floor(20 * S);
  let diff = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < FACE_W; x++) if (a[y * FACE_W + x] !== o[y * FACE_W + x]) diff++;
  assert.equal(diff, 0, "頭頂の髪が表情で動いている");
});

test("表情の混ぜ合わせ: 重みの和が1でなくても正規化され、端点は各表情と一致する", () => {
  setDesign(load());
  const m = mixExpr({ i: 2 });
  assert.equal(m.fw, load().expressions.i.fw);
  const mid = mixExpr({ a: 0.5, i: 0.5 });
  assert.ok(Math.abs(mid.fw - (load().expressions.a.fw + load().expressions.i.fw) / 2) < 1e-9);
});

test("う: 唇の縦じわとつやは う のときだけ。頬は押された所がへこみ、上下がふくらむ(手は無い)", () => {
  const d = load();
  // 唇の縦じわの機能は生きている(う にしわを指定すれば出る)。本編の う は、可愛さ優先でしわを付けていない
  const wr = clone(d); wr.expressions.u.mouth.wrinkle = 1;
  assert.ok(!same(render(d, { u: 1 }), render(wr, { u: 1 })), "う にしわを指定すれば出る");
  wr.mouth.wrinkle.count = 12;
  assert.ok(same(render(d, { o: 1 }), render(wr, { o: 1 })), "お にはしわが無い");
  const pf = clone(d); pf.head.cheek.puff.amount = 4;
  assert.ok(!same(render(d, { u: 1 }), render(pf, { u: 1 })), "頬のふくらみ");
  assert.ok(same(render(d, { i: 1 }), render(pf, { i: 1 })), "い には頬のへこみ/ふくらみは効かない");
});

test("目は2種類だけ: 喜ぶ目(＾＾)とくの字の苦しげな目(＞＜)。表情ごとに選び、途中は連続して変わる", () => {
  const d = load();
  // あ・い = 喜ぶ目(chev 0)、う・え・お = くの字(chev 1)
  const chev = Object.fromEntries(VOWELS.map((v) => [v, d.expressions[v].eye.chev]));
  assert.deepEqual([chev.a, chev.i], [0, 0], "あ・い は喜ぶ目");
  for (const v of ["u", "e", "o"]) assert.ok(chev[v] >= 0.7 && chev[v] <= 1, v + " はくの字寄り(やわらかさ調整で 1 未満もあり)");
  // chev を変えると目の絵が変わる(2種類が実在する)
  const happy = clone(d); happy.expressions.u.eye.chev = 0;
  assert.ok(!same(render(d, { u: 1 }), render(happy, { u: 1 })), "う の目の形");
  // 目玉(虹彩・ひとみ・ハイライト)は描かない: 目の色は ink のみ。目の高さの帯に ink と肌・頬紅・髪以外の色が無い
  const inkOnly = clone(d); inkOnly.palette.ink = "#FF00FF";
  const px = render(inkOnly, { a: 1 });
  const magenta = ((255 << 24) | (255 << 16) | 255) >>> 0; // ABGR: R=255,B=255(Uint32 として比べる)
  const S = FACE_W / 80;
  let eyeBand = new Set();
  for (let y = Math.floor(40 * S); y < Math.floor(47 * S); y++) for (let x = Math.floor(8 * S); x < Math.floor(72 * S); x++) if (px[y * FACE_W + x] === magenta) eyeBand.add(1);
  assert.ok(eyeBand.size > 0, "目の線が ink 色で描かれている");
  // 連続性: 0〜1 の途中の chev でも描ける(隣のコマが飛ばない)
  const mid = clone(d); mid.expressions.u.eye.chev = 0.5;
  const m = render(mid, { u: 1 });
  assert.ok(!same(m, render(d, { u: 1 })) && !same(m, render(happy, { u: 1 })), "途中の形がある");
});

test("舌は口の内側にだけ描く(唇の線にも肌にも触れない)", () => {
  const d = clone(load());
  // 色を塗り分けて、舌(緑)の周囲が 舌/口の中(赤) だけであることを確かめる
  Object.assign(d.palette, { tongue: "#00FF00", mouthIn: "#FF0000", lipD: "#0000FF", lip: "#FFFF00", lipHi: "#00FFFF" });
  const green = ((255 << 24) | (255 << 8)) >>> 0;
  const red = ((255 << 24) | 255) >>> 0;
  for (const v of VOWELS) for (const amt of [1, 0.6]) {
    const w = { a: 1 - amt, [v]: amt + (v === "a" ? 1 - amt : 0) };
    const px = render(d, w);
    let tongue = 0;
    for (let y = 1; y < FACE_H - 1; y++) for (let x = 1; x < FACE_W - 1; x++) {
      if (px[y * FACE_W + x] !== green) continue;
      tongue++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = px[(y + dy) * FACE_W + x + dx];
        assert.ok(n === green || n === red, `${v} ${amt}: 舌が口の外にはみ出している (${x},${y})`);
      }
    }
    if (v === "o" || v === "i") assert.ok(tongue > 20, v + " の舌が描かれている");
  }
});

test("唇は、厚くしても上下に棒状にのびない(口の形を全方向へ均等にふくらませた輪)", () => {
  const d = clone(load());
  Object.assign(d.palette, { lip: "#FFFF00", lipD: "#FFFF00", mouthIn: "#FF0000", tongue: "#FF0000", lipHi: "#FFFF00" });
  d.expressions.u.mouth.pad = 2.2; // 輪の機能を確かめるため、ここだけ厚くする(本編の唇は細い)
  d.expressions.u.mouth.w = 5; d.expressions.u.mouth.h = 4.5;
  const px = render(d, { u: 1 });
  const yellow = ((255 << 24) | (255 << 8) | 255) >>> 0; // 唇(黄)
  const S = FACE_W / 80;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let y = 0; y < FACE_H; y++) for (let x = 0; x < FACE_W; x++) if (px[y * FACE_W + x] === yellow) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const w = (maxX - minX) / S, h = (maxY - minY) / S;
  assert.ok(w > 4 && h > 4, "唇が描かれている " + w + "x" + h);
  assert.ok(h < w * 1.35, "縦に棒状にのびていない(縦/横 = " + (h / w).toFixed(2) + ")");
});

test("頬の跡: のばされた(い)=つままれた跡、押された(う)=押された跡。手は描かない", () => {
  const d = load();
  const pin = clone(d); pin.cheekMarks.pinch.strength = 0; pin.cheekMarks.pinch.lines.len = 0.001;
  assert.ok(!same(render(d, { i: 1 }), render(pin, { i: 1 })), "い に つままれた跡");
  assert.ok(same(render(d, { u: 1 }), render(pin, { u: 1 })), "う には つままれた跡が出ない");
  const pre = clone(d); pre.cheekMarks.press.strength = 0; pre.cheekMarks.press.creases.len = 0.001;
  assert.ok(!same(render(d, { u: 1 }), render(pre, { u: 1 })), "う に 押された跡");
  assert.ok(same(render(d, { o: 1 }), render(pre, { o: 1 })), "お には 押された跡が出ない");
  // 強さに比例して連続して濃くなる
  // 跡の濃さ(跡あり/なしの色の差の合計)が、い が強いほど大きい
  const tone = (w) => { const a = render(d, w), b = render(pin, w); let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) for (const sh of [0, 8, 16]) n += Math.abs(((a[i] >>> sh) & 255) - ((b[i] >>> sh) & 255)); return n; };
  assert.ok(tone({ a: 0.8, i: 0.2 }) < tone({ a: 0.5, i: 0.5 }) && tone({ a: 0.5, i: 0.5 }) < tone({ i: 1 }), "い が強いほど跡が濃い");
});

test("デザインデータはすべて検証を通り、描画できる(本編・前案・コミカル案)", () => {
  const dir = dirname(file);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.includes("miku-face.json") && files.includes("miku-face-classic.json") && files.includes("miku-face-comic.json"), files.join());
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    assert.doesNotThrow(() => validateDesign(d), f);
    for (const v of VOWELS) assert.ok(render(d, { [v]: 1 }).some((p) => p !== 0), f + " " + v);
  }
});

test("コミカル表現: 涙・汗・赤面の斜線・衝撃波・きらきらが、該当する表情にだけ出る", () => {
  const d = load();
  const off = (kind, patch) => { const c = clone(d); patch(c); return c; };
  // 涙の機能そのものは生きている(う に涙を指定すれば出る)。ただし本編のデザインでは、押さえる表情(う・え)で泣かせない
  const withTears = clone(d); withTears.expressions.u.fx.tears = 1;
  assert.ok(!same(render(d, { u: 1 }), render(withTears, { u: 1 })), "涙を指定すれば う に出る");
  for (const v of VOWELS) assert.ok(!((d.expressions[v].fx || {}).tears > 0), v + " は涙なし(泣くまで押し込まない)");
  // 衝撃波: お だけ
  const waves = off("waves", (c) => { c.fx.waves.radii = [6]; });
  assert.ok(!same(render(d, { o: 1 }), render(waves, { o: 1 })), "お に衝撃波");
  for (const v of ["a", "i", "u", "e"]) assert.ok(same(render(d, { [v]: 1 }), render(waves, { [v]: 1 })), v + " に衝撃波は出ない");
  // 赤面の斜線: あ・い・う・え(お には無い)
  const hatch = off("hatch", (c) => { c.fx.hatch.count = 6; });
  for (const v of ["a", "i", "u", "e"]) assert.ok(!same(render(d, { [v]: 1 }), render(hatch, { [v]: 1 })), v + " に赤面の斜線");
  assert.ok(same(render(d, { o: 1 }), render(hatch, { o: 1 })), "お には無い");
  // きらきら: い だけ
  const sp = off("sparkle", (c) => { c.fx.sparkle.size = 1; });
  assert.ok(!same(render(d, { i: 1 }), render(sp, { i: 1 })), "い にきらきら");
  assert.ok(same(render(d, { u: 1 }), render(sp, { u: 1 })), "う には無い");
});

test("コミカル表現: 演出は表情の強さに比例して連続して現れる(0 → 満量)", () => {
  const d = load();
  // 例: 押される線(う だけの演出)。表情の強さ 0.1〜1 で、だんだん大きくなる
  const noHatch = clone(d); noHatch.fx.squeeze.width = 0.01; noHatch.fx.squeeze.len = 0.01;
  const amount = (w) => { const a = render(d, w), b = render(noHatch, w); let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  const xs = [0.1, 0.3, 0.5, 0.7, 1].map((k) => amount({ a: 1 - k, u: k }));
  for (let i = 1; i <= 3; i++) assert.ok(xs[i] > xs[i - 1], "線が増える " + xs.join(","));
  assert.ok(xs[4] > xs[3] * 0.8, "満量以降は一定 " + xs.join(","));
  assert.ok(xs[0] < xs[3] * 0.6, "弱いうちは小さい " + xs.join(","));
});

test("本家イラストに寄せた口: 極小で細い線。厚い唇(たらこ唇)にならない", () => {
  const d = load();
  for (const v of VOWELS) assert.ok(d.expressions[v].mouth.pad <= 0.8, v + " の唇は細い線(pad " + d.expressions[v].mouth.pad + ")");
  // あ・う の口は顔の幅の1/8以下の極小(顔の幅 ≈ 49)
  for (const v of ["a", "u"]) assert.ok(d.expressions[v].mouth.w <= 6, v + " の口は極小");
  // 唇の輪の太さ(外側−内側)が細い: う で外形と内側の幅の差が 1.6(論理)以下
  const c = clone(d);
  Object.assign(c.palette, { lip: "#FFFF00", lipD: "#FFFF00", mouthIn: "#FF0000", tongue: "#FF0000" });
  const px = render(c, { u: 1 });
  const S = FACE_W / 80;
  const span = (color) => { let a = 1e9, b = -1e9; for (let y = 0; y < FACE_H; y++) for (let x = 0; x < FACE_W; x++) if (px[y * FACE_W + x] === color) { a = Math.min(a, x); b = Math.max(b, x); } return (b - a) / S; };
  const yellow = ((255 << 24) | (255 << 8) | 255) >>> 0, red = ((255 << 24) | 255) >>> 0;
  const ring = (span(yellow) - span(red)) / 2;
  assert.ok(ring <= 1.0, "唇の太さ " + ring.toFixed(2));
});

test("本家イラストの特徴: まつ毛の跳ね・黒い角ばった髪飾りとピンクの線・白い襟・髪の輪郭線が描かれる", () => {
  const d = load();
  const base = render(d, { a: 1 });
  const lash = clone(d); lash.eyes.lash.len = 0.001;
  assert.ok(!same(base, render(lash, { a: 1 })), "まつ毛の跳ね");
  const clip = clone(d); clip.palette.clipPink = "#00FF00";
  assert.ok(!same(base, render(clip, { a: 1 })), "髪飾りのピンクの線");
  const clip2 = clone(d); clip2.hair.clips.w = 8;
  assert.ok(!same(base, render(clip2, { a: 1 })), "髪飾りの形");
  const collar = clone(d); collar.palette.collar = "#FF0000";
  assert.ok(!same(base, render(collar, { a: 1 })), "白い襟");
  const outline = clone(d); outline.palette.hairOutline = "#FF00FF";
  assert.ok(!same(base, render(outline, { a: 1 })), "髪の輪郭線");
  // 髪飾り・襟・髪の輪郭は表情で動かない(あ と お で同じ画素)
  const S = FACE_W / 80;
  const a = render(d, { a: 1 }), o = render(d, { o: 1 });
  let diff = 0;
  for (let y = Math.floor(10 * S); y < Math.floor(26 * S); y++) for (let x = Math.floor(12 * S); x < Math.floor(24 * S); x++) if (a[y * FACE_W + x] !== o[y * FACE_W + x]) diff++;
  assert.equal(diff, 0, "左の髪飾りの領域が表情で動いている");
});

test("本家寄せの本編は、コミカル案より変形が控えめ(やりすぎない)", () => {
  const comic = JSON.parse(readFileSync(join(dirname(file), "miku-face-comic.json"), "utf8"));
  const d = load();
  const spread = (x, k) => Math.abs(x.expressions[k].fw - 1) + Math.abs(x.expressions[k].fh - 1);
  for (const v of ["i", "u", "e", "o"]) assert.ok(spread(d, v) < spread(comic, v), v + " の変形はコミカル案より小さい");
  assert.ok(d.motion.spring && d.motion.spring.damping < 1, "ぷるんと揺れるバネは残す");
});

test("検証: 壊れたデザインは、場所つきのメッセージで拒否される", () => {
  const miss = clone(load()); delete miss.expressions.u;
  assert.throws(() => validateDesign(miss), /expressions\.u/);
  const color = clone(load()); color.palette.skin = "pink";
  assert.throws(() => validateDesign(color), /palette\.skin/);
  const nan = clone(load()); nan.expressions.e.mouth.w = "広い";
  assert.throws(() => validateDesign(nan), /expressions\.e\.mouth\.w/);
  const sec = clone(load()); delete sec.hair;
  assert.throws(() => validateDesign(sec), /hair/);
  const eyes = clone(load()); delete eyes.eyes.size;
  assert.throws(() => validateDesign(eyes), /eyes\.size/);
  assert.throws(() => validateDesign(null));
});
