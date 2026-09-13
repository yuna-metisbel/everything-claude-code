# PRIME 事務所ボード — Supabase 側

`../prime-office-board-web/` から使う Supabase プロジェクト
（`PRIME Office Board`、東京リージョン）のサーバー側コード。

Render が publish するのは `../prime-office-board-web/` だけなので、ここは配信されない。
サーバー側のコードを静的サイトのルートに置かないために、ディレクトリを分けている。

## Edge Function

| 関数          | 役割                                   |
|---------------|----------------------------------------|
| `staff-login` | スタッフの「名前＋暗証番号」ログイン   |
| `push`        | スマホへの通知（送信鍵の配布と、送信） |

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

## スマホへの通知

送信鍵（VAPID）は `push` 関数が自分で作って `push_config` に置く。人の手で貼らないので、
鍵がリポジトリにも会話にも出てこない。`push_config` は RLS を有効にしたうえで
ポリシーを1つも置いていないので、`service_role` 以外からは1行も見えない。

送信は誰でも呼べては困る（全員の端末を鳴らせてしまう）。名乗り方は2つだけ。

- `service_role` の JWT
- `push_config.send_secret` と一致する `x-push-secret` ヘッダー

後者は DB 側から呼ぶためのもの。`service_role` の鍵を SQL に書き込まずに済む。
照合は長さを揃えて1文字ずつ比べ、何文字目まで合っていたかが時間に出ないようにしている。

送るきっかけは次の4つ。いずれも `push_send()` を通り、`push_log.tag` が一意なので
同じ知らせで二度鳴らない。

| きっかけ                       | しくみ                                      |
|--------------------------------|---------------------------------------------|
| 会議・お知らせが登録されたとき | `notices` の insert トリガ `notices_push()` |
| 「決まったこと」が書かれたとき | `notices` の update トリガ（同じ関数）      |
| 会議の前日・当日の朝           | `push_morning()`                            |
| 期日が今日のタスク・支払い     | `push_morning()`（同じ通知にまとめる）      |

朝の分は `pg_cron` の `push-morning`（`0 23 * * *` = 日本時間の8時）から。
何も無い日は鳴らさない。空の通知が続くと、次から見なくなるため。

端末の登録先は `push_subs`。自分の行しか読めず、書けず、消せない
（`member_id = auth.uid()`）。他人の端末の endpoint は、本部からも見えない。

## デプロイ

Supabase ダッシュボード、CLI（`supabase functions deploy staff-login`）、
または MCP の `deploy_edge_function` から。`verify_jwt` は有効のままでよい
（ブラウザは publishable キーを Authorization ヘッダーに載せて呼ぶ）。

## スキーマ

マイグレーションは Supabase プロジェクト側に記録されている。拠点まわり以降に
入れたものは次のとおり。

| バージョン     | 名前                              | 内容                                                                             |
|----------------|-----------------------------------|----------------------------------------------------------------------------------|
| 20260907123310 | `staff_sites_core`                | `sites` `staff` `punches` `key_events` `key_duty` `staff_todos` `staff_shifts`   |
| 20260907131336 | `staff_sites_rls`                 | RLS と `staff_me()` `staff_site()` `staff_is_manager()`、`may_join()` の絞り込み |
| 20260907132700 | `staff_pin_and_gate`              | 暗証番号の設定・照合・入り口の照会、失敗回数の記録                               |
| 20260907155503 | `staff_auth_lookup`               | 認証ユーザーの拾い直し                                                           |
| 20260907165706 | `staff_pin_set_flag`              | ハッシュは読めないので、発行済みかどうかだけを別列で持つ                         |
| 20260907171420 | `staff_pin_hash_column_grants`    | `pin_hash` を列単位の権限でクライアントから隠す                                  |
| 20260907205641 | `merge_staff_todos_into_tasks`    | 拠点の TODO を `tasks` に統合し、`staff_todos` を削除                            |
| 20260907210534 | `staff_self_signup_visible_pin`   | 本人による登録と、本部が4桁を確認できる `pin` 列                                 |
| 20260908121740 | `shops_kind_listing_profile`      | 掲載用プロフィールを `shops.kind` で店舗と分ける                                 |
| 20260908162619 | `shops_phone`                     | 店舗の電話番号。■ ブロックとは別に持つ                                           |
| 20260908162727 | `personal_notes`                  | 自分だけのやること・メモ `notes` と、1件ごとの公開範囲                           |
| 20260910125750 | `schedule_kind_both`              | 「事務所＋在宅」の区分を `schedule.kind` に追加                                  |
| 20260912123937 | `realtime_for_later_tables`       | あとから足した表を realtime の配信対象に追加（`staff` は除く）                   |
| 20260912125835 | `staff_can_set_key_holders`       | 鍵の所持者を拠点のスタッフが登録できる `set_key_holder()`                        |
| 20260913014336 | `meetings_and_emergency_contacts` | 会議（`kind`/時間/場所/決まったこと）と、連絡先・緊急連絡先                      |
| 20260913014503 | `device_checkout`                 | `devices` `device_log`（黒スマホなどの持ち出し）                                 |
| 20260913014640 | `per_item_visibility_tasks_vault` | やること・ID /パスの1件ごとの公開範囲と `hq_can_see()`                           |
| 20260913174019 | `web_push_subscriptions`          | `push_subs` `push_config` `push_log`（スマホへの通知）                           |
| 20260913174139 | `enable_pg_net_and_cron`          | DB から HTTP を投げる `pg_net` と、時刻で動かす `pg_cron`                        |
| 20260913174159 | `push_send_secret`                | DB から送信を頼むときの合言葉を `push_config` に置く                             |
| 20260913174403 | `push_triggers_and_digest`        | 会議・決まったこと・毎朝8時の「今日のこと」を送るトリガと関数                    |

`staff_pin_hash_column_grants` は落とし穴の修正。Supabase は `public` の全テーブルに
表単位の権限を配るので、表単位の権限をいったん剥がしてから見せてよい列だけを
grant し直さないと、列単位の `revoke` は効かない。この教訓は後から足した `pin` 列にも
効いていて、表単位の権限が剥がれているおかげで既定では誰の権限も付かない。
