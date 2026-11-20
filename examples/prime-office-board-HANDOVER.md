# 事務所ボード 引き継ぎ

開発を引き継ぐ人・エージェント向け。導入先の会社に渡す書類ではない
（そちらは `prime-office-board-supabase/` の SETUP / PRIVACY / TERMS /
BACKUP / SUPPORT / COMMERCE）。

最終更新：2026-10-03

---

## 1. 何を作っているか

メンズエステプライムグループの事務所用の共有ボード。予定・やること・支払い・
媒体の ID とパス・店舗の求人票・勤怠・鍵の開け閉めを1か所で見るためのもの。
**いま実際に毎日使われている。**

これを汎用化して、同じ業種の他社にも渡せるようにしている途中。方針は
ユーザーが選んで確定済み。

- 業種は変えない（語彙もそのまま）
- **会社ごとに Supabase プロジェクトを分ける**（テナント列は作らない）
- まず1〜2社に無料で使ってもらう（課金の仕組みはまだ作らない）

## 2. どこに何があるか

| 場所 | 中身 |
|------|------|
| `prime-office-board-web/` | 画面。ビルド不要の静的サイト。これが本番 |
| `prime-office-board-supabase/` | サーバー側。マイグレーション35本、Edge Function 2つ、渡す書類 |
| `prime-office-board/` | Claude Artifact 版。初期の作り。**いまは使っていない** |

