import test from "node:test";
import assert from "node:assert/strict";
import { Judge, WIN, comboMult, rankOf } from "../app/src/judge.js";
import { PinchTracker, classify } from "../app/src/pinch.js";

const N = (t, row, vowel, dur = 0) => ({ t, row, vowel, dur, hold: dur > 0 });

test("PERFECT: 段・顔・タイミングがそろう", () => {
  const j = new Judge([N(1000, 2, "a")]);
  j.setVowel(0, "a");
  const r = j.attack(1020, 2);
  assert.equal(r.kind, "hit");
  assert.equal(j.counts.PERFECT, 1);
  assert.equal(j.combo, 1);
  assert.ok(j.score > 0);
});

test("タイミング窓: GREAT / GOOD / 窓外は自由演奏", () => {
  const j = new Judge([N(1000, 1, "a"), N(3000, 1, "a"), N(5000, 1, "a")]);
  j.attack(1100, 1); assert.equal(j.counts.GREAT, 1);
  j.attack(3190, 1); assert.equal(j.counts.GOOD, 1);
  assert.equal(j.attack(4500, 1).kind, "free", "窓の外(早すぎ)は自由演奏で、減点もない");
  assert.equal(j.counts.MISS, 0);
});

test("段が違う: 取りこぼしにはならず、取り直せる", () => {
  const j = new Judge([N(1000, 3, "a")]);
  assert.equal(j.attack(1000, 1).kind, "wrong");
  assert.equal(j.combo, 0);
  assert.equal(j.notes[0].res, null, "まだ確定しない");
  assert.equal(j.attack(1100, 3).kind, "hit", "滑り込みでも/押し直しでも当たる");
  assert.equal(j.counts.GREAT, 1);
});

test("滑り込み(slide)は間違った段でペナルティを出さない", () => {
  const j = new Judge([N(1000, 3, "a")]);
  assert.equal(j.attack(1000, 1, { slide: true }).kind, "free");
  assert.equal(j.attack(1060, 3, { slide: true }).kind, "hit");
});

test("顔が違う: GOOD止まりで点が半分、コンボは続く", () => {
  const j = new Judge([N(1000, 2, "i"), N(2000, 2, "a")]);
  j.setVowel(0, "a");
  j.attack(1000, 2);
  assert.equal(j.notes[0].res, null, "猶予のあいだは保留");
  j.tick(1000, { down: true, row: 2, vowel: "a" });
  j.tick(1160, { down: true, row: 2, vowel: "a" });
  assert.equal(j.notes[0].res.vowelOK, false);
  assert.equal(j.counts.FACE, 1);
  assert.equal(j.combo, 1);
  const good = new Judge([N(1000, 2, "a")]); good.attack(1000, 2);
  assert.ok(j.score < good.score * 0.6);
});

test("顔を後からそろえても、猶予内なら満点", () => {
  const j = new Judge([N(1000, 2, "o")]);
  j.setVowel(0, "a");
  j.attack(1000, 2);
  j.setVowel(1080, "o");
  j.tick(1090, { down: true, row: 2, vowel: "o" });
  assert.equal(j.notes[0].res.grade, "PERFECT");
  assert.equal(j.notes[0].res.vowelOK, true);
});

test("顔を先にそろえておく(直前の母音)も有効", () => {
  const j = new Judge([N(1000, 2, "u")]);
  j.setVowel(500, "u");
  j.attack(1010, 2);
  assert.equal(j.counts.PERFECT, 1);
});

test("取りこぼしは late 窓の満了で確定し、コンボが切れる", () => {
  const j = new Judge([N(1000, 2, "a"), N(2000, 2, "a")]);
  j.attack(1000, 2);
  j.tick(1000, null);
  j.tick(1000 + WIN.late + 10, null);
  assert.equal(j.counts.MISS, 0);
  j.tick(2000 + WIN.late + 10, null);
  assert.equal(j.counts.MISS, 1);
  assert.equal(j.combo, 0);
  const ev = j.drain().filter((e) => e.kind === "miss");
  assert.equal(ev.length, 1);
});

test("隣のノーツと窓が食い合わない(近接ノーツ)", () => {
  const j = new Judge([N(1000, 1, "a"), N(1120, 4, "a")]);
  j.attack(1115, 4);
  assert.equal(j.notes[1].res?.grade, "PERFECT");
  assert.equal(j.notes[0].res, null, "近いほうだけ消費する");
});

