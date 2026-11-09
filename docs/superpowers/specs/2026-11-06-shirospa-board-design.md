# しろspa（ナディア滋賀店）事務所ボード 設計

2026-11-06 / ブランチ `claude/mens-esthe-schedule-task-payment-1dqk05`

3社目の設置。手順の土台は
[`examples/prime-office-board-supabase/SETUP.md`](../../../examples/prime-office-board-supabase/SETUP.md)、
追加機能は
[`addons/line/README.md`](../../../examples/prime-office-board-supabase/addons/line/README.md)。
開発の決まりごとは
[`prime-office-board-HANDOVER.md`](../../../examples/prime-office-board-HANDOVER.md)。

---

## 1. 何のために作るか

しろspa（ナディア滋賀店）の事務所で、打ち合わせ日・面接費・やることの進み具合を
1か所で見られるようにする。あわせて、本部がスタッフの契約書とシフトを決められるようにする。

PRIME と藤澤家に続く3つ目。**1社＝1 Supabase プロジェクト**の方針は変えない。

## 2. 決まっていること（ユーザーの回答）

| 聞いたこと | 答え |
|---|---|
| LINE 機能 | 使う |
| ログイン | メールとパスワード **または** LINE のどちらでも入れる |
| LINE で入れるのは誰か | **本部メンバーだけ。** 拠点スタッフは今までどおり専用 URL ＋4桁の暗証番号 |
| 「進捗度の共有」とは | **やることの進捗。** 今の3段階（未着手・着手中・完了）を**割合でも見せたい** |
| 契約書の持ち方 | **リンクだけ。** 実体は他（Google ドライブなど）に置き、ボードには URL と状態 |
| 打ち合わせ日・面接費・シフト | 既存の仕組みで足りる（下記3章） |

## 3. すでにあるので作らないもの

調べた結果、ユーザーの要望のうち3つは既存機能で足りる。**作り直さない。**

| 要望 | 既存のどこ |
|---|---|
| 打ち合わせ日の共有 | `notices` の `kind = 'meeting'`（`date` / `at_time` / `place` / `decided`）。`20260913014336` |
| 面接費の共有 | `payments`（`title` / `payee` / `amount` / `due` / `status` / `note`）。面接費は1件の支払いとして入れる |
| スタッフのシフト | `staff_shifts`（スタッフ×日付、`work` / `off` / `undecided` と時刻）。RLS で**本部は全拠点分を書ける**（`20260907131336`）。画面は拠点の詳細にある（`app.js` の `edit-shift` / `save-shift`） |

## 4. 作るもの

PRIME と共通の `app.js` / `index.html` に足す。**PRIME の見た目と動きは変えない。**
新しいものはすべて `config.js` の設定で開く（PRIME は設定が無いので一切動かない）。
藤澤家も、新しい設定を足さない限り今のまま。

### 4-1. 併用ログイン（本部メンバー）

いまは `viewAuth()` の先頭が `if (LINE_LOGIN) return viewAuthLine();` で、
LINE ログインを入れると**メールの画面が消える**（藤澤家がこれ）。

しろspa は両方出す。新しい設定 **`lineLoginOptional: true`** を足し、
`lineLogin` と同時に入っているときだけ、1枚の画面に

- メールアドレスとパスワードの欄（今の `viewAuth()` の中身そのまま）
- その下に区切りと「LINEでログイン」のボタン（今の `viewAuthLine()` のボタン）
- 招待コードの欄は1つを共用（どちらの道でも同じコードを使う）

を並べる。`lineLoginOptional` が無ければ今の振る舞い（LINE だけ／メールだけ）のまま。

**同じ人が2つのアカウントを持ってしまう問題**への答え：

- メールで登録した本部メンバーは、「設定」から**LINE を連携**できる（`line_links` に行を作る）。
  連携すると通知とリマインダーが LINE に届く。アカウントは1つのまま
- 連携していない LINE で入ろうとした人は、**新規登録**として扱う（招待コードが要る）。
  ここで別アカウントができるのは避けられないので、画面に
  「メールで登録済みの方は、メールで入ってから『設定』で LINE を連携してください」と出す

### 4-2. 契約書（リンクだけ）

新しい表 **`public.staff_contracts`**。

```sql
create table if not exists public.staff_contracts (
  staff_id   uuid primary key references public.staff(id) on delete cascade,
  site_id    uuid not null references public.sites(id) on delete cascade,
  url        text not null default '',
  status     text not null default 'none'
             check (status in ('none', 'sent', 'signed')),
  note       text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members(id) on delete set null
);
```

**`staff` に列を足さない**のは意図的。`staff` は `pin`（4桁の暗証番号）を
隠すために表単位の権限を剥がして列ごとに grant し直してある
（HANDOVER 5章）。ここに列を足すと、その作業をやり直すことになり、
`pin` が漏れる形に戻しかねない。別の表なら RLS を独立して書ける。

