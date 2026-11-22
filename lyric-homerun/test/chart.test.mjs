import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { expandSong, generatePitches, DIFFS, flightMs } from "../app/src/chart.js";

const dir = new URL("../app/data/songs/", import.meta.url);
const songs = readdirSync(dir)
  .filter((f) => f !== "index.json")
  .map((f) => expandSong(JSON.parse(readFileSync(new URL(f, dir), "utf8"))));

// docs/DESIGN.md §4 の表(2025年課題曲6曲の実測)
const RANGE = { EASY: [30, 49], NORMAL: [59, 104], HARD: [84, 148] };

test("課題曲6曲がそろっている", () => assert.equal(songs.length, 6));

for (const diff of Object.keys(DIFFS)) {
  test(`${diff}: 球数が設計の範囲に収まり、最小間隔を守る`, () => {
    for (const s of songs) {
      const c = generatePitches(s, diff);
      const n = c.pitches.length;
      assert.ok(n >= RANGE[diff][0] && n <= RANGE[diff][1], `${s.title} ${diff}: ${n}球`);
      for (let i = 1; i < n; i++) {
        const g = c.pitches[i].t - c.pitches[i - 1].t;
        assert.ok(g >= DIFFS[diff].minGap * 0.95, `${s.title} ${diff}: 間隔 ${g}ms`);
      }
      assert.equal(c.quota, Math.ceil(n * DIFFS[diff].quota));
    }
  });
}

test("同じ入力なら同じ投球になる(乱数を使わない)", () => {
  const a = generatePitches(songs[0], "NORMAL");
  const b = generatePitches(songs[0], "NORMAL");
  assert.deepEqual(a, b);
});

test("EASY はフレーズ頭だけを投げる", () => {
  // フレーズが記号(「 など)で始まるときは、最初に歌われる文字が頭になる
  const sung = /[ぁ-んァ-ヶ一-龠々a-zA-Z0-9]/;
  for (const s of songs)
    for (const p of generatePitches(s, "EASY").pitches)
      assert.ok(s.phrases[p.pi].chars.slice(0, p.ci).every((c) => !sung.test(c.text)), s.title);
});

test("球が運ぶことばは空でなく、到達時刻は最初の文字の発声開始", () => {
  for (const s of songs) {
    const c = generatePitches(s, "HARD");
    for (const p of c.pitches) {
      assert.ok(p.chars.length > 0);
      assert.equal(p.chars[0].s, p.t);
      assert.equal(p.chars[0].text, s.phrases[p.pi].chars[p.ci].text);
    }
  }
});

test("同じフレーズの文字は、どれか1球が運ぶ(重複しない)", () => {
  const s = songs[0];
  const c = generatePitches(s, "HARD");
  const seen = new Set();
  for (const p of c.pitches) p.chars.forEach((_, k) => {
    const key = p.pi + ":" + (p.ci + k);
    assert.ok(!seen.has(key), key);
    seen.add(key);
  });
});

test("飛行時間は拍の整数倍で 0.6〜1.3 秒", () => {
  for (const bm of [300, 333, 411, 462, 513]) {
    const f = flightMs(bm);
    assert.ok(f >= 600 && f <= 1300);
    assert.ok(Math.abs(f / bm - Math.round(f / bm)) < 1e-9);
  }
  assert.equal(flightMs(0), 900);
});
