import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stamp } from "../tools/stamp-build.mjs";

const app = join(dirname(fileURLToPath(import.meta.url)), "../app");
const copy = () => {
  const d = mkdtempSync(join(tmpdir(), "stamp-"));
  cpSync(app, d, { recursive: true });
  return d;
};
const build = () => /window\.BUNYU_BUILD = (\d+)/.exec(readFileSync(join(app, "index.html"), "utf8"))[1];

test("すべてのモジュール読み込みにビルド番号が付く(src・index.html・face-lab)", () => {
  const d = copy();
  const r = stamp(d);
  assert.equal(r.build, build());
  assert.ok(r.changed >= 8, "変更したファイル数 " + r.changed);
  // 相対 import は、すべて ?v=<build> を持つ
  let n = 0;
  for (const f of readdirSync(join(d, "src")).filter((x) => x.endsWith(".js"))) {
    const s = readFileSync(join(d, "src", f), "utf8");
    for (const m of s.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
      n++;
      assert.ok(m[1].endsWith(".js?v=" + r.build), `${f}: ${m[1]}`);
    }
  }
  assert.ok(n >= 20, "import の数 " + n);
  const idx = readFileSync(join(d, "index.html"), "utf8");
  assert.ok(idx.includes(`src="./src/game.js?v=${r.build}"`), "index.html の module script");
  const lab = readFileSync(join(d, "face-lab.html"), "utf8");
  assert.ok(lab.includes(`from "./src/face.js?v=${r.build}"`), "face-lab の import");
  // vendor の通常の script 読み込みは触らない
  assert.ok(idx.includes('src="./vendor/axios.min.js"'));
});

test("二重に付けない(2回実行しても同じ)", () => {
  const d = copy();
  stamp(d);
  const once = readFileSync(join(d, "src", "game.js"), "utf8");
  stamp(d);
  assert.equal(readFileSync(join(d, "src", "game.js"), "utf8"), once);
});

test("index.html と game.js のビルド番号が食い違っていたら失敗する(古い版の混入を防ぐ)", () => {
  const d = copy();
  const p = join(d, "src", "game.js");
  writeFileSync(p, readFileSync(p, "utf8").replace(/export const BUILD = \d+;/, "export const BUILD = 0;"));
  assert.throws(() => stamp(d), /食い違/);
});

test("ソース(app/)自体は書き換えない", () => {
  stamp(copy());
  const s = readFileSync(join(app, "src", "game.js"), "utf8");
  assert.ok(!/from\s+"\.\/[^"]+\.js\?v=/.test(s), "ソースに ?v= が混ざっていない");
});
