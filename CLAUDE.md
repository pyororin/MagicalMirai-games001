# MagicalMirai-games001

マジカルミライ プログラミング・コンテスト向けゲーム企画のリポジトリ。企画ごとに直下のディレクトリに分ける。

## 最初に読むもの

- **`docs/PRINCIPLES.md`** — リリックアプリの目的とコンテスト規約から導いた**全企画共通の大方針**
  (TextAlive 必須・静的アプリのみ・難読化禁止・AI 生成物を作品に出さない・審査3観点 など)。企画を始める/設計を変える前に必ず読む。
- `docs/research/` — 企画のための調査メモ(例: `pooh-home-run-derby.md`)。

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
- `bunyutto-miku/` — 企画「ぶにゅっとミク」(片手でスティックをタップ、片手でミクの顔をピンチ。
  歌詞の母音=口の形=ピンチ操作。`app/` が公開物、`test/` は `node --test` で動く単体テスト、`docs/DESIGN.md` が設計。
  **ミクの顔・表情のデザインは `app/data/design/miku-face.json`(データ)で、本編はこれを読んで描く。顔を直すときはこのJSONを編集する**。`design/README.md` に手順)
  **顔のデザインを変える前に、本家の公式イラスト(`design/README.md` の「本家イラストの参照」)を必ず確認する。口は極小の細い線で、たらこ唇にしない。コミカルにしすぎない。案はシートで先に提示してから本編に反映する**
- `.github/workflows/pages.yml` — miku-twintail の Pages デプロイ(gh-pages・サブディレクトリ配置)
- `.github/workflows/pages-typing-game.yml` — typing-game とランディングの Pages デプロイ
- `.github/workflows/pages-bunyutto-miku.yml` — bunyutto-miku の Pages デプロイ(テスト通過が条件)

## 重要な運用注意

- Pages は gh-pages ブランチ配信。**サイト全体を置き換えるデプロイは他企画を消す**。
  必ず peaceiris/actions-gh-pages の `destination_dir: <企画ディレクトリ>` を使うこと
  （詳細: `ontology/infra.yaml` の gh-pages-mutual-wipe）。
- TextAlive のアプリトークンはクライアント埋め込み前提の公開トークン。アプリ URL の登録を公開先と揃える。
- ページにビルド番号を表示しておくこと。キャッシュされた旧版を新版と誤認する事故を防ぐ
  (詳細: `ontology/infra.yaml` の stale-cache-misdiagnosis)。
- **main へマージしたら、毎回デプロイ先の URL を提示する**(利用者は実機で確認するため)。
  実楽曲版: https://pyororin.github.io/MagicalMirai-games001/typing-game/prototype/textalive.html
  ぶにゅっとミク: https://pyororin.github.io/MagicalMirai-games001/bunyutto-miku/?v=<ビルド番号> (デモ: `?demo=1&v=<ビルド番号>`)
- **返信のたびに Pages の URL を添える**(マージ前でも。公開済みの版のビルド番号と、未マージの変更があるかも一緒に伝える)。
  **URL には必ず `?v=<ビルド番号>` を付けて出す**(Pages は10分キャッシュされ、利用者が古い版を見る事故が起きたため)。
  例: ぶにゅっとミク build 9 → https://pyororin.github.io/MagicalMirai-games001/bunyutto-miku/?v=9 、
  デモは https://pyororin.github.io/MagicalMirai-games001/bunyutto-miku/?demo=1&v=9 。
  ビルド番号は `bunyutto-miku/app/index.html` の `BUNYU_BUILD`(マージ後に公開される番号)。
- sandbox から `pyororin.github.io` へは到達できない(プロキシが 403)。反映確認は
  curl のポーリングではなく Actions のワークフロー実行結果で行う
  (詳細: `ontology/infra.yaml` の pages-unreachable-from-sandbox)。
- 外部 API を叩くページには「失敗した通信の URL とステータス」を出す診断を最初から入れる
  (詳細: `ontology/textalive.yaml` の silent-load-failure / card-data-resolver-unavailable)。
