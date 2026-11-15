# ぶにゅっとミク

ピンチで歌わせる音ゲー。片手で盤面(スティック)をタップして音の高さ、片手でミクの顔をピンチして口の形(あいうえお)。
ノーツは歌詞の1音で、「その母音の顔」を作って「その段」を鳴らす。マジカルミライ 2025 課題曲6曲。

- 公開 URL: https://pyororin.github.io/MagicalMirai-games001/bunyutto-miku/
- デモ(TextAlive 無し・合成伴奏): 末尾に `?demo=1`
- 設計: [docs/DESIGN.md](docs/DESIGN.md)

## ディレクトリ

| パス | 内容 |
|---|---|
| `app/` | 公開物(ビルド不要。ES Modules をそのまま配信) |
| `app/src/chart.js` | 譜面生成(歌詞→モーラ→間引き→母音・音高) |
| `app/src/key.js` / `vowel.js` | コード解析・調推定 / 読み→母音 |
| `app/src/judge.js` / `pinch.js` | 判定 / ピンチ検出 |
| `app/src/voice.js` / `face.js` | 歌声の合成ボイス / ドット絵の顔(デザインデータを読んで描く) |
| `app/src/game.js` | 描画・入力・進行 |
| `app/src/textalive.js` / `demo.js` | TextAlive ソース / 合成伴奏のデモソース |
| `app/face-lab.html` | デザインラボ(顔のデザイン JSON を編集してプレビュー、コマ送り) |
| `app/data/design/miku-face.json` | **顔・表情のデザインデータ**(色・形・5表情・髪・動き。本編はこれを読んで描く) |
| `design/` | デザインの説明([README](design/README.md))とデザインシート(PNG) |
| `tools/render-design-sheet.mjs` | デザインデータからデザインシート(PNG)を生成 |
| `tools/build-songs.mjs` | カード JSON+読みデータ → `app/data/songs/*.json` |
| `test/` | 単体テスト |

## 実行

```sh
node --test bunyutto-miku/test/*.test.mjs        # 単体テスト(依存なし)
cd bunyutto-miku/app && python3 -m http.server   # → http://localhost:8000/?demo=1
```

PC では A S D F G H が段(低→高)、←→↑↓ が顔(う/い/お/え)。

## ビルド番号とキャッシュ

`app/index.html` の `window.BUNYU_BUILD` と `app/src/game.js` の `BUILD` を**同時に**上げる。
食い違うと画面左下のバッジが赤くなり、デプロイ時の `tools/stamp-build.mjs` が失敗する。

デプロイ(Actions)では、公開物のコピーのすべてのモジュール読み込みに `?v=<build>` を付ける
(ES Module はファイルごとにキャッシュされ、HTML と JS の新旧が混ざりうるため。ソースは書き換えない)。
それでも `index.html` 自体は Pages のキャッシュで最大10分古いことがあるので、
**最新を確実に見るには URL の末尾に `?v=<build>` を付ける**(例: `…/bunyutto-miku/?v=9`、デモは `?demo=1&v=9`)。
