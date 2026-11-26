// 親のボード（リーブルゲート）から、このボードへ入るための窓口。
//
// 相手のボードのログイン証明（access_token）を見せてもらい、
//   1. 相手の Supabase に「この証明は本物か」を聞く
//   2. 同じ証明で相手の members 行を1行だけ読む
// の2つで判定する。2 が読めるのは相手のボードの本部メンバーだけ（members_select の
// 決まりがそうなっている）なので、行があればその人は本部メンバーだと確かめられる。
// 名前と色も同じ読みで手に入るので、こちら側の名簿にそのまま写す。
//
// 通れば、このボードの認証ユーザーを1人ぶん用意して、1回だけ使える
// トークンを返す。ブラウザ側が verifyOtp でセッションに換える
// （スタッフの暗証番号ログインや LINE ログインと同じ作り）。
//
// データベースは行き来しない。相手から読むのは members の1行だけ。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// 親のボード（リーブルゲート）。どちらも公開してよい値（ブラウザの config.js にも載っている）。
// Secrets に同じ名前を入れれば、そちらが優先される。
const PARTNER_URL = Deno.env.get("PARTNER_URL") ||
  "https://zdctkdchovarrkxbrvsr.supabase.co";
const PARTNER_ANON = Deno.env.get("PARTNER_ANON") ||
  "sb_publishable_2ndYlIweQHcyBHl4kzAZUA_GxCoWFSg";

// 実際にメールを送ることはない。認証ユーザーを1人ずつ作るためだけの宛先。
const emailFor = (partnerId: string) =>
  `lg-${partnerId}@partner.prime-office-board.invalid`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "入力を読み取れませんでした" }, 400);
  }
  const token = String(body.token || "").trim();
  if (!token) return json({ error: "ログインの証明がありません" }, 400);

  const partnerHeaders = { apikey: PARTNER_ANON, Authorization: `Bearer ${token}` };

  // 1. その証明が本物かどうかを、相手の Supabase に聞く。
  let partnerId = "";
  try {
    const who = await fetch(`${PARTNER_URL}/auth/v1/user`, { headers: partnerHeaders });
    if (!who.ok) {
      return json({ error: "リーブルゲートのログインを確認できませんでした。入り直してください" }, 401);
    }
    const user = await who.json();
    partnerId = String(user?.id || "");
  } catch {
    return json({ error: "リーブルゲートにつながりませんでした" }, 502);
  }
  if (!UUID.test(partnerId)) {
    return json({ error: "リーブルゲートのログインを確認できませんでした。入り直してください" }, 401);
  }

  // 2. 同じ証明で members を1行だけ読む。読めたら本部メンバー。
  let name = "";
  let color = "";
  try {
    const mem = await fetch(
      `${PARTNER_URL}/rest/v1/members?id=eq.${partnerId}&select=name,color`,
      { headers: partnerHeaders },
    );
    if (!mem.ok) return json({ error: "リーブルゲートの名簿を読めませんでした" }, 502);
    const rows = await mem.json();
    if (!Array.isArray(rows) || !rows.length) {
      return json({ error: "リーブルゲートの本部メンバーだけが入れます" }, 403);
    }
    name = String(rows[0]?.name || "").trim();
    color = String(rows[0]?.color || "").trim();
  } catch {
    return json({ error: "リーブルゲートにつながりませんでした" }, 502);
  }
  if (!name) name = "リーブルゲート";

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 3. こちら側の認証ユーザー。初回だけ作る（2回目以降は作成が失敗するが、それでよい）。
  const email = emailFor(partnerId);
  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID() + crypto.randomUUID(),
    user_metadata: { partner: "libregate", partner_user_id: partnerId },
  });

  // 1回だけ使えるトークン。ここで返るユーザーが、作ったばかりでも既にいた人でも同じ。
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;
  const userId = link.data?.user?.id || "";
  if (link.error || !tokenHash || !userId) {
    return json({ error: "入場券を発行できませんでした" }, 500);
  }

  // 4. こちらの名簿。名前と色は毎回あちらに合わせる（向こうで変えたらこちらも変わる）。
  const row: Record<string, unknown> = { id: userId, name };
  if (/^#[0-9a-f]{3,8}$/i.test(color)) row.color = color;
  const up = await admin.from("members").upsert(row, { onConflict: "id" });
  if (up.error) return json({ error: "名簿に入れませんでした" }, 500);

  return json({ tokenHash });
});