test("長音: 押し続けて顔と段が保たれていれば加点", () => {
  const j = new Judge([N(1000, 2, "a", 1000)]);
  j.attack(1000, 2);
  for (let t = 1000; t <= 2100; t += 16) j.tick(t, { down: true, row: 2, vowel: "a" });
  const ev = j.drain().find((e) => e.kind === "holdEnd");
  assert.ok(ev && ev.ratio > 0.9, JSON.stringify(ev));
  const j2 = new Judge([N(1000, 2, "a", 1000)]);
  j2.attack(1000, 2);
  for (let t = 1000; t <= 2100; t += 16) j2.tick(t, { down: t < 1200, row: 2, vowel: "a" });
  const e2 = j2.drain().find((e) => e.kind === "holdEnd");
  assert.ok(e2.ratio < 0.3, "早く離すと伸びない " + e2.ratio);
  assert.ok(j.score > j2.score);
});

test("満点とランク", () => {
  const notes = Array.from({ length: 20 }, (_, i) => N(1000 + i * 600, i % 6, "a"));
  const j = new Judge(notes);
  notes.forEach((n) => j.attack(n.t, n.row));
  assert.equal(j.score, j.maxScore);
  assert.equal(rankOf(j.score / j.maxScore), "S");
  assert.equal(rankOf(0.5), "C");
  assert.equal(comboMult(1000), 1.5);
});

/* ---- ピンチ ---- */
test("ピンチ: 横に開く=い / 横に閉じる=う / 縦に閉じる=え / 縦に開く=お", () => {
  const run = (a, b, a2, b2) => {
    const p = new PinchTracker();
    p.down(1, a[0], a[1]); p.down(2, b[0], b[1]);
    p.move(1, a2[0], a2[1]); p.move(2, b2[0], b2[1]);
    return p.state;
  };
  assert.equal(run([100, 200], [160, 200], [60, 200], [200, 200]).vowel, "i");
  assert.equal(run([60, 200], [200, 200], [100, 200], [150, 200]).vowel, "u");
  assert.equal(run([100, 150], [100, 250], [100, 190], [100, 215]).vowel, "e");
  assert.equal(run([100, 190], [100, 215], [100, 120], [100, 280]).vowel, "o");
});

test("ピンチ: 触れただけ/1本指 = あ。動かした量が amount", () => {
  const p = new PinchTracker();
  p.down(1, 100, 100);
  assert.equal(p.state.vowel, "a");
  p.down(2, 160, 100);
  assert.equal(p.state.vowel, "a");
  assert.equal(p.state.amount, 0);
  p.move(2, 175, 100); // ratio 1.25
  assert.equal(p.state.vowel, "i");
  const a1 = p.state.amount;
  p.move(2, 200, 100); // ratio 1.67
  assert.ok(p.state.amount > a1 && p.state.amount <= 1);
  p.up(2);
  assert.equal(p.state.vowel, "a");
});

test("ピンチ: 基準は2本目の指を置いた時。置き直すとリセット", () => {
  const p = new PinchTracker();
  p.down(1, 0, 0); p.down(2, 200, 0);
  p.move(2, 100, 0);
  assert.equal(p.state.vowel, "u");
  p.up(2); p.down(3, 100, 0);
  assert.equal(p.state.vowel, "a", "置き直した距離が新しい基準");
});

test("ピンチ: 軸の切り替えにヒステリシス(斜めでちらつかない)", () => {
  const p = new PinchTracker();
  p.down(1, 100, 100); p.down(2, 200, 100); // h
  p.move(2, 160, 150);                       // 約40°: 横のまま
  assert.equal(p.state.axis, "h");
  p.move(2, 140, 200);                       // 約68°: 縦へ
  assert.equal(p.state.axis, "v");
  p.move(2, 160, 150);                       // 約40°でも縦のまま
  assert.equal(p.state.axis, "v");
});

test("classify の境界", () => {
  assert.equal(classify("h", 1.05).vowel, "a");
  assert.equal(classify("h", 1.12).vowel, "i");
  assert.equal(classify("v", 0.88).vowel, "e");
  assert.equal(classify("h", 3).amount, 1);
});
