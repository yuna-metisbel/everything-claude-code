# 引き継ぎ (SixView / 02View)

最終更新: 2026-10-05 / ブランチ `claude/dazzling-mayer-stwiza` / head `dcb4677`

このファイルは、作業を別のセッション（または別の人）に引き継ぐためのものです。
使い方そのものは [README.md](README.md) を見てください。

---

## 1. いま何ができているか

`tools/six-view/` は、1つのウィンドウに複数のブラウザ画面（パネル）を並べる Electron アプリです。
**同じソースから2つのアプリ**を作ります。

| アプリ | 中身 | 作るコマンド | 出力先 |
|--------|------|--------------|--------|
| SixView | 業務6サイト (Venry / えすたま / えきちか / エステランキング / ふーぺ / CTI) | `npm run dist:mac` | `dist/` |
| 02View | 02 店舗 + キャスト1-7 + X の9パネル | `npm run dist:mac:02` | `dist-02/` |

実装済みの機能:

- パネルごとに独立したログイン状態（`persist:sixview-<id>`）。同じサイトに別アカウントで同時ログインできる
- ID / パスワードの自動入力（OS キーチェーンで暗号化保存）。2段階ログイン（X など）にも対応
- パネルの追加・複製・閉じる・別サイトに割り当て
- DM を Telegram に通知し、Telegram の返信をそのお客様に送り返す（DM ブリッジ）
- ブーストのボタンを自動で押す
- **「自動でさがす」** — DM の行とブーストのボタンを、クリック指定なしで自動検出
- 上のタブで全パネルを一斉に別サイトへ切り替え（X を9アカウント並べる用）
- **X アカウントの状態チェック・投稿分析・グループとメモ**（最新の変更）。`src/x-service.js` と
  `src/lib/x-scripts.js`。パネルのセッションで見えない BrowserWindow を1つずつ開き、読むだけのスクリプトで
  状態（ok / logged-out / locked / suspended / unknown）と自分の投稿を取る。auth_token Cookie が無ければ
  ページを開かずにログアウト扱い。unknown は通知しない（`known` に最後の確定状態を持つ）
- タブごとのログイン ID。パネル x タブごとに金庫の別スロット `<パネルID>@<タブID>` に保存し、
  そのタブのサイトにだけ入力する。設定画面の「保存して反映」は、入力済みで未保存の ID もまとめて保存する

### 状態

