# MagicalMirai-games001

マジカルミライ プログラミング・コンテスト向けゲーム企画のリポジトリ。企画ごとに直下のディレクトリに分ける。

## 進め方の約束(必ず守る)

### 1. 変更依頼は、先に「基本設計の Artifact」へ反映してから実施する(リリックホームラン)
- 設計元: **[とどけ!リリックホームラン デザイン基本設計](https://claude.ai/artifact/96kYsyYV2rF8xb4UFMaDa5)**(UI・キャラクター・観客・飛距離ウィンドウ・手書き風の作り方・実装との対応表)。
- UI・キャラクター・画面の配置・演出・素材の作り方を変える依頼は、**コードより先にこの Artifact を更新する**(該当の節と、末尾の「変更履歴」)。
  そのあとで、Artifact の内容どおりにコードを直す。食い違いが見つかったら、コードでなく設計を先に直す。
- Artifact は `Artifact` ツールで同じファイルを再公開して更新する(URL は変わらない)。元の HTML が手元に無ければ `action: "read"` で読んで直す。
- 変更の最後に、Artifact を更新したこと(またはその必要がなかったこと)を報告に書く。
- 設計に関係しない修正(バグ・テスト・ビルド番号など)は、この手順を省いてよい。

### 2. イメージ画像は、すべてプログラムで作る。AI 生成の画像は、入力にも使わない
- コンテスト規約は、作品に表示される絵に AI 生成物を使うことを一切認めない(`docs/ai-art-policy.md`)。
- したがって画像は、**このリポジトリのプログラム(`tools/img2vector` やコードの描画)で作る**。Gemini などの画像生成 AI の出力は、完成品にも、**模写の元絵(入力)にも使わない**。
- 元絵にしてよいもの: 自分(人)が描いた絵、コードや JSON のデザインデータで描いた図、正規に許諾を得た絵(作者名をアプリ内に明示)。公式イラストは参考にするだけで、リポジトリには取り込まない。
- 画像を `assets/` に置くときは、出どころを `lyric-homerun/art-src/provenance.json` に書き、`python tools/check_art_provenance.py` が通ること。通らない素材は応募版に入れない。
- 画像を入れる・差し替えるときは、この点を毎回ユーザーに知らせる。

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
- `lyric-homerun/` — 企画「とどけ!リリックホームラン(仮)」(飛んでくる歌詞をミクがネギで打ち返してスタンドへ届ける。打つ=歌う。
  骨子はプーさんのホームランダービー。**MVP**(ストレートのみ・絵はコード描画の仮絵)。`app/` が公開物、`test/` は `node --test`、`docs/DESIGN.md` が設計。
  絵は `app/data/art.json` に画像パスを書くと差し替わる(`app/assets/README.md`)。ビルド番号は `app/index.html` の `LH_BUILD` と `app/src/game.js` の `BUILD`(両方そろえる))
- `tools/img2vector/` — **画像→べた塗りベクター画像(SVG/PNG)に模写する共通ツール**(Python。`README.md` に使い方)。
  グラデーション・フィルターは使わない。元画像の背景透過・縦補正・精度レポート付き。絵の素材づくりはまずこれを使う
- `tools/artgen/` — **デザインデータ(JSON)から、元絵をコードで描く**(AI 不使用)。`build_art.py` が、背景・ミク・MEIKO を「元絵 → 手書き風」まで一括で作る(下書き→案シート→承認→`--install`)。**キャラクターの絵は、デッサンの検査(`proportion_check.py`、根拠は `docs/character-design-basics.md`)に通らないと作らない**
- `tools/check_art_provenance.py` — 素材の出どころ(`lyric-homerun/art-src/provenance.json`)を検査。AI 由来の素材があると失敗する
- `docs/ai-art-policy.md` — AI 生成物の規約(コンテスト)と、クリアする方法の検討メモ。**画像を入れる前に必ず読む**
- `.github/workflows/pages.yml` — miku-twintail の Pages デプロイ(gh-pages・サブディレクトリ配置)
- `.github/workflows/pages-typing-game.yml` — typing-game とランディングの Pages デプロイ
- `.github/workflows/pages-bunyutto-miku.yml` — bunyutto-miku の Pages デプロイ(テスト通過が条件)
- `.github/workflows/pages-lyric-homerun.yml` — lyric-homerun の Pages デプロイ(テスト通過が条件)

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
  リリックホームラン: https://pyororin.github.io/MagicalMirai-games001/lyric-homerun/?v=<ビルド番号> (デモ: `?demo=1&v=<ビルド番号>`)
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
