import test from "node:test";
import assert from "node:assert/strict";
import { stepSpring, SPRING_LIMITS } from "../app/src/motion.js";

const KEYS = ["a", "i", "u", "e", "o"];
const mk = (a = 1) => ({ w: { a, i: 0, u: 0, e: 0, o: 0 }, v: { a: 0, i: 0, u: 0, e: 0, o: 0 } });
const run = (sim, tgt, sec, hz, z, dt = 1 / 60) => {
  const trace = [];
  for (let t = 0; t < sec; t += dt) { stepSpring(sim.w, sim.v, tgt, dt, hz, z, KEYS); trace.push({ ...sim.w }); }
  return trace;
};

test("バネ: 目標へ収束し、行き過ぎ(オーバーシュート)が出る", () => {
  const sim = mk();
  const tr = run(sim, { a: 0, i: 1, u: 0, e: 0, o: 0 }, 2, 5, 0.42);
  const peak = Math.max(...tr.map((x) => x.i));
  assert.ok(peak > 1.1 && peak < 1.35, "行き過ぎ " + peak.toFixed(3));
  assert.ok(Math.abs(sim.w.i - 1) < 0.01 && Math.abs(sim.w.a) < 0.01, "収束 " + JSON.stringify(sim.w));
});

test("バネ: damping が 1 以上なら行き過ぎない", () => {
  const sim = mk();
  const tr = run(sim, { a: 0, i: 1, u: 0, e: 0, o: 0 }, 2, 5, 1.0);
  assert.ok(Math.max(...tr.map((x) => x.i)) <= 1.001, "行き過ぎ無し");
});

test("バネ: 重みの和が保たれる(表情の合成が崩れない)", () => {
  const sim = mk();
  const tr = run(sim, { a: 0, i: 0, u: 1, e: 0, o: 0 }, 1.5, 5, 0.42);
  for (const x of tr) assert.ok(Math.abs(KEYS.reduce((s, k) => s + x[k], 0) - 1) < 1e-6, "和が1");
});

test("バネ: フレーム間隔が長くても発散しない(100ms)", () => {
  const sim = mk();
  const tr = run(sim, { a: 0, i: 0, u: 0, e: 1, o: 0 }, 3, 5, 0.42, 0.1);
  for (const x of tr) for (const k of KEYS) assert.ok(x[k] >= SPRING_LIMITS.min - 1e-9 && x[k] <= SPRING_LIMITS.max + 1e-9, k + " が範囲内");
  assert.ok(Math.abs(sim.w.e - 1) < 0.02, "収束");
});

test("バネ: 行き過ぎの上限で、極端な崩れを防ぐ", () => {
  const sim = mk();
  const tr = run(sim, { a: 0, i: 1, u: 0, e: 0, o: 0 }, 2, 9, 0.1); // ほぼ減衰しない暴れるバネ
  assert.ok(Math.max(...tr.map((x) => x.i)) <= SPRING_LIMITS.max + 1e-9);
  assert.ok(Math.min(...tr.map((x) => x.a)) >= SPRING_LIMITS.min - 1e-9);
});
