# MagicalMirai-games001

初音ミク「マジカルミライ」プログラミング・コンテストに向けたゲーム企画置き場。
企画ごとにリポジトリ直下のディレクトリに分けて管理する。

- コンテスト: [TextAlive App API](https://developer.textalive.jp/) を使い、課題曲に合わせて動く「リリックアプリ」を応募する(例年 4 月頃募集開始〜7 月締切)
- 公開デモ: GitHub Pages(gh-pages ブランチ配信) https://pyororin.github.io/MagicalMirai-games001/

## 企画一覧

| ディレクトリ | タイトル | 概要 | デモ |
| --- | --- | --- | --- |
| [miku-twintail/](miku-twintail/) | ミクの本体はツインテールである | 日常の物(ホイール・炊飯器など)に歌声由来のツインテールを生やして「ミク度」を競う、福笑い×リズムのゲーム。歌詞の文字が髪になり、コード進行の合いの手が鳴り、サビで自動採点 | [アプリ](https://pyororin.github.io/MagicalMirai-games001/miku-twintail/) ・ [検証モック](https://pyororin.github.io/MagicalMirai-games001/miku-twintail/prototype/) |
| [typing-game/](typing-game/) | 打鍵ミライ(リズムタイピング) | 歌詞を、メロディに乗せて打つ。判定単位を「かな確定」に置きローマ字複数打鍵問題を解消。表記ゆれ全受理・先行入力・難易度別密度制御。スマホは1タッチゾーン式フリック(1かな=1ジェスチャ) | [実楽曲版](https://pyororin.github.io/MagicalMirai-games001/typing-game/prototype/textalive.html) ・ [合成音版](https://pyororin.github.io/MagicalMirai-games001/typing-game/prototype/demo.html) |

## 各企画の中身

### miku-twintail

| パス | 内容 |
| --- | --- |
| `docs/MARKET_RESEARCH.md` | 市場調査(コンテスト動向・類似作の構造分解・文化的文脈) |
| `docs/DESIGN.md` | 設計書(出落ち回避の 3 層設計、ミク度採点式、枯れた技術の水平思考) |
| `docs/TEXTALIVE_DEV.md` | TextAlive App API 開発ガイド |
| `prototype/index.html` | 依存なし単体 HTML の検証モック(擬似曲・髪物理・採点) |
| `app/` | TextAlive App API 接続版(Vite)。実曲のビート・歌詞・ボーカル音量・サビ検出で動作 |

### typing-game

| パス | 内容 |
| --- | --- |
| `docs/DESIGN.md` | 設計書(かな確定判定・先行入力・密度制御・フリック方式) |
| `docs/MARKET_RESEARCH.md` | 市場調査(過去入賞作、先行作 Typing Lyrics との差分、審査基準) |
| `prototype/src/` | 判定コア(ローマ字トライ・タイミング判定)。ユニットテスト 43 件 |
| `prototype/demo.html` | 合成音+オリジナル歌詞のオフラインデモ(単体 HTML) |
| `prototype/textalive.html` | 実楽曲版。課題曲「ロンリーラン」で実データ検証済み(かな比率 74%、判定窓クランプ必須を確認) |
| `prototype/miku/` | ミクの見た目と仕草のコンポーネント(表情・ポーズ・間奏の仕草)。追加手順は同梱の README |
| `prototype/vendor/` | 同梱ライブラリ(CDN 非依存の同一オリジン配信) |

## 開発の始め方

```sh
# miku-twintail(Vite アプリ)
cd miku-twintail/app && npm install && npm run dev   # http://localhost:5173

# typing-game(コアのテスト)
cd typing-game/prototype && npm install && npm test  # vitest 43件
# demo.html / textalive.html はビルド不要。ブラウザで直接開ける
```

ホスト接続テスト(応募時の挙動)は [TextAlive App Debugger](https://developer.textalive.jp/app/) に localhost の URL を入力する。

## ⚠ 開発前に読むこと — ontology/

**API・インフラで躓いた点の知見は [ontology/](ontology/) に集約している**(症状から引ける YAML)。
「読み込み中で止まる」「Pages が 404」「sandbox から API に届かない」などは既知の解決策がある。
新しいセッション・別アプリの開発時は、デバッグの前にまずここを読むこと。解決した躓きは追記すること。

- [ontology/textalive.yaml](ontology/textalive.yaml) — TextAlive / Songle(必要ドメイン、Card data resolver エラーの2系統の原因とフォールバック、読みデータ非提供、無音で止まる問題ほか)
- [ontology/infra.yaml](ontology/infra.yaml) — GitHub Pages / Actions / sandbox(gh-pages の消し合い、Pages 手動有効化、キャッシュとビルド番号、ヘッドレス Chromium の TLS 回避ほか)

## デプロイ

企画ごとのワークフロー(`.github/workflows/pages.yml` = miku-twintail、`pages-typing-game.yml` = typing-game + ランディング)が gh-pages にデプロイする。
**必ず `destination_dir: <企画ディレクトリ>` を使い、他企画のディレクトリを保持すること**
(全置換方式は他企画を消す。詳細は ontology/infra.yaml の gh-pages-mutual-wipe)。
Pages の反映は CDN キャッシュで最大10分程度。typing-game のページはビルド番号表示で版を確認できる。
