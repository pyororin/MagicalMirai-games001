# MagicalMirai-games001

マジカルミライ プログラミング・コンテスト向けゲーム企画のリポジトリ。企画ごとに直下のディレクトリに分ける。

## 最初に読むもの

- **`ontology/`** — 過去セッションで躓いた API・インフラの知見集約（症状から引ける YAML）。
  TextAlive App API / Songle / GitHub Pages / sandbox のネットワークまわりで問題が出たら、
  デバッグを始める前に必ず `ontology/textalive.yaml` と `ontology/infra.yaml` を確認すること。
  新しく躓いて解決したらエントリを追記する（運用ルールは `ontology/README.md`）。

## リポジトリ構成

- `miku-twintail/` — 企画「ミクの本体はツインテールである」（設計書・モック・TextAlive 接続版アプリ）
- `typing-game/`（別ブランチ/PR #1）— タイピングゲーム企画
- `.github/workflows/pages.yml` — GitHub Pages デプロイ（gh-pages ブランチ方式・サブディレクトリ配置）

## 重要な運用注意

- Pages は gh-pages ブランチ配信。**サイト全体を置き換えるデプロイは他企画を消す**。
  必ず peaceiris/actions-gh-pages の `destination_dir: <企画ディレクトリ>` を使うこと
  （詳細: `ontology/infra.yaml` の gh-pages-mutual-wipe）。
- TextAlive のアプリトークンはクライアント埋め込み前提の公開トークン。アプリ URL の登録を公開先と揃える。
