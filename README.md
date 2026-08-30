# MagicalMirai-games001

初音ミク「マジカルミライ」プログラミング・コンテストに向けたゲーム企画置き場。
企画ごとにリポジトリ直下のディレクトリに分けて管理する。

- コンテスト: [TextAlive App API](https://developer.textalive.jp/) を使い、課題曲に合わせて動く「リリックアプリ」を応募する（例年 4 月頃募集開始〜7 月締切）
- 公開デモ: GitHub Pages（gh-pages ブランチ配信） https://pyororin.github.io/MagicalMirai-games001/

## 企画一覧

| ディレクトリ | タイトル | 概要 | デモ |
| --- | --- | --- | --- |
| [miku-twintail/](miku-twintail/) | ミクの本体はツインテールである | 日常の物（ホイール・炊飯器など）に歌声由来のツインテールを生やして「ミク度」を競う、福笑い×リズムのゲーム。歌詞の文字が髪になり、コード進行の合いの手が鳴り、サビで自動採点 | [アプリ](https://pyororin.github.io/MagicalMirai-games001/miku-twintail/) ・ [検証モック](https://pyororin.github.io/MagicalMirai-games001/miku-twintail/prototype/) |
| typing-game/（PR #1 ブランチ） | タイピングゲーム企画 | 歌詞の文字単位タイミングで判定するタイピング/フリック入力ゲーム | [デモ](https://pyororin.github.io/MagicalMirai-games001/typing-game/) |

## miku-twintail の中身

| パス | 内容 |
| --- | --- |
| `docs/MARKET_RESEARCH.md` | 市場調査（コンテスト動向・類似作の構造分解・文化的文脈） |
| `docs/DESIGN.md` | 設計書（出落ち回避の 3 層設計、ミク度採点式、枯れた技術の水平思考） |
| `docs/TEXTALIVE_DEV.md` | TextAlive App API 開発ガイド |
| `prototype/index.html` | 依存なし単体 HTML の検証モック（擬似曲・髪物理・採点） |
| `app/` | TextAlive App API 接続版（Vite）。実曲のビート・歌詞・ボーカル音量・サビ検出で動作 |

## 開発の始め方

```sh
cd miku-twintail/app
npm install
npm run dev     # http://localhost:5173
```

ホスト接続テスト（応募時の挙動）は [TextAlive App Debugger](https://developer.textalive.jp/app/) に localhost の URL を入力する。

## ⚠ 開発前に読むこと — ontology/

**API・インフラで躓いた点の知見は [ontology/](ontology/) に集約している**（症状から引ける YAML）。
「読み込み中で止まる」「Pages が 404」「sandbox から API に届かない」などは既知の解決策がある。
新しいセッション・別アプリの開発時は、デバッグの前にまずここを読むこと。解決した躓きは追記すること。

- [ontology/textalive.yaml](ontology/textalive.yaml) — TextAlive / Songle（必要ドメイン 3 種、Card data resolver エラー、無音で止まる問題ほか）
- [ontology/infra.yaml](ontology/infra.yaml) — GitHub Pages / Actions / sandbox（gh-pages の消し合い、Pages 権限、ヘッドレス Chromium の TLS 回避ほか）

## デプロイ

各企画ブランチへの push で `.github/workflows/pages.yml` が gh-pages にデプロイする。
**必ず `destination_dir: <企画ディレクトリ>` を使い、他企画のディレクトリを保持すること**
（全置換方式は他企画を消す。詳細は ontology/infra.yaml の gh-pages-mutual-wipe）。
