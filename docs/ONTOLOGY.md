# API 知見オントロジー

本リポジトリでの開発を通じて得た、外部 API・インフラの構造知識と躓きの記録。
**次回のコンテスト応募・別アプリ・別セッションでの再利用を目的とする。**
形式:エンティティ(何があるか)→ 関係(どう繋がるか)→ 落とし穴カタログ(症状 → 原因 → 解決 → 教訓)。

最終更新: 2026-08-30(検証楽曲: ロンリーラン / 海風太陽、クライアント: textalive-app-api v0.5.2)

---

## 1. エンティティ:ホストと役割

TextAlive 系は **4ホスト構成**。1つでも欠けると初期化が途中で止まる。

| ホスト | 役割 | 備考 |
|---|---|---|
| `api.textalive.jp` | アプリトークン検証(`GET /` の応答内 `app.error`)、楽曲解決(`/cards/resolve`)、カードデータ(`/cards/{id}`)、歌詞ライセンス(`/etc/license`)、動画定義 | Express。CORS は任意 Origin を反射(`access-control-allow-credentials: true`) |
| `songle.jp` | 楽曲情報(`/songs/{path}?format=json`)、歌詞タイミング(`/songs/{code}/lyrics/{id}...`)、歌詞パーサ(`/lyric_parsers/*.js`)、声量・V/A | `{path}` は `piapro.jp%2Ft%2F...` のような URL エンコード形式 |
| `api.songle.jp` | **Songle Widget 本体(`/v2/api.js`)、音楽地図(ビート・コード)** | `songle.jp` とは別ホスト。忘れると初期化がサイレントに停止する(§3-P4) |
| `content.textalive.jp` | アセット類 | |
| 楽曲配信元(`piapro.jp` / YouTube / niconico) | 音源 | 再生には必要。データ取得だけなら不要 |

### トークン
- ヘッダ名は **`x-ta-app-token`**(`x-textalive-app-token` ではない)
- トークンは**クライアント埋め込み前提の公開値**。全応募作品が公開 JS に含める方式。リポジトリにコミットしてよい
- 有効性は `GET https://api.textalive.jp/` の応答 `app.data.name` / `app.error` で確認できる(curl で事前検証可能)

### ライセンス上の義務
- アプリ内に「TextAlive App API 利用」の明示 + https://developer.textalive.jp/ へのリンク必須
- 非商用は連絡不要、商用は事前相談(textalive-ml@aist.go.jp)
- Songle API の利用規約にも同意したことになる

---

## 2. 関係:初期化シーケンス

```
Player 生成(token)
  → GET api.textalive.jp/           …… トークン検証。app.error 有りだと console.warn のみ出して
                                        「劣化モード」で続行し、後段が別のエラーで死ぬ(§3-P5)
createFromSongUrl(url)
  → GET api.textalive.jp/cards/resolve?url=…   …… §3-P1 の躓きポイント
  → GET api.textalive.jp/etc/license?url=…
  → songle.jp/lyric_parsers/*.js
  → api.songle.jp/v2/api.js(Songle Widget)
  → songle.jp の楽曲情報・歌詞タイミング
  → onVideoReady(歌詞データ確定)→ onTimerReady(音源準備完了)
```

---

## 3. 落とし穴カタログ

### P1【最重要】`Card data resolver is unavailable`
- **症状**: `createFromSongUrl` が即座に `Error: Card data resolver is unavailable` で失敗。トークンも CORS も正常なのに起きる
- **原因**: クライアント v0.5.2 は `/cards/resolve` に **200 JSON** を期待するが、サーバーは **302 リダイレクト**を返す(サーバー側の挙動変更にクライアント最新版が未追従)。ライブラリは `fetch(…, {redirect:"manual"})` で呼ぶため 302 は `opaqueredirect`(status 0)になり、`status!==200` → `{status:"unavailable"}` → この例外になる
- **解決**: 失敗時に自前でリダイレクトを追従するフォールバック:
  ```js
  player.createFromSongUrl(url, opts).catch(function(e){
    if (String(e).indexOf("Card data resolver") < 0) throw e;
    return fetch("https://api.textalive.jp/cards/resolve?url=" + encodeURIComponent(url),
                 { redirect: "follow", headers: { "x-ta-app-token": APP_TOKEN } })
      .then(function(r){
        if (!r.ok || !r.url) throw e;
        return player.createFromCardUrl(r.url, opts);   // 例: api.textalive.jp/cards/{id}
      });
  });
  ```
- **重要な副知識**: resolve のリダイレクト先は**トークンヘッダの有無で変わる**。ヘッダ有り → 相対 `/cards/{id}`(= api ホストの JSON、CORS 有り、200)。ヘッダ無し → 絶対 `https://textalive.jp/cards/{id}`(人間向けページ)。フォールバックには必ずトークンを付けること
- **教訓**: 「resolver unavailable」はネットワーク断・トークン不正・CORS のどれでもない。ステータスコードの期待値ミスマッチ

### P2 エラーメッセージが原因を語らない
- **症状**: 上記 P1 も、ネットワーク断も、トークン不正も、表面上は似たエラーになる
- **解決**: fetch / axios をラップして**失敗した通信(URL と HTTP ステータス)をエラー画面に表示する診断**を最初から仕込む。今回の原因特定はこの診断が決め手だった
  - 注意: `redirect:"manual"` の応答は正常でも status 0 に見える。「HTTP 0」を即異常と判断しない
