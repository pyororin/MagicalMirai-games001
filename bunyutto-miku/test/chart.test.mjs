import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { splitMoras, kanaVowel, vowelOfGesture } from "../app/src/vowel.js";
import { parseChord, detectKey, rowMidi, NOTE_NAMES } from "../app/src/key.js";
import { expandSong, buildChart, DIFFS } from "../app/src/chart.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../app/data/songs");
const songs = readdirSync(dir).filter((f) => f !== "index.json").map((f) => expandSong(JSON.parse(readFileSync(join(dir, f), "utf8"))));

test("読み → モーラ: 拗音・長音・促音・撥音", () => {
  assert.deepEqual(splitMoras("きょう").map((m) => m.v + ":" + m.kana), ["o:きょ", "u:う"]);
  assert.deepEqual(splitMoras("ロンリー").map((m) => m.kana), ["ろ", "ん", "り"]);
  assert.equal(splitMoras("ロンリー")[2].ext, 1, "ー は直前のモーラを伸ばす");
  assert.deepEqual(splitMoras("かっ").map((m) => m.kana), ["か"], "っ は無音");
  assert.equal(splitMoras("ふぁ")[0].v, "a");
  assert.equal(kanaVowel("ん"), "u");
  assert.equal(kanaVowel("漢"), null);
});

test("ジェスチャ → 母音 の対応が5つで全単射", () => {
  const set = new Set([vowelOfGesture(null, null), vowelOfGesture("h", "out"), vowelOfGesture("h", "in"), vowelOfGesture("v", "in"), vowelOfGesture("v", "out")]);
  assert.equal(set.size, 5);
  assert.equal(vowelOfGesture("h", "out"), "i");
  assert.equal(vowelOfGesture("v", "out"), "o");
});

test("コード名の解析", () => {
  assert.deepEqual(parseChord("Am").strong, [9, 0, 4]);
  assert.deepEqual(parseChord("C").strong, [0, 4, 7]);
  assert.equal(parseChord("N"), null);
  assert.ok(parseChord("AbM7").weak.includes(7), "AbM7 の長7度は G");
  assert.ok(!parseChord("AbM7").minor, "M7 は短調ではない");
  assert.ok(parseChord("Bm(11)").minor);
  assert.equal(parseChord("Eb/Bb").bass, 10);
  assert.deepEqual(parseChord("Esus2").strong, [4, 6, 11]);
});

test("調の推定: 明らかな進行", () => {
  const mk = (names) => names.map((n, i) => ({ s: i * 2000, e: i * 2000 + 2000, name: n }));
  assert.equal(detectKey(mk(["C", "G", "Am", "F", "C", "G", "F", "C"])), 0);
  assert.equal(detectKey(mk(["Am", "F", "C", "G", "Am", "F", "C", "G"])), 0, "短調は平行調に寄る");
  assert.equal(detectKey(mk(["D", "A", "Bm", "G", "D", "A", "G", "D"])), 2);
});

test("声域: 6段が1オクターブ+で並び、高い順", () => {
  for (let k = 0; k < 12; k++) {
    const m = rowMidi(k);
    assert.equal(m.length, 6);
    for (let i = 1; i < 6; i++) assert.ok(m[i] > m[i - 1]);
    assert.ok(m[0] >= 60 && m[0] <= 71, `tonic ${k} → ${m[0]}`);
    assert.ok(m[5] <= 83, "最高音は B5 まで");
    assert.equal(m[5] - m[0], 12);
  }
});

for (const song of songs) {
  test(`譜面: ${song.title}`, () => {
    const stat = {};
    for (const d of Object.keys(DIFFS)) {
      const { notes, tonic } = buildChart(song, d);
      const cfg = DIFFS[d];
      assert.ok(notes.length > 30, `${d} ノーツが少なすぎる ${notes.length}`);
      for (let i = 1; i < notes.length; i++) {
        const gap = notes[i].t - notes[i - 1].t;
        const need = notes[i].vowel === notes[i - 1].vowel ? cfg.gapSame : cfg.gapDiff;
        assert.ok(gap >= need - 1, `${d} #${i} 間隔 ${gap} < ${need}`);
        assert.ok(notes[i].row >= 0 && notes[i].row < 6);
      }
      const secs = (notes[notes.length - 1].t - notes[0].t) / 1000;
      const vows = {};
      notes.forEach((n) => (vows[n.vowel] = (vows[n.vowel] || 0) + 1));
      const rows = new Array(6).fill(0);
      notes.forEach((n) => rows[n.row]++);
      stat[d] = `${notes.length}notes ${(notes.length / secs).toFixed(2)}/s hold${notes.filter((n) => n.hold).length} v=${JSON.stringify(vows)} rows=${rows} key=${NOTE_NAMES[tonic]}`;
    }
    console.log(song.title, "\n  " + Object.entries(stat).map(([k, v]) => k + " " + v).join("\n  "));
    // 難易度が上がるほどノーツが増える
    const n = (d) => buildChart(song, d).notes.length;
    assert.ok(n("EASY") < n("NORMAL") && n("NORMAL") < n("HARD"));
  });
}

test("同じ曲・難易度なら譜面は毎回同じ(決定的)", () => {
  const a = JSON.stringify(buildChart(songs[0], "NORMAL").notes);
  const b = JSON.stringify(buildChart(songs[0], "NORMAL").notes);
  assert.equal(a, b);
});
