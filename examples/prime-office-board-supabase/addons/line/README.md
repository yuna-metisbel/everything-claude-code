# 追加機能：LINE ログイン・LINE 通知・リマインダー

メールの代わりに LINE で入り、予定やリマインダーを LINE に届けるための追加分。
最初の導入先は藤澤家のボード（Supabase `gsuzsdoinoowiuuxomue`）。
PRIME の本番には入れていない。

## 何が増えるか

| 機能 | どこで動くか |
|------|-------------|
| LINE でログイン（メールの画面は出さない） | Edge Function `line-login` |
| ボードの名前を「設定」から変える | `board_settings.brand` / `brand_sub` |
| リマインダー（時刻指定、自分か選んだ人へ） | `reminders` 表と毎分の `family_tick()` |
| 予定が更新されたら本人以外へ | `schedule` のトリガ。同じ人・同じ日は1時間に1通 |
| やることの担当になったら本人へ | `tasks` のトリガ |
| 朝8時のまとめ（その人の期限・支払い、今日明日の会議） | `family_morning()`。何も無い人には送らない |
| 予定・会議の30分前 | `family_tick()`。開始時刻が読めるものだけ |
| 種類ごとに「受け取らない」 | 「設定」→ LINE の通知 |
| 色（春・夏・秋・冬）。ボードの色と、端末ごとの上書き | `02_board_customize.sql` の `board_settings.ui` |
| タブの名前・使う／使わない、その日の動きの名前、「〇〇 あいてます」の〇〇 | 同上 |
| 情報タブ（元の店舗）の分類を自由に増やす | 同上。`shops.kind` の制限を外す |
| 自由な一覧（買い物リストなど） | `lists` / `list_items` |
| 公式アカウントのトークに送られた要望・感想を残す | `03_line_feedback.sql` と Edge Function `line-webhook` |
| メールと LINE の**両方**から入れる（本部メンバー） | `config.js` の `lineLoginOptional`。メールで登録した人は「設定」→ LINE の通知 →「LINE を連携する」 |
| スタッフの契約書（リンクだけ） | `04_staff_contracts.sql`。`config.js` の `contracts` |
| やることの進捗を割合で出す | `config.js` の `taskProgress`（DB の変更なし） |
| 自社ボードから、関わっている会社のボードを開く | `config.js` の `clients`（DB の変更なし） |

LINE への送信は、既存の Edge Function `push` が Web Push と一緒に行う。
`LINE_MESSAGING_TOKEN` が無いボード（PRIME）では何もしない。

## 入れ方

1. `migrations/` の35本を流す（SETUP.md の手順2）
2. `01_line_login_reminders.sql`、`02_board_customize.sql`、`03_line_feedback.sql` を順に流す
   （契約書も使うなら続けて `04_staff_contracts.sql`）
3. Edge Function `push`（新しい版）と `line-login` を置く。`verify_jwt` は有効のまま。
   `line-webhook` は **`verify_jwt` を外して**置く（LINE からの呼び出しには JWT が無い。
   代わりに中で署名を確かめる）
4. `push_config` に `function_url` と `anon_key`（SETUP.md の手順4）
5. 公開してよい LINE の設定を入れる

   ```sql
   update public.line_config
      set login_channel_id = '<LINE ログインのチャネル ID>',
          oa_basic_id      = '<公式アカウントの ID（@から）>',
          board_url        = '<ボードの URL>'
    where id = 1;
   ```

6. 秘密は **Supabase のダッシュボード → Edge Functions → Secrets** に、本人が入れる
   （会話やリポジトリには書かない）

   | 名前 | 値 |
   |------|----|
   | `LINE_LOGIN_CHANNEL_SECRET` | LINE ログイン チャネルの「チャネルシークレット」 |
   | `LINE_MESSAGING_TOKEN` | Messaging API チャネルの「チャネルアクセストークン（長期）」 |
   | `LINE_MESSAGING_SECRET` | Messaging API チャネルの「チャネルシークレット」（要望・感想の受け口が使う） |

7. LINE Developers の LINE ログイン チャネルで
   - 「LINEログイン設定」→ **コールバックURL** にボードの URL（末尾の `/` まで同じに）
   - 「チャネル基本設定」→ **リンクされたLINE公式アカウント** に通知用の公式アカウント
     （これが無いと、ログイン時の友だち追加の案内が出ない）
   - 家族が使う前に、チャネルを **公開** にする（開発中は管理者とテスターしか入れない）

   Messaging API チャネルで
   - 「Messaging API設定」→ **Webhook URL** に
     `https://<プロジェクトID>.supabase.co/functions/v1/line-webhook`、**Webhookの利用** をオン
   - LINE Official Account Manager の「応答設定」で **応答メッセージ** をオフ
     （オンのままだと、こちらの返事と自動の返事が二重に出る）
