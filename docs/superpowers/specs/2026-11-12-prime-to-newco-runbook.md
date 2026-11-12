# PRIME のボードを畳んで、自社用に立て直す手順

2026-11-12 / ユーザーの選択：**新しく立てて、古いのは消す**

目的は URL を変えることではなく、**いまの URL とアカウントの両方を無効にする**こと。
URL だけ変えても、いまのスタッフのメール・パスワードと4桁の暗証番号は
Supabase に残るので、新しい URL が分かればログインできてしまう。

持ち出すもの：**媒体の ID とパス（`vault`）だけ**（ユーザー指定）。
ただし**控えは23表ぶん全部**取る。無料プランに自動バックアップは無く、
消したら戻せないため。

---

## はじめに要るもの

| | いま | 必要なこと |
|---|---|---|
| Supabase コネクタ | 藤澤家（`qxwnsodraoogyekpgmou`）につながっている | **PRIME 側のアカウント（組織 `Nanase`）につなぎ直す。** これが無いと `ixsycdkazorljshjejcz` が見えず、書き出しも削除もできない |
| Render | 「ゆーちゃん's workspace」（`tea-dau5b2jncjis73aqtfeg`）だけ見える | PRIME のサイトは別ワークスペース `tea-d71ts795pdvs7385o86g`。**削除は画面から**か、そちらにつなぎ直す |
| 会社名 | 未定 | ボードに出す名前（`brand`）。あとから「設定」でも変えられる |

PRIME 側につなぎ直すと、**藤澤家としろspa が見えなくなる**。
それらに用があるときは戻すこと。

---

## 手順

### 1. 控えを全部取る（消す前に必ず）

`BACKUP.md` の手順。`push_config` と `push_subs` は**除く**（通知の鍵が入る）。
23表を JSON か CSV で書き出し、リポジトリの外に置く。

### 2. 媒体の ID とパスを取り出す

```sql
select media, url, login_id, password, shop, cast_name, note, share, updated_at
  from public.vault
 order by media, shop, cast_name;
```

このデータは暗号化されていない（PRIME がそう決めた。HANDOVER 4章）。
**リポジトリにも会話の本文にも書かない。** 移し終えたら手元の控えも片付ける。

### 3. 自社用の Supabase プロジェクトを立てる

`SETUP.md` の手順1〜5と同じ。リージョンは **Tokyo**。

- `migrations/` 35本 → テーブル23・ポリシー38・関数20・トリガ2・cron 1
- 使う追加機能があれば `addons/line/01`〜`04`
- Edge Function（`staff-login`・`push`、LINE を使うなら `line-login`・`line-webhook`）
- `push_config` に `function_url` と `anon_key`
- `init-new-company.sql` → 招待コードが出る（**公開前に**）

PRIME と同じアカウントに作れば、2 で取り出したものをそのまま入れられる。

### 4. 媒体の ID とパスを入れる

新しいプロジェクトの `vault` に insert する。`share` は既定の `all` のまま、
`open_sites` は空（本部だけが見る）。入れ終わったら件数を突き合わせる。

### 5. 新しい画面を出す

- `config.<会社>.js` を足す（しろspa のものが手本：
  `examples/prime-office-board-web/config.shirospa.js`）
- Render に静的サイトを作る。Build Command は
  `sh examples/prime-office-board-web/build-site.sh <会社>`、
  Publish Path は `examples/prime-office-board-web`、
  環境変数 `SKIP_INSTALL_DEPS=true`
- **名前は推測されにくいものにする**（例：`nadia-office-7k3m`）。
  `onrender.com` のサブドメインがそのまま URL になるため

### 6. 古いほうを止める

ここまでが動いてから。順番を逆にしない。

1. **Render の `prime-office-board` を削除**（別ワークスペース。画面から）
   → 旧 URL `prime-office-board.onrender.com` は 404 になる
2. **Supabase `ixsycdkazorljshjejcz` を削除**（または一時停止）
   → 旧アカウントも旧データも消える

1 だけだと、旧 Supabase は生きたまま。2 だけだと、旧 URL は生きたまま
「設定がありません」を出す。**両方やって初めて切れる。**

### 7. 確かめる

- [ ] 旧 URL が 404
- [ ] 新しい URL が出て、`config.js` の接続先が新しいプロジェクト
- [ ] `select count(*) from public.vault;` が 2 の件数と一致
- [ ] `signup_mode` が `code`、`members` が 1 以上（最初の管理者が登録済み）
- [ ] 控え（手順1）が手元にある

---

## やってはいけないこと

- **手順6を先にやらない。** 控えと移し替えが終わる前に消すと戻せない
- 媒体の ID とパスをリポジトリに入れない
- `service_role` の鍵を `config.js` に書かない
- 藤澤家（`gsuzsdoinoowiuuxomue`）としろspa（`qnmkzhjkgaaeqqnplubd`）には触らない