- **教訓**: 外部 API 統合ページには診断表示を標準装備する

### P3 CDN(unpkg)読み込みは変数が多い
- **症状**: 環境によってライブラリ読み込み自体が失敗(コンテンツブロッカー、モバイル回線、CDN 障害、バージョン未固定)
- **解決**: 検証済みバージョンを `vendor/` に同梱し**同一オリジン配信**。axios も同様(TextAlive の UMD 版は axios のグローバルが前提)
- **教訓**: 公式 README の `https://unpkg.com/textalive-app-api/dist/index.js`(バージョン未固定)をそのまま本番に使わない

### P4 `api.songle.jp` を忘れると無言で止まる
- **症状**: 歌詞パーサ取得(songle.jp)までは成功するのに、onVideoReady が来ないまま LOADING で停止。エラーなし
- **原因**: Songle Widget(`api.songle.jp/v2/api.js`)とビート等の音楽地図が別ホスト `api.songle.jp` にある。プロキシ許可リスト等で `songle.jp` だけ許可して api. を忘れがち
- **教訓**: 許可リスト・CSP には §1 の4ホスト+音源ホストをセットで登録する

### P5 トークン不正は「警告して劣化続行」
- **症状**: トークンが無効でも例外は出ず、console.warn(「トークンが正しく指定されていないため動作しません」)だけ出して続行し、後段で無関係に見えるエラーになる
- **教訓**: 初期化直後に console を確認する。curl での事前検証(§1 トークン)も有効

### P6 歌詞の「読み」は提供されない
- **事実**: TextAlive の文字単位データ(`char.text`)は表示文字であり、漢字の読み(かな)は API から取れない。実測(ロンリーラン)では表示386文字中かなは284文字(74%)
- **対応**: タイピング等で読みが必要なら、形態素解析による事前生成が必要。カタカナは `charCode - 0x60` でひらがなへ正規化できる。拗音(きゃ等)は前後の文字を結合して1音節にする
- **副産物**: かな間隔は最小51msまで詰まる。タイミング判定を作る場合、隣接ノートと判定窓が重ならないよう動的クランプが必須

### P7 GitHub Pages は自動有効化されない & Actions からも作れない
- **症状①**: `actions/configure-pages@v5` の `enablement: true` が `Resource not accessible by integration` で失敗(GITHUB_TOKEN には Pages サイト新規作成の権限がない)
- **症状②**: `gh-pages` ブランチを push しても、かつてのような自動有効化は**もう起きない**
- **解決**: 配信物を `gh-pages` ブランチに置き(peaceiris/actions-gh-pages@v4、`permissions: contents: write` で動く)、**Settings → Pages → Source: Deploy from a branch → gh-pages を人間が1回だけ設定**する。以後は push で自動反映
- **付随**: Jekyll を無効にする `.nojekyll` を配信ルートに置く

### P8 Pages のキャッシュで旧版を踏む
- **症状**: デプロイ後も旧バージョンのページが表示され、修正が「効いていない」ように見える。別ブラウザ/別セッションでは新版が動くため混乱する
- **原因**: Pages の CDN キャッシュ(最大10分程度)+ ブラウザキャッシュ
- **解決**: ページに**ビルド番号を表示**しておき、どの版が動いているか一目で判別できるようにする。ユーザーへの案内はスーパーリロード / プライベートウィンドウ / `?v=N` 付き URL
- **教訓**: 「直したのに直らない」の第一容疑者はキャッシュ。ビルド番号表示は最初から入れる

### P9 (コンテスト調査の副知識)
- マジカルミライ プロコンの課題曲は毎年の楽曲コンテスト受賞曲(新曲)。作品の演出を特定年代・特定曲に固定で作り込むと年度替わりで破綻する。**楽曲メタデータ(V/A・サビ検出・ビート)に追従する設計**にしておく
- 公式サンプル(TextAliveJp/textalive-app-basic 等)には課題曲の**音楽地図訂正 ID**(beatId / chordId / repetitiveSegmentId / lyricId / lyricDiffId)が載っており、これを `createFromSongUrl` の `video` オプションに渡すと訂正済みタイミングで再生できる

---

## 4. 検証に使える最小コマンド集

```sh
# トークン有効性(app.data.name が返れば有効)
curl -s -H "x-ta-app-token: $TOKEN" https://api.textalive.jp/ | jq .app

# 楽曲情報
curl -s "https://songle.jp/songs/piapro.jp%2Ft%2FCyPO%2F20250128183915?format=json" | jq .song.name

# resolve の挙動確認(302 が返る現況の確認)
curl -si -H "x-ta-app-token: $TOKEN" \
  "https://api.textalive.jp/cards/resolve?url=https%3A%2F%2Fpiapro.jp%2Ft%2FCyPO%2F20250128183915" | head -5

# CORS プリフライト
curl -si -X OPTIONS -H "Origin: https://<app-origin>" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-ta-app-token" https://api.textalive.jp/ | head -8
```

## 5. 実装済みの参照コード

| 知見 | 実装箇所 |
|---|---|
| P1 フォールバック / P2 診断 / P8 ビルド番号 | `typing-game/prototype/textalive.html` |
| P3 vendor 同梱 | `typing-game/prototype/vendor/` |
| P6 かな正規化・拗音結合・判定窓クランプ | `typing-game/prototype/src/romaji.ts`, `judge.ts` |
| P7 Pages デプロイ | `.github/workflows/pages.yml` |