8. `init-new-company.sql` で招待コード方式にする（最初の1人はコードなしで入れる）
9. 画面は Render の Build Command を
   `sh examples/prime-office-board-web/build-site.sh <名前>` にする
   （`config.<名前>.js` を `config.js` にし、URL を共有したときの題名とホーム画面の名前を書き換える）。
   その `config.<名前>.js` に `lineLogin`・`lineOaId`・`editableBrand: true`・`reminders: true`
   （例：`../../../prime-office-board-web/config.fujisawa.js`）

   足せる設定：

   | 設定 | 何が変わるか |
   |------|-------------|
   | `lineLoginOptional: true` | `lineLogin` と一緒に入れると、メールと LINE の**両方**を1枚のログイン画面に出す。入れないと今までどおり LINE だけ（藤澤家） |
   | `contracts: true` | 名簿に「契約書」の列と、スタッフ自身の画面に自分の契約書が出る（`04` が要る） |
   | `taskProgress: true` | やることの一覧とホームに「10件中6件完了（60%）」を出す |
   | `season: "spring"｜"summer"｜"autumn"｜"winter"` | 盤の色の**既定**。白地＋ピンク／緑／金茶／青。ボードの「設定 → 色」で選べばそちらが勝つので、渡したあと先方が自由に変えられる。入れなければ今までどおり秋（金茶） |
   | `themeColor: "#FFFFFF"` | ホーム画面から開いたときの下地の色（manifest の background/theme）。`season` を白地のものにしたら、これも白にする |
   | `memos: true` | ホームに「メモ」の欄が出る（全員で使う覚え書き。日付も通知も無い）。お知らせと同じ `notices` 表に `kind='memo'` で入れるので、**`migrations/20261120090000_memos.sql` を流したボードだけ**。流していないと保存のときに弾かれる |
   | `passwordReset: true` | ログイン画面に「パスワードを忘れた」が出る。決め直すリンクをメールで送るので、**メールが実際に届くボードだけ**入れる（下の「パスワードを忘れた を出す前に」）。入れなければ入り口が出ない |
   | `clients: [{ name, url, note }]` | ホームの右側に「関わっている会社のボード」が出て、別のボードを新しいタブで開ける。`clientsTitle` で見出しを変えられる。**片方向**：入れたボードからは開けるが、相手のボードはこの設定を持たないので、相手からこちらへは入れない。`http`/`https` 以外の URL は捨てる |

   `lineLogin` を空のままにしておくと、LINE のボタンは出ず、メールとパスワードだけで
   入れる。チャネルを作ってから入れればよい（例：`config.shirospa.js`）。

### 「パスワードを忘れた」を出す前に

`passwordReset: true` の前に、Supabase 側（Authentication → URL Configuration）で2つ。

- **Site URL** をそのボードの URL にする（既定は `http://localhost:3000`。
  そのままだと、メールのリンクが localhost に飛んで戻ってこない）。
- **Redirect URLs** に同じ URL を足す（`/` 付きも入れておく）。

そのうえで、**メールが届くかどうかが本当の関門**。Supabase に付いている
メール送信は**本番向けではなく、1時間に2通まで**。
公式の説明では「その Supabase 組織のメンバーのアドレスにしか送らない」と
書かれているが、**リーブルゲートのボードでは、組織のメンバーではない
`director.y@libre-gate.co.jp` にも実際に届いた**（2026-11-15 に確認）。
つまり届くこともあるが、保証はされていない。スタッフを増やすなら、
下の 1 をやっておく。

確実に届くようにする方法は2つ。

1. **独自 SMTP を入れる**（Authentication → SMTP Settings）。Google Workspace の
   アプリパスワード、Resend、SendGrid など。これが本来の形。
2. そのアドレスを **Supabase 組織のメンバーに加える**。無料でその場で済むが、
   そのアドレスから Supabase の管理画面に入れてしまうので、自分のものだけに留める。

どちらもしていないボードでは、まず**自分のアドレスで1通試してから**
`passwordReset` を入れる。届かないまま入れると、押しても何も来ない
入り口ができてしまう。

## 気をつけること

- **LINE 公式アカウントの無料枠は月200通。** 1人に1通が1と数える。超えるとその月は
  送れなくなる（勝手に課金はされない）。全員宛ては会議の30分前と、お知らせの登録だけ
- LINE のログインは、LINE アプリ内のブラウザではなく Safari や Chrome で開いた方が確実
- **メールと LINE の両方を開けたボードでは、同じ人が2つのアカウントを持ちうる。**
  メールで登録した人が、連携せずに LINE から入ると別のアカウントになる。
  ログイン画面と「設定」の両方にその旨を出してあるが、仕組みで止めてはいない
  （LINE 側の利用者 ID とメールアドレスを突き合わせる手段が無いため）
- LINE で入った人の認証ユーザーは `line-<LINEの利用者ID>@line.board.invalid` という
  宛先で作る。メールは一度も送らない