リポジトリ `yuna-metisbel/everything-claude-code`
ブランチ **`claude/mens-esthe-schedule-task-payment-1dqk05`**
PR [#1](https://github.com/yuna-metisbel/everything-claude-code/pull/1)（draft、本文5万字超）

## 3. 動いているもの

**PRIME は 2026-11-15 に畳んだ。** Supabase プロジェクト（`ixsycdkazorljshjejcz`）は
削除済み。**Render のサイト `prime-office-board` はまだ残っている**
（workspace `tea-d71ts795pdvs7385o86g`。Claude の Render コネクタからは見えないので、
ユーザーがダッシュボードで消す）。DB が無いので開いても何も読めないが、消すまでは URL が生きている。
中身の控えは Mac の
`01_プライム関連（メンエス）/04_配布物・アーカイブ/2026-11-12_事務所ボード_DB控え_v01/`。
媒体の ID とパス（34行）だけをリーブルゲートのボードに移した。

いま動いている設置：

| 会社 | 画面 | Supabase | Render |
|---|---|---|---|
| 合同会社リーブルゲート（大元） | <https://lg-board-k7w2qm9x.onrender.com> | `zdctkdchovarrkxbrvsr`（東京） | `srv-dbsd1nbbc2fs73b82b1g` |
| しろspa（ナディア滋賀店） | <https://shirospa-board.onrender.com> | `qnmkzhjkgaaeqqnplubd`（東京） | `srv-dbqp5drbc2fs73e1u31g` |
| 藤澤家 | <https://fujisawa-board.onrender.com> | `gsuzsdoinoowiuuxomue`（東京） | `srv-db1vv2jncjis73b6g68g` |

Render はどれも workspace `tea-dau5b2jncjis73aqtfeg`、上記ブランチから自動デプロイ。

**リーブルゲートが大元。** そこから各社のボードを開ける（`config.js` の `clients`）。
**片方向**で、各社のボードはこの設定を持たないので、各社からリーブルゲートへは入れない。
これから入る会社も、しろspa と同じ形（1社＝1 Supabase プロジェクト）で足す。

### ログインまわり（2026-11-15 に直した）

- **登録済みのアドレスで「アカウント作成」を押したとき、嘘の案内が出ていた**
  （`a63ef58`）。Supabase はアドレスの存在を外から当てられないよう、登録済みでも
  エラーを返さず、中身を伏せた利用者（`identities` が空）を返す。これを「作れた」と
  読んでいたので「このままログインしてください」と出て、入れずに詰まっていた。
  いまは「登録済みです」と伝えてログイン画面に戻す。
- **設定 →「このアカウント」からパスワードを変えられるようにした**（`2ce0262`）。
  変える前にいまのパスワードで入り直して本人か確かめる。
  **「パスワードを忘れた」の画面はまだ無い**ので、分からなくなったら
  管理者が Supabase の admin API（`auth/v1/admin/users/{id}` に PUT）で再設定する。
  スタッフ側は4桁の暗証番号で、前から自分で変えられる（ヘッダーの自分の名前）。
- **「パスワードを忘れた」を足した**（`e999d3c` / `4da89e5`）。ログイン画面から
  決め直すリンクをメールで送り、リンクで戻った人には中に入れる前に決めてもらう。
  `config.js` の `passwordReset: true` を入れたボードだけに出る（いまはリーブルゲートのみ）。
  出す前に Supabase の **Site URL** と **Redirect URLs** をそのボードの URL にする
  （既定は `http://localhost:3000`。リーブルゲートは設定済み）。
  **送信は1時間に2通まで**（Supabase 付属のメール）。本番として使うなら独自 SMTP を入れる。
  手順は `prime-office-board-supabase/addons/line/README.md`。
  **2026-11-15、`director.y@libre-gate.co.jp` に実際に届くことを確認した**
  （Supabase 付属のメールのまま）。ただし1時間に2通の上限は変わらないので、
  人が増えたら独自 SMTP に替える。
- 調べていて分かったこと：**招待コードが違っても `auth.users` に未確認の行はできる**。
  メールが送れる設定だと行が残る（送信が断られると残らない）。名簿（`members`）の
  作成は RLS で止まり、未確認なのでログインもできないので、中には入れない。
  ただし行は溜まるので、見慣れないアドレスは消してよい。

### お知らせとメモ（2026-11-20 に直した）

- **日付が過ぎたお知らせ・会議を一覧から外した**（`72ea2f5`）。消してはいない。
  「終わったものを見る（n件）」で開ける。**重要で固定したもの**と**日付の無いもの**は
  今までどおり出す（終わりが分からないため）。3つのボード共通。
- **「メモ」の欄を足した**（同じコミット）。全員で使う覚え書き。日付も通知も無い。
  表は `notices` のまま、`kind='memo'` で入れる。お知らせの一覧にもカレンダーにも
  出さず、`notices_push()` の先頭で弾くので鳴らない。
  `migrations/20261120090000_memos.sql`（kind の check に 'memo' を足す＋トリガ）を
  流したボードで、`config.js` に `memos: true` を入れたときだけ出る。
  **いまはリーブルゲートだけ**（しろspa・藤澤家は Supabase が別アカウントで流せない）。
- ホーム右の「自分用」は前からある**自分だけ**の欄。新しい「メモ」は**全員が読む**ほう。

### Supabase の組織とお金

| 組織 | プラン | 中身 |
|---|---|---|
| `Nanase`（`kxywywiurxnwljbzssup`） | **Pro** | 優生活（`jfhjtrhzcaoujgjgfhuy`） |
| `合同会社リーブルゲート`（`pzllurefwhhqomscqnqg`） | Free | リーブルゲート事務所ボード |

- **プランは組織ごと。** Nanase は Pro なので、そこに足すプロジェクトは
  **2つ目から $10/月**。プロジェクトを消しても、組織が Pro なら安くならない。
  だから新しい会社ぶんは**無料の組織を別に作って**そこに置く
- Free の制約：ダッシュボードから戻せる自動バックアップが**無い**、
  **7日間ほど使われないと止まる**（停止後90日は再開可）、1組織2プロジェクトまで
- **Claude の Supabase コネクタは `Nanase` にしか権限が無い。** リーブルゲートの
  組織は見えないので、そちらの作業は **Supabase CLI**（`supabase link` /
  `db push` / `functions deploy`）と psycopg2 で行う

## 4. 壊してはいけない決定

**ユーザーが明示的にそう指示したもの。** 良かれと思って「直す」と逆効果になる。

- **本部の登録は合言葉なし（`signup_mode = 'open'`）のまま。**
  「合言葉なしでいいよ。これみれるひと限られてるから。」
  → ただし**他社に渡すときは閉じる**。`init-new-company.sql` がそれをやる
- **媒体の ID とパスは暗号化しない。** 合言葉入力の手間に見合わないと判断された
- **メールアドレスの許可リストは使わない。** 「メールアドレス知らないから」
- **スタッフの4桁の暗証番号は平文で保存し、本部が見られる。**
  忘れた人に伝え直すため。4桁はハッシュ化しても総当たりで戻るので、
  安全に見せかけない方を選んだ。画面にもその旨を出している
- **掲載用プロフィール（ダミー）を求人のパイプラインに混ぜない。**
  「ダミーは確かにそれは入れたらダメだ。」`shops.kind` で分けている
- **秘密はリポジトリに入れない。** 認証情報・暗証番号・通知の鍵はすべて DB の中だけ

## 5. 踏んだ落とし穴（同じ所で転ばないために）

- **列単位の `REVOKE` は、表単位の権限が残っていると効かない。**
  Supabase は `public` の全テーブルに表単位の権限を配る。`staff.pin` を
  隠すには表単位を剥がしてから列ごとに grant し直す必要がある。
  最初の実装はこれを見落として、publishable キーがあれば誰でも読める状態だった
- **`staff` は realtime の publication に入れていない。** `pin` 列が
  クライアントに流れるのを避けるため。列単位の権限を Realtime が尊重するか
  確認できなかったので、配信しない方を選んだ
- **通知の鍵（VAPID）は Edge Function が自分で作る。** 人の手を通さない。
  `push_config` はポリシーが1つも無いので `service_role` だけが読める。
  **控えを書き出すときも `push_config` と `push_subs` は除くこと**
- **`.wrap`（クラス）は `main`（要素）より強い。** `main` に書いた
  `padding-bottom` は全幅で効いていなかった。下固定の帯の逃げは `body` に書く
- **iOS は16px未満の入力欄に触れるとページごと拡大し、元に戻らない。**
  `input` だけのセレクタは `input[type=text]` に負ける。型つきで全部書く
- **Android Chrome は `env(safe-area-inset-bottom)` を 0 で返す。**
  `viewport-fit=cover` を付けると下固定の帯がジェスチャーバーに潜る。
  だから `cover` は外してある
- **`app.js` 全体が IIFE。** 外から関数を呼ぶテストは効かない
- **文字サイズ・帯の高さ・下メニューの中身は、こちらで数値を当てにいかない。**
  3回外した。端末ごとの設定（localStorage）にしてある

## 6. 作業のやり方

```bash
node tests/run-all.js      # 1864 passed / 3 failed が正常（既存の root 権限による失敗）
npx markdownlint-cli 'examples/prime-office-board-supabase/*.md'   # リポジトリ直下から
node --check examples/prime-office-board-web/app.js
```

- コミットメッセージは日本語、conventional commits（`feat:` `fix:` `docs:`）
- **PR 本文が5万字を超えている。** `pull_request_read` の `get` は使わない。
  curl で GET → python で部分置換 → PATCH
  （`-H "Content-Type: application/json"` を忘れると 415）
- **`board-*.json` をコミットしない。** `.gitignore` 済み。暗証番号とパスワードが入る
- ブラウザ検証はスタブで。`scratchpad/preview3/` に Supabase を差し替えた一式がある
  （サンドボックスからは Supabase と Render のホストに繋がらない）

## 7. 動いているルーティン

| ID | 内容 |
|----|------|
| `trig_01X4iH6qf4DYXteVP9Z98zdv` | PR #1 の日次チェック。**月が替わっていたら控えも書き出す** |
| `trig_01NCULTmJ9dmNpvHWZhxXD6V` | 月次の控え。**停止中**（Supabase コネクタが紐づけられず動かない） |

控えは2026-10-01に1回取得済み（21テーブル・約100KB）。
手順は `prime-office-board-supabase/BACKUP.md`。

---

## 8. 次にやること：2社目の通しリハーサル

> **2026-10-04 に通し済み。** Free・Tokyo の新規プロジェクトで手順1〜7が止まらず通った。
> 結果と、手順書に足したメモは `SETUP.md` 冒頭と各手順の「通したときのメモ」。
> 「怪しいと睨んでいる所」の4つは、どれも詰まらなかった（下に結果を追記）。
> 以下は実施前に書いた計画として残してある。

> **2026-11-15 追記。** その後、しろspa（3社目）とリーブルゲート（4社目）を本番で立てた。
> 下の「無料枠を空けるために `Nana's Project` を止める」はもう使わない。
> **新しい会社ぶんは、無料の組織を別に作ってそこに置く**（プランは組織ごとなので、
> Pro の組織に足すと2つ目から $10/月かかる）。
> リーブルゲートは Supabase CLI で通した（`db push` で39本、`functions deploy` で4本）。
> その際、各マイグレーションの先頭に `set search_path = public, extensions;` を足した
> （SQL Editor 以外から流すと `gen_random_bytes` が見つからないため。`SETUP.md` 手順2のメモ）。

手順書（`SETUP.md`、7段階）は書いてあるが、**まだ誰も通しで実行していない。**
新しい Supabase プロジェクトを立てて最後まで通し、詰まる場所を見つけて
手順書に反映する。終わったらテスト用は消す。

### 先に片付ける必要があること

無料枠が埋まっているので、`Nana's Project`（`jfhjtrhzcaoujgjgfhuy`）を
一時停止して1つ空ける。**ただし API からは止められない。**

```text
pause_project → "Cannot pause project while it is currently hibernating.
                 Please reach out to support."
select 1       → 3回とも接続タイムアウト（休止が解けない）
```

→ **ブラウザで supabase.com のダッシュボードを開き、`Nana's Project` を
クリックして起こしてから Settings → General → Pause project。**
ブラウザ操作ができない環境なら、ここは人間に頼む。

不要なプロジェクトなら、停止ではなく削除でもよい（枠が恒久的に空く）。

### 手順

`prime-office-board-supabase/SETUP.md` のとおり。要点：

1. 新規プロジェクト。リージョンは **Tokyo (ap-northeast-1)**
2. `migrations/` を**ファイル名の順に35本**。通ったら
   **テーブル23・ポリシー38・関数20・トリガ2**（SETUP.md に確認クエリあり）
3. Edge Function 2つ（`staff-login`、`push`）をデプロイ
4. `push_config` に `function_url` と `anon_key`
5. **`init-new-company.sql`**（画面を公開する**前**に）。`signup_mode` が
   `code` になり8桁の招待コードが出る
6. 画面を置く。`config.js` を書き換え、`index.html` の2行と
   `manifest.webmanifest` の名前も直す
7. 最初のひとりを登録（`members` が空のあいだは招待コード不要）

片付け：テスト用プロジェクトを削除 → **`Nana's Project` を再開**（忘れない）

### 怪しいと睨んでいる所

- `20260913174139_enable_pg_net_and_cron.sql`：`pg_net` と `pg_cron` の有効化
- `cron.schedule(...)`：`cron` スキーマへの権限
- Edge Function デプロイ時の `verify_jwt`
- 最初の管理者登録（メール確認のトリガが絡む）

結果（2026-10-04）：`pg_net`・`pg_cron` は31本目だけで有効になった。`cron.schedule` も
権限エラーなし。`verify_jwt` 有効のまま `sb_publishable_...` で両関数が通る。
最初の登録は確認メールなしで即ログイン。唯一の引っかかりは、**招待コードを
間違えたときに英語の `Email address "..." is invalid` がそのまま画面に出る**こと
（確認メールに回され、標準のメール送信が断る）。2026-10-05 に `app.js` の
`signUp()` で「招待コードが違います」に読み替えた（`open` のときは読み替えない）。

ほかに見つけたもの：`functions/push/index.ts` に `PRIME 事務所ボード`（通知の
見出しの既定値）と `mailto:office@prime.example`（VAPID の連絡先）が直書きされている。
お知らせは必ず見出しを渡すので普段は表に出ないが、2社目に配る前に設定値へ出すとよい。

### 報告してほしいこと

**詰まった場所を全部。これが成果物。**

- 手順書どおりで通ったか／通らなかったか
- 通らなかったなら**エラーの全文**と、どう回避したか
- 手順書に書いていなくて必要だった操作（拡張の有効化、権限、待ち時間）
- 記述が実際と違っていた箇所

通し終えたら `SETUP.md` 冒頭の「まだ通しで1回も実行していない」という
但し書きを、実績（日付・プラン・リージョン）に書き換える。

### 検証済みなので繰り返さなくてよいこと

実行せずに確かめた範囲で、35本を順に流した**最終状態は本番と一致**する。

- テーブル23：一致（`vault_config` と `staff_todos` は途中で drop される）
- ポリシー38：**名前まで**一致
- 関数20：**名前まで**一致
- 後ろで作るものを前で参照している箇所は無い

つまりスキーマの形は固い。残る未知は「空の DB で実際に通るか」と
Edge Function・初回登録まわり。

---

## 9. 他に残っていること

- **導入先の初回オンボーディング** — 最初の管理者登録までの案内が画面に無い
- **書類の中身** — PRIVACY / TERMS / SUPPORT / COMMERCE はすべて〈 〉のまま。
  会社名・住所・窓口・保存期間・金額は会社しか決められないので空にしてある
- **復元の確認** — 控えの書き出しは試したが、戻すほうは未実施（`BACKUP.md` の4）
- **PRIME 自身の設定** — 「個人情報の取り扱い」の本文と `config.js` の
  `support` が未記入。埋めるまでスタッフには何も出ない（壊れてはいない）

## 10. ユーザーの回答待ち（こちらから催促しない）

- Galaxy で下のメニューが見えるようになったか
- Pro に上げるか、手動の控えのままにするか
- メンズエステランキング（ロイヤル）のパスワードが DB と Google ドキュメントで
  食い違い（ドキュメント側は `sInZeJrvi9vMwXGa`）
- 3店舗目の求人票が未登録

## 11. やってはいけないこと

- **本番（`ixsycdkazorljshjejcz`）を実験に使わない。** 毎日使われている
- **`Nana's Project` の中身を読まない・消さない。** 停止と再開だけ
- **Supabase のプランを勝手に変えない。** 課金が発生する
- **1つのプロジェクトを2社で共用しない。** 会社を区別する列が無いので、
  入れた瞬間に互いのパスワードと暗証番号が見える
- **`service_role` の鍵を `config.js` に書かない。** ブラウザに載った時点で全部読める
