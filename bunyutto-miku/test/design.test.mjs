import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MikuFace, setDesign, validateDesign, mixExpr, VOWEL_KEYS, FACE_W, FACE_H } from "../app/src/face.js";
import { VOWELS } from "../app/src/vowel.js";

const file = join(dirname(fileURLToPath(import.meta.url)), "../app/data/design/miku-face.json");
const load = () => JSON.parse(readFileSync(file, "utf8"));
const render = (design, w = { a: 1 }, extra = {}) => {
  setDesign(design);
  const f = new MikuFace();
  f.render({ w: { a: 0, i: 0, u: 0, e: 0, o: 0, ...w }, blink: 0, beat: 0, t: 0, ...extra });
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