RLS：

- 読み：本部は全部。スタッフは**自分の行だけ**（`staff_id = public.staff_me()`）。
  他人の契約書は拠点が同じでも見えない
- 書き：**本部だけ**（`public.is_member()`）。店長も書けない

状態の呼び方は `none` → 「未送付」、`sent` → 「送付済み」、`signed` → 「締結済み」。
**この3段階は私が決めた**。増やしたければ check 制約と表示名の2か所。

画面：拠点の詳細のスタッフ一覧で、各スタッフの行に状態を出す。本部が開くと
URL・状態・メモを書ける小窓。スタッフが自分の画面で見ると、自分の契約書の
リンクと状態だけが読める。設定 **`contracts: true`** で出す。

### 4-3. やることの進捗を割合で

`tasks` の `status`（`open` / `doing` / `done`）はそのまま。表示だけ足す。

やることタブの頭とホームに「**10件中6件完了（60%）**」の1行と細い帯を出す。
数えるのは**その人に見えているやること**（`share` / `shared_with` / `open_sites` の
絞り込みを通ったあと）。見えない件数を混ぜると、合計が人によって違う理由が
分からなくなるため。期限切れだけを別に数えることはしない（今の一覧で色が付く）。

設定 **`taskProgress: true`** で出す。DB の変更は無い。

## 5. 設置の手順（SETUP.md のとおり）

1. Supabase の新規プロジェクト。名前 `shirospa-board`、**Tokyo (ap-northeast-1)**
2. `migrations/` の35本を順に
3. `addons/line/01` → `02` → `03`
4. 4-2 の `staff_contracts`（新しい SQL を `addons/` に置く）
5. Edge Function 4つ：`staff-login`・`push`・`line-login`（`verify_jwt` 有効）、
   `line-webhook`（**`verify_jwt` 無効**）
6. `push_config` に `function_url` と `anon_key`
7. `line_config` に `login_channel_id`・`oa_basic_id`・`board_url`
8. `init-new-company.sql` → 招待コードが出る（**公開前に**）
9. `config.shirospa.js` を足し、Render の Build Command を
   `sh examples/prime-office-board-web/build-site.sh shirospa` にする
10. 最初の1人を登録（`members` が空のあいだは招待コード不要）

`config.shirospa.js` の中身：

```js
window.BOARD_CONFIG = {
  supabaseUrl: "https://<新しいプロジェクトID>.supabase.co",
  supabaseKey: "<sb_publishable_...>",
  brand: "しろspa",
  brandSub: "事務所ボード",
  support: "",
  lineLogin: "<LINE ログインのチャネル ID>",
  lineOaId: "<公式アカウントの ID>",
  lineLoginOptional: true,   // 4-1
  contracts: true,           // 4-2
  taskProgress: true,        // 4-3
  reminders: true
};
```

## 6. ユーザーにしかできないこと

ここが終わらないと LINE では入れない（メールとパスワードでは入れる）。

- **LINE のチャネルを2つ作る**（しろspa 専用。藤澤家のものは使い回さない）
  - LINE ログイン チャネル → コールバック URL にボードの URL、公式アカウントをひも付け、**公開**に
  - Messaging API チャネル → Webhook URL に
    `https://<プロジェクトID>.supabase.co/functions/v1/line-webhook`、応答メッセージをオフ
- **Supabase の Secrets に3つ入れる**（会話にも リポジトリにも書かない）
  `LINE_LOGIN_CHANNEL_SECRET` / `LINE_MESSAGING_TOKEN` / `LINE_MESSAGING_SECRET`
- **最初の管理者の登録**（最初に URL を開いた人が管理者になる）
- **個人情報の取り扱いの本文**（`PRIVACY.md` の〈 〉を埋める）

## 7. 先に言っておくこと（判断はユーザー）

- **Supabase の組織が「藤澤家」しか見えない。** しろspa のデータが家族名義の
  無料組織に入る。無料なので**自動バックアップが無く、7日使われないと止まる**。
  いまこの組織にプロジェクトが3つ（2つは停止中）あり、4つ目が作れるかは試すまで分からない
- **LINE 公式アカウントの無料枠は月200通**（1人1通で1）
- Render は無料枠25サービスの上限がある（藤澤家のときに1度詰まった）

## 8. やらないこと

- PRIME の本番（`ixsycdkazorljshjejcz`、`prime-office-board.onrender.com`）に触る
- 1つのプロジェクトを2社で共用する
- 面接費・打ち合わせ・シフトを作り直す（3章のとおり既にある）
- 契約書の実体（PDF）をボードに置く（リンクだけ、というユーザーの選択）
- `service_role` の鍵を `config.js` に書く
