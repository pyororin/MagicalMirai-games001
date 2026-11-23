import test from "node:test";
import assert from "node:assert/strict";
import { carry, fence, zoneOf, FOUL_DEG } from "../app/src/carry.js";
import { judge } from "../app/src/judge.js";

test("空振り・見逃しは飛ばない", () => {
  assert.equal(carry("whiff", 200), null);
  assert.equal(carry("look", 0), null);
});

test("ホームラン判定とフェンスが食い違わない(ずれを全部試す)", () => {
  for (let dt = -150; dt <= 150; dt += 1) {
    const res = judge(dt);
    const c = carry(res, dt, Math.abs(dt));
    assert.ok(c, `dt=${dt}`);
    if (res === "hit") assert.ok(c.dist < c.fence, `ヒットはフェンス手前 dt=${dt} dist=${c.dist} fence=${c.fence}`);
    else assert.ok(c.dist > c.fence, `HRはフェンスの向こう dt=${dt} dist=${c.dist} fence=${c.fence}`);
    assert.equal(c.homerun, res !== "hit");
  }
});

test("ジャストほど遠くへ飛ぶ(同じ側で比べる)", () => {
  const d = (dt) => carry(judge(dt), dt, 7).dist;
  assert.ok(d(0) > d(20));
  assert.ok(d(20) > d(44));
  assert.ok(d(50) > d(88)); // ホームランの中でも、ずれが小さいほど遠い
  assert.ok(carry("big", 0, 1).dist > carry("hr", 60, 1).dist);
  assert.ok(carry("hr", 60, 1).dist > carry("hit", 100, 1).dist);
});

test("早い→左(x<0)、遅い→右(x>0)、ジャストは真ん中", () => {
  assert.ok(carry("hr", -70, 3).x < 0);
  assert.ok(carry("hr", 70, 3).x > 0);
  assert.ok(Math.abs(carry("big", 0, 3).x) < 1e-9);
  assert.equal(carry("hr", -70, 3).zone, "レフト");
  assert.equal(carry("hr", 70, 3).zone, "ライト");
  assert.equal(carry("big", 0, 3).zone, "センター");
});

test("角度はファウルラインの内側、座標は距離と角度に一致する", () => {
  for (const dt of [-150, -90, -30, 0, 30, 90, 150]) {
    const c = carry(judge(dt), dt, 5);
    assert.ok(Math.abs(c.angle) <= FOUL_DEG + 1e-9);
    assert.ok(Math.abs(Math.hypot(c.x, c.y) - c.dist) < 1e-6);
    assert.ok(c.y > 0);
  }
});

test("フェンスはセンターが遠く、ライン際が近い", () => {
  assert.ok(fence(0) > fence(30));
  assert.ok(fence(30) > fence(45));
  assert.equal(fence(-30), fence(30));
});

test("同じ入力なら同じ結果(決定的)", () => {
  assert.deepEqual(carry("hr", 33, 12), carry("hr", 33, 12));
});

test("場所の呼び名", () => {
  assert.equal(zoneOf(-30), "レフト");
  assert.equal(zoneOf(0), "センター");
  assert.equal(zoneOf(30), "ライト");
  assert.match(carry("big", 0, 1).place, /最上段/);
  assert.match(carry("hr", 50, 1).place, /スタンドイン/);
});
