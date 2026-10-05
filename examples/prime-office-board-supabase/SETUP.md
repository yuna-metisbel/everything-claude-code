# 新しい会社ぶんを用意する

1社＝1 Supabase プロジェクト。会社どうしのデータは物理的に別で、
片方の設定を間違えても、もう片方には届かない。

所要時間は 30 分ほど。**上から順に、飛ばさずに。**

> **通しの実績：2026-10-04、Free プラン、Tokyo (ap-northeast-1)、PostgreSQL 17。**
> 空の新規プロジェクトに手順1〜7を上から通し、止まる所は無かった。
> 確かめた範囲：35本がエラーなしで通り数が一致、Edge Function 2つが新しい形式の
> publishable キーで動く、お知らせ1件で `push_log` に行ができる、最初の1人は
> 招待コードなし・確認メールなしで入れる、2人目以降は正しい招待コードでだけ入れる、
> 拠点の入り口からスタッフ登録→暗証番号ログイン→打刻、スタッフからは
> `pin` 列・支払い・本部への昇格が拒否される、画面が `config.js` の社名で出る。
> 手順書と違っていた所・書いていなかった所は、各手順の「通したときのメモ」に書いた。
> 詰まったら、その場所と内容をここに書き足すこと。

順番に意味があるのは手順5（登録方法を閉める）と6（画面を置く）。
逆にすると、URL を知った人が誰でも登録できる時間ができる。

## 1. Supabase プロジェクトを作る

