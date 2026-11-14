# ほっぺミライ

オタマトーン風の音ゲー。片手で盤面(スティック)をタップして音の高さ、片手でミクの顔をピンチして口の形(あいうえお)。
ノーツは歌詞の1音で、「その母音の顔」を作って「その段」を鳴らす。マジカルミライ 2025 課題曲6曲。

- 公開 URL: https://pyororin.github.io/MagicalMirai-games001/otama-game/
- デモ(TextAlive 無し・合成伴奏): 末尾に `?demo=1`
- 設計: [docs/DESIGN.md](docs/DESIGN.md)

## ディレクトリ

| パス | 内容 |
|---|---|
| `app/` | 公開物(ビルド不要。ES Modules をそのまま配信) |
| `app/src/chart.js` | 譜面生成(歌詞→モーラ→間引き→母音・音高) |
| `app/src/key.js` / `vowel.js` | コード解析・調推定 / 読み→母音 |
| `app/src/judge.js` / `pinch.js` | 判定 / ピンチ検出 |
| `app/src/voice.js` / `face.js` | フォルマント合成ボイス / ドット絵の顔 |
| `app/src/game.js` | 描画・入力・進行 |
| `app/src/textalive.js` / `demo.js` | TextAlive ソース / 合成伴奏のデモソース |
| `app/face-lab.html` | 表情の確認ページ |
| `tools/build-songs.mjs` | カード JSON+読みデータ → `app/data/songs/*.json` |
| `test/` | 単体テスト |

## 実行

```sh
node --test otama-game/test/*.test.mjs        # 単体テスト(依存なし)
cd otama-game/app && python3 -m http.server   # → http://localhost:8000/?demo=1
```

PC では A S D F G H が段(低→高)、←→↑↓ が顔(う/い/お/え)。

## ビルド番号

`app/index.html` の `window.OTAMA_BUILD` と `app/src/game.js` の `BUILD` を**同時に**上げる。
食い違うと画面左下のバッジが赤くなる(ES Module はファイルごとにキャッシュされるため、新旧混在の検出用)。
