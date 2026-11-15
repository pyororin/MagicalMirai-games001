// デプロイ用: すべてのモジュール読み込み URL にビルド番号(?v=N)を付ける。
//   node bunyutto-miku/tools/stamp-build.mjs <公開物のディレクトリ>   (CI では _site/)
//
// なぜ必要か: ES Module はファイルごとに別々にブラウザのキャッシュに載る(Pages は10分)。
// HTML だけ新しく JS が古い/一部のモジュールだけ古い、という混在が起きうる。
// import ごとに ?v=N を付ければ、ビルドが変わると全モジュールの URL が変わり、新旧が混ざらない。
// (開発中のソースはそのまま。付与は公開物のコピーにだけ行う。)
//
// 安全装置: app/index.html の window.BUNYU_BUILD と、src/game.js の BUILD が食い違っていたら失敗する。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export function stamp(dir) {
  const root = resolve(dir);
  const indexPath = join(root, "index.html");
  const index = readFileSync(indexPath, "utf8");
  const m = /window\.BUNYU_BUILD\s*=\s*(\d+)/.exec(index);
  if (!m) throw new Error("index.html に window.BUNYU_BUILD が見つかりません");
  const build = m[1];
  const game = readFileSync(join(root, "src", "game.js"), "utf8");
  const g = /export const BUILD\s*=\s*(\d+)/.exec(game);
  if (!g) throw new Error("src/game.js に export const BUILD が見つかりません");
  if (g[1] !== build) throw new Error(`ビルド番号が食い違っています: index.html=${build} / game.js=${g[1]}`);

  const q = (s) => `${s}?v=${build}`;
  let changed = 0;
  const rewrite = (path, fn) => {
    const before = readFileSync(path, "utf8");
    const after = fn(before);
    if (after !== before) {
      writeFileSync(path, after);
      changed++;
    }
  };
  // src 内: from "./x.js" と import("./x.js")
  for (const f of readdirSync(join(root, "src")).filter((x) => x.endsWith(".js"))) {
    rewrite(join(root, "src", f), (s) =>
      s.replace(/(from\s+"\.\/[A-Za-z0-9_-]+\.js)"/g, (_, a) => q(a) + '"').replace(/(import\(\s*"\.\/[A-Za-z0-9_-]+\.js)"/g, (_, a) => q(a) + '"')
    );
  }
  // HTML: <script type="module" src="./src/x.js"> と import ... from "./src/x.js"
  for (const f of readdirSync(root).filter((x) => x.endsWith(".html"))) {
    rewrite(join(root, f), (s) =>
      s
        .replace(/(src="\.\/src\/[A-Za-z0-9_-]+\.js)"/g, (_, a) => q(a) + '"')
        .replace(/(from\s+"\.\/src\/[A-Za-z0-9_-]+\.js)"/g, (_, a) => q(a) + '"')
        .replace(/(import\(\s*"\.\/src\/[A-Za-z0-9_-]+\.js)"/g, (_, a) => q(a) + '"')
    );
  }
  return { build, changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv[2]) {
    console.error("使い方: node stamp-build.mjs <公開物のディレクトリ>");
    process.exit(2);
  }
  try {
    const r = stamp(process.argv[2]);
    console.log(`build ${r.build}: ${r.changed} ファイルのモジュール URL に ?v=${r.build} を付けました`);
  } catch (e) {
    console.error("失敗:", e.message);
    process.exit(1);
  }
}