[supabase.com](https://supabase.com) で新規プロジェクト。リージョンは **Tokyo (ap-northeast-1)**。
できたら次の3つを控える（後で使う）。

| 名前 | どこにある |
|------|-----------|
| Project URL | Settings → API |
| publishable キー（`sb_publishable_...`） | Settings → API Keys |
| service_role キー | Settings → API Keys。**これは誰にも渡さない** |

通したときのメモ：

- publishable キーは**新しい形式（`sb_publishable_...`）を使う。** 手順3〜6の
  どこでもこれで通る。旧形式の anon キー（`eyJ...` で始まる JWT）でも動くが、
  2つを混ぜると見比べるときに取り違えるので、どちらか一方に揃える。
- service_role キーは**この手順では1回も使わない**（Edge Function には Supabase が
  自動で渡す）。控えなくてよい。控えるなら、リポジトリや会話には書かない。
- 作成直後に SQL を流しても待たされなかった（Free・Tokyo、作成から1分以内）。

## 2. スキーマを入れる

`migrations/` のファイルを **ファイル名の順に**、1本ずつ SQL Editor に貼って実行する。
順番が命で、飛ばすと後ろが失敗する。

35本ぜんぶ通ると、テーブル 23・ポリシー 38・関数 20・トリガ 2 ができる。
数が合わなければどこかで止まっている。

13本目（`20260913174403_...`）の中の `push_send` は、送り先が空のままにしてある。
34本目で丸ごと差し替わり、宛先は次の手順で DB に入れるので、そのまま通してよい。

```sql
-- 確認用。4つとも合っていれば、35本が最後まで通っている。
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE')          as "テーブル（23）",
  (select count(*) from pg_policies where schemaname = 'public')          as "ポリシー（38）",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public')                                           as "関数（20）",
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal)                    as "トリガ（2）";
```

通したときのメモ：

- 35本とも、追加の操作なしで通った。`pg_net` と `pg_cron` は31本目が自分で有効にする
  （ダッシュボードの Extensions で先に入れておく必要は無い）。`pg_net` は
  `extensions`、`pg_cron` は `pg_catalog` に入る。
- 33本目の最後の `cron.schedule(...)` は、結果に `schedule = 1` のような**数字が1つ出る**。
  これはジョブの番号で、エラーではない。
- 32本目と `init-new-company.sql` の `gen_random_bytes` は、SQL Editor の既定の
  `search_path`（`"$user", public, extensions`）で解決される。SQL Editor 以外の道具で
  流して `function gen_random_bytes(integer) does not exist` が出たら、
  先頭に `set search_path = public, extensions;` を足す。
- この確認クエリとは別に、`select count(*) from cron.job;` が 1（朝のまとめ）になる。

## 3. Edge Function を2つ置く

`functions/staff-login/` と `functions/push/` を、Supabase の Edge Functions に
それぞれ同じ名前でデプロイする。`verify_jwt` は有効のままでよい。

通したときのメモ：

- `verify_jwt` を有効にしたまま、新しい形式の publishable キー（JWT ではない）で
  両方とも呼べることを確かめた。無効にする必要は無い。
- 置いた直後に `push` を一度呼ぶと（画面で通知をオンにしたときに呼ばれる）、
  通知の鍵（VAPID）が自動で作られて `push_config` に入る。手で作らない。
- CLI（`supabase functions deploy`）で置くときは、`supabase projects list` で
  **この会社のプロジェクトが一覧に出るアカウントでログインしているか**を先に見る。
  別の組織のアカウントのままだと、デプロイ先が見つからない。

## 4. 通知の宛先を設定する

`push_send` はプロジェクトごとに違う値を使うので、ここを入れないと通知だけが黙って出ない
（お知らせの登録などは通常どおり動く）。

```sql
update public.push_config
   set function_url = 'https://<プロジェクトID>.supabase.co/functions/v1/push',
       anon_key     = '<publishable キー（sb_publishable_...）>'
 where id = 1;
```

`send_secret` はスキーマを入れた時点で自動生成済み。触らなくてよい。

列の名前は `anon_key` だが、新しい形式の publishable キーを入れて通知が届くところ
（お知らせ1件で `push_log` に行ができる）まで確かめてある。

## 5. 登録方法を閉める（画面を公開する前に）

マイグレーションの5本目で、登録方法が「**誰でも登録できる**」になる。これは PRIME が
自分で選んだ設定で（URL を知る人が限られているという判断）、渡し先の会社はその判断を
していない。そのまま公開すると、URL を知った人が誰でも登録して、支払い・媒体の ID と
パス・スタッフの暗証番号まで読める。

`init-new-company.sql` を SQL Editor に貼って実行する。登録方法を「招待コードが要る」に
戻し、8桁のコードを作る。読み上げて聞き間違えない字だけを使う（0とO、1とIは入らない）。

実行すると最後にこの形の表が出る。

| 登録方法 | 招待コード | 登録済みの人 | 通知の宛先 | テーブル（23） | ポリシー（38） |
|----------|-----------|--------------|-----------|----------------|----------------|
| code     | NL5YGWXK  | 0            | ok        | 23             | 38             |

出てきた**招待コードは、先方の担当者だけに渡す**。
誰かがもう登録しているボードに間違って流したときは、何も変えずに止まる。

## 6. 画面を置く

`../prime-office-board-web/` を静的サイトとして配信する（Render など）。
**`config.js` だけ**をこの会社のものに書き換える。`app.js` は全社共通のまま触らない。

```js
window.BOARD_CONFIG = {
  supabaseUrl: "https://<プロジェクトID>.supabase.co",
  supabaseKey: "<publishable キー（sb_publishable_...）>",
  brand: "<会社名>",
  brandSub: "事務所ボード",
  support: "<困ったときの連絡先>"
};
```

`support` は「設定」タブの**困ったとき**と、画面が出ないときのエラー表示に出る。
空のままだと何も出ない。何を書くかは [SUPPORT.md](SUPPORT.md)。

画面の上に出る名前と、ブラウザのタブの名前は、ここから自動で入る。
ただし **JS より先に読まれる／別に取得される4か所**だけは手で直す。

| ファイル | 直すところ | どこに出るか |
|----------|-----------|-------------|
| `index.html` | `<title>` | ブラウザのタブ（最初の一瞬） |
| `index.html` | `apple-mobile-web-app-title` | iPhone でホーム画面に置いたときの名前 |
| `manifest.webmanifest` | `name` と `short_name` | Android でホーム画面に置いたときの名前 |
| `icon-192.png` / `icon-512.png` | 画像そのもの | ホーム画面のアイコン（任意） |

`app.js` と `sw.js` は**全社共通**。社名は入っていないので触らない。
ここを1社ぶん直すと、次の会社にもその名前が付いて回る。

`config.js` を書き忘れると画面に「設定がありません」と出る。
白い画面にはならないので、出たらこの手順の書き換え漏れ。

## 7. 最初のひとりを登録する

`members` が空のあいだは、**招待コードが無くても**登録した人が入れる。これは最初の管理者を
作るための抜け道で、1人入った時点で閉じる。つまり**最初に URL を開いた人が管理者になる**ので、
**先方の担当者に URL を渡し、目の前で登録してもらう**。

通したときのメモ：

- 最初の1人は、メールアドレスとパスワードを入れるだけで**確認メールなしに**すぐ入れた。
  続けて名前を入れると管理者（`members` の1人目）になる。
- 2人目以降は、正しい招待コードを入れれば同じく確認メールなしで入れる。
- 招待コードを間違えると「招待コードが違います。」と出て、アカウントは作られない
  （`auth.users` に行は残らない）。中では、コード違いの登録が確認メールに回され、
  Supabase 標準のメール送信が断っている。リハーサル時点では英語の
  `Email address "（入れたアドレス）" is invalid` がそのまま出ていたので、
  画面側で読み替えるようにした。

登録が済んだら、手順5のコードを渡して残りの人に登録してもらう。
「設定」タブの**スタッフの登録方法**で、その会社の方針に合わせて変えられる。

持ち出しを記録する物として `黒スマホ` が1件だけ初期値で入っている。
その会社に無ければ名前を変えるか消してよい。

## 8. 個人情報の取り扱いを入れる

このボードは氏名・電話番号・緊急連絡先・4桁の暗証番号・勤怠・鍵の開閉を預かる。
**スタッフを登録してもらう前に**、先方の会社の文書として用意してもらう。

[PRIVACY.md](PRIVACY.md) のひな形を渡し、〈 〉を埋めてもらって、
「設定」タブ →**個人情報の取り扱い**に貼る。貼ると、スタッフが登録する前の
画面から読めるようになる。空のままだとリンクが出ないので、スタッフには何も見えない。

会社名・住所・窓口・保存する期間は先方しか決められない。こちらで埋めない。

## 渡す前に必ず確認すること

- [ ] `select signup_mode from public.board_settings where id = 1;` が `code`
      （`open` のまま渡すのは、その会社がそう決めたときだけ）
- [ ] `select count(*) from public.members;` が 1 以上（管理者がいる）
- [ ] 拠点を1つ作り、入り口 URL（`?s=コード`）でスタッフ登録ができる
- [ ] お知らせを1件入れて、`push_log` に行ができる（通知が出ている）
- [ ] 「設定」→ 個人情報の取り扱いに文章が入っていて、入り口の画面から読める
- [ ] **ほかの会社のプロジェクトを開いていないこと**。URL の `<プロジェクトID>` を
      config.js と push_config の両方で見比べる。ここを取り違えると、
      よその会社の通知が飛ぶ。

## やってはいけないこと

- **service_role キーを `config.js` に書かない。** あれは全部のポリシーを無視する鍵で、
  ブラウザに載せた時点でその会社のデータは全部読まれる。
- **1つのプロジェクトを2社で使い回さない。** このスキーマに会社を区別する列は無い。
  入れた瞬間、互いのパスワードと暗証番号が見える。
