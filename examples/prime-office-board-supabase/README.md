# PRIME 事務所ボード — Supabase 側

`../prime-office-board-web/` から使う Supabase プロジェクト
（`PRIME Office Board`、東京リージョン）のサーバー側コード。

Render が publish するのは `../prime-office-board-web/` だけなので、ここは配信されない。
サーバー側のコードを静的サイトのルートに置かないために、ディレクトリを分けている。

## Edge Function

| 関数          | 役割                                 |
|---------------|--------------------------------------|
| `staff-login` | スタッフの「名前＋暗証番号」ログイン |

暗証番号は4桁しかなく、bcrypt ハッシュでもブラウザに渡した時点で総当たりで割れる。
そのため照合はこの関数（`service_role`）の中だけで行い、成功したときだけ
マジックリンクを1回ぶん発行して、ブラウザ側が `verifyOtp` で通常のセッションに
引き換える。以降のデータアクセスはすべて普通の RLS で守れる。

この関数が使う関数は、いずれも `anon` / `authenticated` から実行できない。

| 関数                           | 役割                                   |
|--------------------------------|----------------------------------------|
| `staff_check_pin(uuid, text)`  | 暗証番号の照合と、5回失敗で10分ロック  |
| `staff_mark_login(uuid, uuid)` | 認証ユーザーの紐付けと最終ログイン時刻 |
| `staff_auth_id_by_email(text)` | 紐付けが外れた認証ユーザーの拾い直し   |

`site_gate(text)` だけは `anon` から呼べる。入り口の表示に必要な拠点名と名簿を、
コードが一致して公開中の拠点についてのみ返す。

## デプロイ

Supabase ダッシュボード、CLI（`supabase functions deploy staff-login`）、
または MCP の `deploy_edge_function` から。`verify_jwt` は有効のままでよい
（ブラウザは publishable キーを Authorization ヘッダーに載せて呼ぶ）。

## スキーマ

マイグレーションは Supabase プロジェクト側に記録されている。拠点まわりで入れたものは
次の6件。

| バージョン     | 名前                           | 内容                                                                             |
|----------------|--------------------------------|----------------------------------------------------------------------------------|
| 20260907123310 | `staff_sites_core`             | `sites` `staff` `punches` `key_events` `key_duty` `staff_todos` `staff_shifts`   |
| 20260907131336 | `staff_sites_rls`              | RLS と `staff_me()` `staff_site()` `staff_is_manager()`、`may_join()` の絞り込み |
| 20260907132700 | `staff_pin_and_gate`           | 暗証番号の設定・照合・入り口の照会、失敗回数の記録                               |
| 20260907155503 | `staff_auth_lookup`            | 認証ユーザーの拾い直し                                                           |
| 20260907165706 | `staff_pin_set_flag`           | ハッシュは読めないので、発行済みかどうかだけを別列で持つ                         |
| 20260907171420 | `staff_pin_hash_column_grants` | `pin_hash` を列単位の権限でクライアントから隠す                                  |

最後の1件は落とし穴の修正。Supabase は `public` の全テーブルに表単位の権限を配るので、
表単位の権限をいったん剥がしてから見せてよい列だけを grant し直さないと、列単位の
`revoke` は効かない。
