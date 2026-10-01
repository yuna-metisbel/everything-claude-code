# 控えと戻し方

**先に結論。いまの Free プランには、戻せる控えが無い。**
Supabase の自動バックアップは Pro 以上の機能で、Free では
ダッシュボードから戻せない。[公式の案内](https://supabase.com/docs/guides/platform/backups)も
「Free のプロジェクトは `supabase db dump` で定期的に書き出して、
別の場所に控えを持つこと」と書いている。

PRIME のプロジェクト（`ixsycdkazorljshjejcz`）は 2026-10-01 時点で Free。
つまり**いま誤って消したら戻せない。**

---

## 1. いま分かっていること

| | Free | Pro（$25/月〜） |
|---|---|---|
| 毎日の自動バックアップ | ダッシュボードから**使えない** | 直近7日ぶん |
| 7日間使われないと停止 | **する**（停止後90日は再開できる） | しない |
| 手動の書き出し | 自分でやる | 自分でやる（併用を推奨） |
| プロジェクトを削除したとき | 控えも含めて完全に消える。戻せない | 同じ |

Free でも内部的には最大7日ぶんの日次バックアップが取られているが、
**Pro に上げないと取り出せない**。しかも公式に「将来 Free では
取らなくなる可能性がある」と書かれているので、当てにしない。

### 7日間使われないと止まる

これは控え以上に効く。**1週間ほど誰もボードを開かないと、
Supabase がプロジェクトを止める。** 止まるとログインもできない。

- 止まる約1週間前に、プロジェクトの持ち主にメールが届く
- ダッシュボードを開くか、ボードを使えば止まらない
- 止まったあとも90日以内なら「Resume project」で戻せる
- 毎朝8時の通知（`pg_cron`）は内部の処理なので、これだけでは足りない

毎日スタッフが使うなら問題にならない。**危ないのは、渡した会社が
試して放置したとき。** 1〜2社に無料で使ってもらう段階では、
これを先に伝えておくこと。

## 2. いますぐやること（どちらか）

**A. Pro に上げる（毎日使う会社向け）**
停止しなくなり、7日ぶんの日次バックアップが使えるようになる。
本番として使うなら、これが一番手間がかからない。

料金は**組織（organization）単位**。プロジェクト単位ではない。

| | 月額 |
|---|---|
| Pro プラン | $25 |
| プロジェクト1つぶんの Compute（Micro） | $10 |
| Compute クレジット（Pro に毎月付く） | −$10 |
| **プロジェクト1つなら** | **$25** |
| プロジェクトが増えるたび | ＋$10 |

**落とし穴：同じ組織にある全プロジェクトが課金対象になる。**
組織 `Nanase` には 2026-10-01 時点で2つある。

- `PRIME Office Board`（東京）
- `Nana's Project`（シドニー）

このまま Pro にすると **$35/月**。関係ないほうを先に別の無料組織へ移せば
**$25/月**。プロジェクトの移動はダッシュボードから自分でできる
（無料プロジェクトは1組織に2つまで持てる）。

請求は USD。円に直すと1ドル150円で約3,750円（$25 のとき）。
消費税が別に付くことがある。

**PITR（秒単位で戻せるもの）は別料金で7日ぶん約$100/月。**
このボードには要らない。日次バックアップで足りる。

Spend Cap は Pro の既定で有効。使いすぎで請求が跳ねるのを止めてくれる。

**B. 月1回、手で書き出す（無料のまま続けるなら）**
下の手順3。所要5分。カレンダーに毎月の予定として入れておく。
やらないなら、控えが無いことを受け入れていることになる。

## 3. 手で書き出す

### 手順A：CLI（おすすめ。スキーマも入る）

```bash
# 初回だけ
npm install -g supabase
supabase login

# 書き出し（データとスキーマの両方）
supabase db dump --project-ref <プロジェクトID> -f board-$(date +%Y%m%d).sql
supabase db dump --project-ref <プロジェクトID> --data-only -f board-data-$(date +%Y%m%d).sql
```

スキーマは `migrations/` にも入っているので、最低限いるのはデータのほう。

### 手順B：CLI が無いとき（SQL エディタだけで済む）

Supabase の SQL Editor にこれを貼って実行し、結果をコピーして
`board-YYYYMMDD.json` として保存する。全テーブルが1つの JSON になる。

```sql
select jsonb_pretty(jsonb_build_object(
  'taken_at', now(),
  'tables', (
    select jsonb_object_agg(tbl, rows)
    from (
      select t.table_name as tbl,
             (xpath('/row/j/text()',
               query_to_xml(
                 format('select coalesce(jsonb_agg(x), ''[]''::jsonb)::text as j from public.%I x',
                        t.table_name),
                 false, true, '')))[1]::text::jsonb as rows
        from information_schema.tables t
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
         -- push_config には通知の秘密鍵と合言葉が入っている。復元のときは
         -- 新しいプロジェクトの鍵をそのまま使うので、控えに入れない。
         -- push_subs は端末ごとの通知の宛先で、復元しても使えない。
         and t.table_name not in ('push_config', 'push_subs')
    ) s
  )
))::text as backup;
```

PRIME で実行した結果：21テーブル、約10万文字（約100KB）。このくらいの規模なら
1回のクエリで収まる。行数が万単位になったら手順A に切り替える。

**この JSON には4桁の暗証番号と媒体のパスワードがそのまま入っている。**
置き場所に注意すること（下の5）。通知の秘密鍵だけは上のとおり除いてある。

### 結果が長すぎて表示できないとき

ツールやエディタが「長すぎる」と言って結果をファイルに退避した場合は、
そのファイルから取り出す。Supabase の MCP 経由だと起きる（10万文字を超える）。

```python
import io, json, re
outer = json.load(io.open("<退避されたファイル>", encoding="utf-8"))
m = re.search(r"<untrusted-data-[0-9a-f-]+>\s*(\[.*\])\s*</untrusted-data-[0-9a-f-]+>",
              outer["result"], re.S)
backup = json.loads(json.loads(m.group(1))[0]["backup"])
io.open("board-YYYYMMDD.json", "w", encoding="utf-8").write(
    json.dumps(backup, ensure_ascii=False, indent=1))
```

### 書き出せたかの確認

数が合っているかだけ見る。

```sql
select 'members' as t, count(*) from public.members
union all select 'staff', count(*) from public.staff
union all select 'schedule', count(*) from public.schedule
union all select 'payments', count(*) from public.payments
union all select 'vault', count(*) from public.vault
union all select 'punches', count(*) from public.punches;
```

## 4. 戻し方

### Pro のとき

ダッシュボードの **Database → Backups** から日付を選んで復元する。
**復元中はボードが使えない。** 事前にスタッフへ伝えること。

### Free のとき（手順B の JSON から）

自動では戻らない。次の順で組み直す。

1. 新しいプロジェクトを作る（[SETUP.md](SETUP.md) の手順1〜4）
2. `migrations/` を順に流してスキーマを作る
3. JSON から表ごとに `insert` を組んで入れる。
   **参照の順番がある**ので、この順で入れる。

   ```text
   members → sites → staff → shops → devices
     → schedule, tasks, payments, vault, notices, notes
     → punches, key_events, key_duty, staff_shifts, device_log
   ```

   先に `schedule` を入れると `member_id` が無くて弾かれる。

4. `board_settings` は入れ直さない（新しいプロジェクトの招待コードをそのまま使う）。
   `push_config` と `push_subs` はそもそも控えに入っていない。
   通知の鍵は新しいプロジェクトが自分で作り、端末の通知は各自が入れ直す
5. [SETUP.md](SETUP.md) の「渡す前に必ず確認すること」を上から確認する

**この手順は、まだ実際に通していない。** 書き出しは試したが、
戻すほうは試していない。下の6のとおり、一度やっておくこと。

## 5. 控えの置き場所

書き出したファイルには、スタッフの氏名・電話番号・緊急連絡先・
4桁の暗証番号・媒体のパスワードが**そのまま**入っている。

- 共有のチャットに貼らない。LINE やメールで送らない
- 誰でも開けるクラウドの共有フォルダに置かない
- 置くなら、持ち主だけが開ける場所に。可能なら圧縮して暗号化する
- 古い控えは残し続けない。〈 〉か月より古いものは消す

[PRIVACY.md](PRIVACY.md) の第4項（保存する期間）と、ここの扱いを
揃えておくこと。ボードの中だけ消しても、控えに残っていたら消したことにならない。

## 6. 年に1回は、本当に戻せるか試す

控えがあることと、戻せることは別。少なくとも年1回、
**新しいプロジェクトを1つ作って、控えから組み直してみる**。
試したら消す。これをやっていない控えは、あるだけで安心しているだけの状態。

試した日を書き残す場所。

| 試した日 | 使った控え | 結果 | 気づいたこと |
|----------|-----------|------|-------------|
|          |           |      |             |

## 取った控え

| 日 | テーブル | 大きさ | 取り方 |
|----|---------|-------|-------|
| 2026-10-01 | 21 | 約100KB | 手順B（SQL エディタ） |
