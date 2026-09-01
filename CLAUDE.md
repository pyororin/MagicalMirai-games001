# MagicalMirai-games001

マジカルミライ プログラミング・コンテスト向けゲーム企画のリポジトリ。企画ごとに直下のディレクトリに分ける。

## 最初に読むもの

- **`ontology/`** — 過去セッションで躓いた知見の集約（症状から引ける YAML）。
  デバッグや作り込みを始める前に必ず確認すること。新しく躓いて解決したらエントリを追記する
  （運用ルールは `ontology/README.md`）。
  - `ontology/textalive.yaml` — TextAlive App API / Songle（楽曲・歌詞・音源）
  - `ontology/infra.yaml` — GitHub Pages / Actions / sandbox・ブラウザ実装の落とし穴
  - `ontology/rhythm-game.yaml` — リズムゲームの判定・入力・体感
    （判定窓が失敗音の遅れを決める、打ち逃しが次の入力を吸う、効果音の重ねすぎ 等）

## リポジトリ構成

- `miku-twintail/` — 企画「ミクの本体はツインテールである」（設計書・モック・TextAlive 接続版アプリ）
- `typing-game/` — 企画「打鍵ミライ」(リズムタイピング。判定コア+テスト、合成音デモ、TextAlive 接続版)
- `.github/workflows/pages.yml` — miku-twintail の Pages デプロイ(gh-pages・サブディレクトリ配置)
- `.github/workflows/pages-typing-game.yml` — typing-game とランディングの Pages デプロイ

## 重要な運用注意

- Pages は gh-pages ブランチ配信。**サイト全体を置き換えるデプロイは他企画を消す**。
  必ず peaceiris/actions-gh-pages の `destination_dir: <企画ディレクトリ>` を使うこと
  （詳細: `ontology/infra.yaml` の gh-pages-mutual-wipe）。
- TextAlive のアプリトークンはクライアント埋め込み前提の公開トークン。アプリ URL の登録を公開先と揃える。
- ページにビルド番号を表示しておくこと。キャッシュされた旧版を新版と誤認する事故を防ぐ
  (詳細: `ontology/infra.yaml` の stale-cache-misdiagnosis)。
- **main へマージしたら、毎回デプロイ先の URL を提示する**(利用者は実機で確認するため)。
  実楽曲版: https://pyororin.github.io/MagicalMirai-games001/typing-game/prototype/textalive.html
- sandbox から `pyororin.github.io` へは到達できない(プロキシが 403)。反映確認は
  curl のポーリングではなく Actions のワークフロー実行結果で行う
  (詳細: `ontology/infra.yaml` の pages-unreachable-from-sandbox)。
- 外部 API を叩くページには「失敗した通信の URL とステータス」を出す診断を最初から入れる
  (詳細: `ontology/textalive.yaml` の silent-load-failure / card-data-resolver-unavailable)。
