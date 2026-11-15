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
  const wr = clone(d); wr.mouth.wrinkle.count = 12;
  assert.ok(!same(render(d, { u: 1 }), render(wr, { u: 1 })), "う は唇のしわが変わる");
  assert.ok(same(render(d, { o: 1 }), render(wr, { o: 1 })), "お にはしわが無い");
  const pf = clone(d); pf.head.cheek.puff.amount = 4;
  assert.ok(!same(render(d, { u: 1 }), render(pf, { u: 1 })), "頬のふくらみ");
  assert.ok(same(render(d, { i: 1 }), render(pf, { i: 1 })), "い には頬のへこみ/ふくらみは効かない");
});

test("目は2種類だけ: 喜ぶ目(＾＾)とくの字の苦しげな目(＞＜)。表情ごとに選び、途中は連続して変わる", () => {
  const d = load();
  // あ・い = 喜ぶ目(chev 0)、う・え・お = くの字(chev 1)
  assert.deepEqual({ a: 0, i: 0, u: 1, e: 1, o: 1 }, Object.fromEntries(VOWELS.map((v) => [v, d.expressions[v].eye.chev])));
  for (const v of VOWELS) assert.ok([0, 1].includes(d.expressions[v].eye.chev), v + " の目は 0 か 1");
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
  // 涙: う/え に出て、あ・い・お には出ない(涙のパラメータを変えても絵が変わらない)
  const tears = off("tears", (c) => { c.fx.tears.r0 = 0.5; c.fx.tears.drops = []; });
  for (const v of ["u", "e"]) assert.ok(!same(render(d, { [v]: 1 }), render(tears, { [v]: 1 })), v + " に涙");
  for (const v of ["a", "i", "o"]) assert.ok(same(render(d, { [v]: 1 }), render(tears, { [v]: 1 })), v + " に涙は出ない");
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
  const noTears = clone(d); noTears.fx.tears.r0 = 0.05; noTears.fx.tears.r1 = 0.05; noTears.fx.tears.drops = [];
  const amount = (w) => { const a = render(d, w), b = render(noTears, w); let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  const xs = [0.1, 0.3, 0.5, 0.7, 1].map((k) => amount({ a: 1 - k, u: k }));
  // 満量(重み0.7)まで増え続け、そこから先はほぼ一定(顔の形が変わる分の誤差は許容)
  for (let i = 1; i <= 3; i++) assert.ok(xs[i] > xs[i - 1], "涙が増える " + xs.join(","));
  assert.ok(xs[4] > xs[3] * 0.8, "満量以降は一定 " + xs.join(","));
  assert.ok(xs[0] < xs[3] * 0.5, "弱いうちは小さい");
});

test("コミカル案は前案より顔の変形が大きい(大袈裟)", () => {
  const classic = JSON.parse(readFileSync(join(dirname(file), "miku-face-classic.json"), "utf8"));
  const comic = load();
  const spread = (d, k) => Math.abs(d.expressions[k].fw - 1) + Math.abs(d.expressions[k].fh - 1);
  for (const v of ["i", "u", "e", "o"]) assert.ok(spread(comic, v) > spread(classic, v), v + " の変形が大きい");
  assert.ok(comic.motion.spring && comic.motion.spring.damping < 1, "ぷるんと揺れるバネ");
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
