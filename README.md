# MagicalMirai-games001

マジカルミライ プログラミング・コンテスト応募に向けた企画のワークスペース。
複数の案をディレクトリ単位で並行検討する。

## 公開ページ(GitHub Pages)

| ページ | URL |
|---|---|
| ランディング(案一覧) | https://pyororin.github.io/MagicalMirai-games001/ |
| 案1 実楽曲版(TextAlive 接続) | https://pyororin.github.io/MagicalMirai-games001/typing-game/prototype/textalive.html |
| 案1 合成音版(オフライン動作) | https://pyororin.github.io/MagicalMirai-games001/typing-game/prototype/demo.html |

ブランチへの push で `.github/workflows/pages.yml` が `gh-pages` ブランチへ自動デプロイする。
反映には CDN キャッシュで最大10分程度かかる。ページ上部のビルド番号で版を確認できる。

## 案一覧

| ディレクトリ | 案 | 状態 |
|---|---|---|
| [`typing-game/`](./typing-game/) | 案1:リズムタイピングゲーム「歌詞を、メロディに乗せて打つ」 | 設計・市場調査・コアエンジン実装・実楽曲(ロンリーラン)での成立性検証まで完了 |

### 案1 の概要

- **コンセプト**: 楽曲同期の判定を持つリズムゲーム。入力方式がタイピング(PC=ローマ字 / スマホ=1タッチゾーン式フリック)
- **核心設計**: 判定単位を「打鍵」ではなく「かな確定」に置き、ローマ字の複数打鍵問題を解消。表記ゆれ全受理・先行入力・難易度別密度制御・リハーサルモードの3段構えで「等速で全打鍵は不可能」問題に対処
- **ドキュメント**: [設計書](./typing-game/docs/DESIGN.md) / [市場調査](./typing-game/docs/MARKET_RESEARCH.md) / [プロトタイプ README(実データ検証結果)](./typing-game/prototype/README.md)

## ナレッジベース

**[docs/ONTOLOGY.md](./docs/ONTOLOGY.md)** — TextAlive App API・Songle・GitHub Pages で実際に躓いた点を
「エンティティ → 関係 → 落とし穴カタログ(症状→原因→解決→教訓)」の形で集約している。
**新しい案・別セッション・別アプリの着手時は最初にこれを読むこと。**
特に P1(Card data resolver)と P4(api.songle.jp)は再発しやすい。

## リポジトリ構成

```
docs/            リポジトリ横断のナレッジ(ONTOLOGY.md)
<案名>/
  docs/          企画・設計ドキュメント
  prototype/     検証用プロトタイプ(src/ にテスト付きのコア実装)
index.html       Pages のランディングページ
.github/         Pages 自動デプロイ
```

新しい案を追加するときは、リポジトリ直下に案ごとのディレクトリを作り、この README の案一覧と `index.html` に行を足す。

## 開発メモ

- プロトタイプのテスト: `cd typing-game/prototype && npm install && npm test`
- TextAlive のアプリトークンはクライアント埋め込み前提の公開値(詳細は ONTOLOGY §1)
- コンテストは年度制。課題曲は毎年変わるため、演出は楽曲メタデータ(V/A・サビ・ビート)に追従させる設計を維持する(ONTOLOGY P9)
