# X 投稿管理（x-poster）

連携した X アカウントに、スマホの管理画面か Telegram から投稿・予約投稿するサーバーです。
Cloudflare Workers の上で動くので、Mac を閉じていても予約どおりに投稿されます。

- X 公式の API（OAuth 2.0）で投稿します。パスワードは預かりません
- 投稿にはクレジットを使います（X のコンソールで購入）
- 同じ文を複数のアカウントで使うことはできません（30日以内に使った文は断ります）
- 失敗した投稿は自動でやり直しません。Telegram に理由が届きます

## 使い方

### 管理画面

1. 管理画面の住所をスマホで開き、パスワードでログイン
2. アカウントを選び、本文を書く
3. 日時を空欄にすると「すぐ投稿」、日時を入れると「予約」
4. 「投稿する」→ 確認が出るので「OK」

### Telegram

ボットに次のように送ります。どれも「投稿する / やめる」のボタンで確認してから動きます。

| 送る文 | 何が起きるか |
| --- | --- |
| `/post @handle 本文` | すぐ投稿 |
| `/yoyaku @handle 10/8 21:00 本文` | 予約投稿（「明日 9:00」「21:00」も可） |
| `/list` | 予約の一覧 |
| `/cancel 12` | 12番の予約を取り消す |
| `/accounts` | 連携しているアカウント |

### アカウントの連携

1. 管理画面の「連携リンクを作る」を押し、「リンクをコピー」
2. 02View で、連携したいアカウントのパネルのアドレス欄にリンクを貼って開く
3. X の画面で「アプリにアクセスを許可」を押す
4. 「@○○ を連携しました」と出たら完了。アカウントごとに 1〜4 を繰り返す

## 設置（最初の1回）

| 項目 | 置き場所 |
| --- | --- |
| `SECRET_KEY` | Worker の secret（ランダム。トークンの暗号化とログインに使う） |
| `ADMIN_PASSWORD` | Worker の secret（管理画面のパスワード） |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | Worker の secret（console.x.com のアプリの OAuth 2.0） |
| `TELEGRAM_BOT_TOKEN` | Worker の secret（02View とは**別の**新しいボット） |
| `TELEGRAM_CHAT_ID` | `wrangler.toml` の vars（秘密ではない） |
| `PUBLIC_URL` | `wrangler.toml` の vars（この Worker の住所） |

X のアプリ側では、OAuth 2.0 を「Web App（Confidential client）」にして、
Callback URI に `<PUBLIC_URL>/oauth/callback` を登録します。

```bash
npx wrangler d1 create x-poster          # 出てきた database_id を wrangler.toml に
npx wrangler d1 execute x-poster --remote --file schema.sql
npx wrangler secret put ADMIN_PASSWORD   # 以下、それぞれ聞かれた値を貼る
npx wrangler deploy
```

## 開発

```bash
node tests/tools/x-poster.test.js        # D1 の代わりに node:sqlite を使うテスト
npx wrangler dev --local                 # .dev.vars にローカル用の値を置く（コミットしない）
```

Telegram のボットは 02View の DM 連携と分けてください。Webhook を設定したボットは、
02View が使っている受信方法（getUpdates）で読めなくなります。
