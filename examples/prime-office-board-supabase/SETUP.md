# 新しい会社ぶんを用意する

1社＝1 Supabase プロジェクト。会社どうしのデータは物理的に別で、
片方の設定を間違えても、もう片方には届かない。

所要時間は 30 分ほど。**上から順に、飛ばさずに。**

## 1. Supabase プロジェクトを作る

[supabase.com](https://supabase.com) で新規プロジェクト。リージョンは **Tokyo (ap-northeast-1)**。
できたら次の3つを控える（後で使う）。

| 名前 | どこにある |
|------|-----------|
| Project URL | Settings → API |
| publishable（anon）キー | Settings → API |
| service_role キー | Settings → API。**これは誰にも渡さない** |

## 2. スキーマを入れる

`migrations/` のファイルを **ファイル名の順に**、1本ずつ SQL Editor に貼って実行する。
順番が命で、飛ばすと後ろが失敗する。

34本ぜんぶ通ると、テーブル 23・ポリシー 38・関数 19 ができる。数が合わなければ止まっている。

13本目（`20260913174403_...`）の中の `push_send` は、送り先が空のままにしてある。
最後の34本目で丸ごと差し替わり、宛先は次の手順で DB に入れるので、そのまま通してよい。

```sql
-- 確認用
select count(*) from information_schema.tables where table_schema = 'public';   -- 23
select count(*) from pg_policies where schemaname = 'public';                   -- 38
```

## 3. Edge Function を2つ置く

`functions/staff-login/` と `functions/push/` を、Supabase の Edge Functions に
それぞれ同じ名前でデプロイする。`verify_jwt` は有効のままでよい。

## 4. 通知の宛先を設定する

`push_send` はプロジェクトごとに違う値を使うので、ここを入れないと通知だけが黙って出ない
（お知らせの登録などは通常どおり動く）。

```sql
update public.push_config
   set function_url = 'https://<プロジェクトID>.supabase.co/functions/v1/push',
       anon_key     = '<publishable（anon）キー>'
 where id = 1;
```

`send_secret` はスキーマを入れた時点で自動生成済み。触らなくてよい。

## 5. 画面を置く

`../prime-office-board-web/` を静的サイトとして配信する（Render など）。
**`config.js` だけ**をこの会社のものに書き換える。`app.js` は全社共通のまま触らない。

```js
window.BOARD_CONFIG = {
  supabaseUrl: "https://<プロジェクトID>.supabase.co",
  supabaseKey: "<publishable（anon）キー>",
  brand: "<会社名>",
  brandSub: "事務所ボード"
};
```

`index.html` の先頭にある2行（`apple-mobile-web-app-title` と `<title>`）も会社名に直す。
ここだけは JS より先に読まれるので、`config.js` からは差し替えられない。

書き忘れると画面に「設定がありません」と出る。白い画面にはならないので、
出たらこの手順の書き換え漏れ。

## 6. 最初のひとりを登録する

`members` が空のあいだは、誰でも登録した人が管理者になる。
**先方の担当者に URL を渡し、目の前で登録してもらう**のが安全。
登録が済んだら「設定」タブの**スタッフの登録方法**を、その会社の方針に合わせる。

## 渡す前に必ず確認すること

- [ ] `select count(*) from public.members;` が 1 以上（管理者がいる）
- [ ] 拠点を1つ作り、入り口 URL（`?s=コード`）でスタッフ登録ができる
- [ ] お知らせを1件入れて、`push_log` に行ができる（通知が出ている）
- [ ] **ほかの会社のプロジェクトを開いていないこと**。URL の `<プロジェクトID>` を
      config.js と push_config の両方で見比べる。ここを取り違えると、
      よその会社の通知が飛ぶ。

## やってはいけないこと

- **service_role キーを `config.js` に書かない。** あれは全部のポリシーを無視する鍵で、
  ブラウザに載せた時点でその会社のデータは全部読まれる。
- **1つのプロジェクトを2社で使い回さない。** このスキーマに会社を区別する列は無い。
  入れた瞬間、互いのパスワードと暗証番号が見える。
