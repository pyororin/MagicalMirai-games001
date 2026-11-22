import { test } from "node:test";
import assert from "node:assert/strict";
import { WIN, judge, isHomerun, direction, pickPitch, reachOf, tally } from "../app/src/judge.js";

test("ずれの大きさで結果が決まる", () => {
  assert.equal(judge(0), "big");
  assert.equal(judge(-WIN.big), "big");
  assert.equal(judge(WIN.big + 1), "hr");
  assert.equal(judge(-WIN.hr), "hr");
  assert.equal(judge(WIN.hr + 1), "hit");
  assert.equal(judge(WIN.hit + 1), "whiff");
  assert.equal(judge(WIN.whiff + 1), null);
});

test("ホームランだけがノルマに数えられる", () => {
  assert.ok(isHomerun("big") && isHomerun("hr"));
  assert.ok(!isHomerun("hit") && !isHomerun("whiff") && !isHomerun("look"));
});

test("早いと左、遅いと右へ飛ぶ", () => {
  assert.ok(direction(-60) < 0);
  assert.ok(direction(60) > 0);
  assert.equal(direction(0), 0);
  assert.equal(direction(-500), -1);
  assert.equal(direction(500), 1);
});

const P = [{ t: 1000 }, { t: 1400 }, { t: 3000 }];

test("いちばん近い未処理の球を選ぶ。離れすぎた素振りは -1", () => {
  assert.equal(pickPitch(P, [], 1010), 0);
  assert.equal(pickPitch(P, [], 1390), 1);
  assert.equal(pickPitch(P, [], 2200), -1);
  assert.equal(pickPitch(P, [], 3300), 2);
});

test("届く範囲は隣の球との中間点で切る", () => {
  assert.equal(reachOf(P, 0), 200);
  assert.equal(reachOf(P, 1), 200);
  assert.equal(reachOf(P, 2), WIN.whiff);
  assert.equal(pickPitch(P, [], 1190), 0);
  assert.equal(pickPitch(P, [], 1210), 1);
});

test("結果の出た球は二度打てない(古い球が次の入力を吸わない)", () => {
  const res = [{ res: "hr", dt: 10 }];
  assert.equal(pickPitch(P, res, 1010), -1);
  assert.equal(pickPitch(P, res, 1250), 1);
});

test("集計: ホームラン数と、早い/遅いの偏り", () => {
  const res = [{ res: "big", dt: -20 }, { res: "hit", dt: -100 }, { res: "look", dt: 0 }];
  const t = tally(P, res);
  assert.equal(t.homeruns, 1);
  assert.equal(t.thrown, 3);
  assert.equal(t.bias, -60);
});