- PR: [#2](https://github.com/yuna-metisbel/everything-claude-code/pull/2) — **オープン / ドラフト**。base は `main`
- このリポジトリに **CI は設定されていません**。PR の status が `pending / total_count: 0` なのは
  「チェックが1つもない」という意味で、失敗ではありません。直すものはありません
- ユニットテスト: `node tests/tools/six-view.test.js` → **91 passed, 0 failed**
- 全体テスト: `node tests/run-all.js` → 1946件中 **3件失敗**。これは既存の失敗で、six-view とは無関係です
  （`hooks/hooks.test.js`、`lib/session-aliases.test.js`、`lib/session-manager.test.js`。
  root で動かすとファイル権限のテストが成立しないため）
- PR の自動チェックインを1時間ごとに仕掛けてあります（`send_later`）。
  変化がなければ静かに次を再設定するだけです

---

## 2. 次にやること

### 優奈さん側（人がやる必要があること）

1. **Mac で作り直す。** 最新の変更（タブ）はまだ Mac に入っていません

   ```
   cd "$HOME/Desktop/04_開発プロジェクト/sixview" && git pull && cd tools/six-view && npm run dist:mac:02 && cp dist-02/02View-1.0.0-arm64.dmg "$HOME/Desktop/" && open "$HOME/Desktop"
   ```

2. **「自動でさがす」を試す（未報告）。** キャスト1のパネルで、DM とブーストの検出が
   実際の 02 の画面で動くか。**埋まらなかった欄があれば、どの欄かを報告してください。**
   実際の 02 の HTML はこのセッションから見られないので（下の「制約」）、1回は調整が必要な想定です

3. **X のタブを試す（未報告）。** 上の「X」を押して、パネルごとに別アカウントの X に
   手でログインできるか

4. **Telegram のボットトークンを作り直す。** 以前チャットにトークンを貼ってしまっているので、
   漏れた前提で扱う必要があります。`@BotFather` で `/revoke` して新しいトークンを発行し、
   アプリの設定画面に入れ直してください。**新しいトークンはチャットに貼らないこと**

5. **SixView（業務6サイト）はまだ Mac に入っていません。** 必要なら `npm run dist:mac`

### 知人の Mac への配布（途中）

`.dmg` の AirDrop と Gatekeeper の解除までは完了。**その先は結果が未報告です。**

残っているのは `config.json`（パネル構成・DM・ブーストの設定）の移行で、
知人の Mac の Claude Code に指示文を渡したところまで進んでいます。

- **パスワードとログイン状態は移行できません**（仕様）。`credentials.json` は OS キーチェーンで
  暗号化されていて、作った Mac でしか復号できないため。知人の Mac で入れ直しになります
- 知人の Mac では **DM 監視とブースト自動押しのチェックを外すこと**。
  同じボット・同じアカウントを2台で動かすと取り合いになります

手順（自分の Mac で取り出す → AirDrop → 知人の Mac で置く）:

```
# 自分の Mac
cp "$HOME/Library/Application Support/02View/config.json" "$HOME/Desktop/" && open "$HOME/Desktop"

# 知人の Mac（AirDrop で受け取ったあと）
mkdir -p "$HOME/Library/Application Support/02View" && cp "$HOME/Downloads/config.json" "$HOME/Library/Application Support/02View/config.json" && echo "OK 入りました"

# 「壊れています」と出たとき（署名していないアプリに付く検疫の印を外す）
xattr -dr com.apple.quarantine "/Applications/02View.app"
```

---

## 3. この先の作業で踏んではいけない前提

コードを触る人向け。どれも実際に踏んで直した結果です。

1. **ページ遷移はスクリプトの実行環境を壊す。** クリックすると、そのページで走っている
   JavaScript は途中で死にます。なので **読み取りとクリックは別のパスに分ける**こと。
   クリックするスクリプトは必ずクリックで終わり、結果は「もう一度読んで」確認します。
   `context-lost` は失敗ではなく「押せた」と数えます。共通処理は `src/lib/page-runner.js`

2. **認証情報をレンダラーに渡さない。** パスワードはメインプロセスで読み、
   `contents.executeJavaScript` でページに直接入れます。preload の橋にも載せません

3. **検出は読むだけ。** `dm-detect-script.js` と `boost-script.js` の検出部分は、
   ログイン済みの実アカウントに対して走ります。誤クリックはお客様への誤送信や
   ブーストの消費になるので、`.click(` `.submit(` `dispatchEvent` `location.href =` `setValue(`
   を含まないことを**テストで強制**しています（「detection only ever reads the page」）

4. **パネルのパスワードは、そのパネル自身のサイトにしか入れない。** 「ログイン画面の住所」が
   空欄のときは、パネル自身のホストが条件になります（`autofill.js` の `sameSiteAsHome`）。
   タブで別サイトに切り替えても、そこのログイン欄には入力しません。ここを緩めると
   02 のパスワードが X に入ります

5. **タブごとのログインは別スロット。** ホーム以外のタブでは `loginForTab()`（`autofill.js`）が
   `<パネルID>@<タブID>` のスロットとタブのページのホストを使う。パネル自身の 02 のログインには
   フォールバックしない。パネル自身のセレクタも使わない（形で探す）

6. **タブを離れている間は DM 監視とブーストを止める。** `automationPaused(config)` が真のとき、
   両サービスは監視対象を空にします。DM のベースラインも一緒に捨てるので、
   戻ったときは「溜まっていた分を全部新着として通知する」のではなく、もう一度基準を取り直します

7. **生成するスクリプトの中では `\d` を `\\d` と書く。** テンプレートリテラルで組むため。
   バックティックと `${` は生成コードの中で使わないこと

8. **実サイトはこのセッションから見えません。** egress ポリシーがすべての業務サイトに 403 を返します。
   なので検証は **Xvfb + 実 Electron + ローカルのスタンドインサーバー**で行います。
   これは回避すべきものではなく、そういう環境だという前提です

---

## 4. ファイルの地図

```
tools/six-view/
  src/main.js                    メインプロセス。IPC、パネルのセッション、自動ログイン
  src/preload.js                 レンダラーへの唯一の橋（パスワードは通らない）
  src/dm-service.js              DM 監視の実行時処理
  src/boost-service.js           ブースト押しの実行時処理
  src/x-service.js               X アカウントの状態チェックと投稿分析（見えないウィンドウ）
  src/lib/
    config-schema.js             設定の正規化。タブ(pageSets)もここ。Electron 非依存＝単体テスト可
    config-store.js              config.json の読み書き（tmp + rename で原子的に）
    secret-store.js              認証情報の金庫（safeStorage）
    autofill.js                  自動ログインのスクリプト生成と発火条件
    dm-script.js / dm-detect-script.js    DM の操作と自動検出
    boost-script.js              ブーストの読み取り・押す・自動検出
    page-runner.js               遷移で壊れた実行環境を「結果」として扱う共通処理
    x-scripts.js                 X の状態判定と投稿の読み取り（読むだけ）
    telegram.js / dm-bridge.js   Telegram クライアントと返信の経路表
  src/renderer/
    index.html / app.js / app.css            メインウィンドウ（グリッドとタブ）
    settings.html / settings.js / settings.css  設定ウィンドウ
    analytics.html / analytics.js / analytics.css  投稿分析ウィンドウ
  README.md                      使い方（日本語・非開発者向け）
tests/tools/six-view.test.js     ユニットテスト 91件
```

---

## 5. テストと検証のやり方

```bash
# ユニットテスト（速い。これは必ず通してからコミット）
node tests/tools/six-view.test.js

# 全体（2分以上かかる。既存の3件失敗は無視してよい）
node tests/run-all.js

# CI ゲート
node scripts/ci/check-unicode-safety.js      # .md に絵文字を入れると落ちる
npx eslint tools/six-view/src tests/tools/six-view.test.js
npx markdownlint-cli 'tools/six-view/README.md'
```

### 実アプリでの検証

ユニットテストでは「遷移でスクリプトが死ぬ」挙動を再現できないので、
**実際の Electron を Xvfb で起動して、ローカルサーバーを実サイトの代わりにする**方法を使っています。

```bash
cd tools/six-view
xvfb-run -a npx electron --no-sandbox <ハーネスのパス>
```

ハーネスは**スクラッチパッドにあり、リポジトリにはコミットされていません**
（`/tmp/claude-0/.../scratchpad/`）。コンテナが片付けられると消えるので、
必要になったら書き直す前提です。これまで作ったもの:

| ハーネス | 何を確かめるか | 結果 |
|----------|----------------|------|
| `x-ui-harness.js` | 状態バー・赤い印・グループ絞り込み・分析ウィンドウ・設定の保存 | 16/16 |
| `pages-harness.js` | タブ切り替え。3パネルが3つの別 X ログインになること | 16/16 |
| `pagesets-settings-harness.js` | 設定画面でタブの追加・改名・削除が保存されること | 12/12 |
| `detect-harness.js` | 「自動でさがす」が別の書き方の2つの画面で動くこと | 31/31 |
| `settings-harness.js` | 12パネルの設定画面が崩れないこと | 12/12 |
| `boost-harness.js` | クールダウン中のボタンを押さないこと | 20/20 |
| `dm-harness.js` | DM の読み取りと、正しい会話への返信 | 17/17 |
| `autofill-harness.js` | 2段階ログインを含む自動入力 | 15/15 |

書き方の型（`pages-harness.js` が一番新しい）:

1. ローカルの `http.createServer` で実サイトの代わりのページを出す
2. `require('.../src/main.js')` のあとに `app.setPath('userData', 一時ディレクトリ)`
   （`main.js` は require 時に `app.setName` を呼ぶので、順番が逆だと実際の設定を壊します）
3. そのディレクトリに `config.json` を書いてから `app.whenReady()`
4. `win.webContents.executeJavaScript(...)` で人と同じ操作をして、画面の状態を読む

---

## 6. 守っている約束

- コミットは Conventional Commits（`feat:` `fix:` `docs:` ...）
- CommonJS のみ。TypeScript なし。ファイル名は小文字ハイフン
- テストの出力は `Results: Passed: N, Failed: N` の形
- `.md` に絵文字を入れない（CI が落ちます）
- 優奈さんへの説明は**日本語で、そのままコピペできる形**で。セレクタや JSON を手で書かせない
- プッシュ先は `claude/dazzling-mayer-stwiza` 固定。他のブランチに押さない
