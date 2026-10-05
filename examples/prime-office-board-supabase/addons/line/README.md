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

LINE への送信は、既存の Edge Function `push` が Web Push と一緒に行う。
`LINE_MESSAGING_TOKEN` が無いボード（PRIME）では何もしない。

## 入れ方

1. `migrations/` の35本を流す（SETUP.md の手順2）
2. `01_line_login_reminders.sql` を流す
3. Edge Function `push`（新しい版）と `line-login` を置く。`verify_jwt` は有効のまま
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

7. LINE Developers の LINE ログイン チャネルで
   - 「LINEログイン設定」→ **コールバックURL** にボードの URL（末尾の `/` まで同じに）
   - 「チャネル基本設定」→ **リンクされたLINE公式アカウント** に通知用の公式アカウント
     （これが無いと、ログイン時の友だち追加の案内が出ない）
   - 家族が使う前に、チャネルを **公開** にする（開発中は管理者とテスターしか入れない）
8. `init-new-company.sql` で招待コード方式にする（最初の1人はコードなしで入れる）
9. 画面の `config.js` に `lineLogin`・`lineOaId`・`editableBrand: true`・`reminders: true`
   （例：`../../../prime-office-board-web/config.fujisawa.js`）

## 気をつけること

- **LINE 公式アカウントの無料枠は月200通。** 1人に1通が1と数える。超えるとその月は
  送れなくなる（勝手に課金はされない）。全員宛ては会議の30分前と、お知らせの登録だけ
- LINE のログインは、LINE アプリ内のブラウザではなく Safari や Chrome で開いた方が確実
- LINE で入った人の認証ユーザーは `line-<LINEの利用者ID>@line.board.invalid` という
  宛先で作る。メールは一度も送らない
