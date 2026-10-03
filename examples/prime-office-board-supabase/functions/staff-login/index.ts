// スタッフの「名前＋暗証番号」ログイン。
//
// 暗証番号は本部が確認できる必要があるので、戻せる形（平文）で持っている。
// 4桁は候補が1万通りしかなく、bcrypt にしても総当たりは一瞬で終わるため、
// ハッシュ化しても「テーブルを読めた相手」への守りにはならない。実際の守りは、
// pin 列をクライアントから読めなくしていること、照合をここ（service_role）だけで
// 行うこと、5回失敗で10分ロックすることの3つ。
// 照合に通ったときだけ Supabase のマジックリンクを1回ぶん発行して通常のセッションに
// 引き換えてもらうので、以降のデータアクセスはすべて普通の RLS で守れる。
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

// 実際にメールを送ることはない。認証ユーザーを1人ずつ作るためだけの宛先。
const emailFor = (staffId: string) => `staff-${staffId}@staff.prime-office-board.invalid`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: { code?: string; staffId?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "入力を読み取れませんでした" }, 400);
  }
  const code = String(body.code || "").trim().toLowerCase();
  const staffId = String(body.staffId || "").trim();
  const pin = String(body.pin || "").trim();
  if (!code || !staffId || !/^[0-9]{4}$/.test(pin)) {
    return json({ error: "暗証番号は数字4桁です" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 入り口コードと、そのスタッフが本当にその拠点の人かを先に照合する。
  const gate = await admin.rpc("site_gate", { p_code: code });
  if (gate.error) return json({ error: "入り口を確認できませんでした" }, 500);
  const site = gate.data as { id?: string; staff?: { id: string }[] };
  if (!site?.id) return json({ error: "この入り口はいま使えません" }, 403);
  if (!(site.staff || []).some((s) => s.id === staffId)) {
    return json({ error: "この入り口の名簿にありません" }, 403);
  }

  const check = await admin.rpc("staff_check_pin", { p_staff: staffId, p_pin: pin });
  if (check.error) return json({ error: "照合できませんでした" }, 500);
  const res = check.data as { ok: boolean; reason?: string; authUserId?: string | null };
  if (!res.ok) {
    if (res.reason === "locked") {
      return json({ error: "暗証番号を続けて間違えたため、10分間ロックしました" }, 429);
    }
    if (res.reason === "nopin") {
      return json({ error: "暗証番号がまだ発行されていません。本部に連絡してください" }, 403);
    }
    return json({ error: "暗証番号が違います" }, 401);
  }

  // 拠点ごとの認証ユーザーを初回ログイン時に1人分だけ作る。
  const email = emailFor(staffId);
  let authUserId = res.authUserId || null;
  if (!authUserId) {
    const made = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: crypto.randomUUID() + crypto.randomUUID(),
      user_metadata: { staff_id: staffId, site_code: code },
    });
    authUserId = made.data?.user?.id || null;
    if (!authUserId) {
      // staff 行の紐づけだけが外れている場合（作り直しなど）は拾い直す。
      const again = await admin.rpc("staff_auth_id_by_email", { p_email: email });
      authUserId = (again.data as string | null) || null;
    }
    if (!authUserId) return json({ error: "ログインを作成できませんでした" }, 500);
  }
  await admin.rpc("staff_mark_login", { p_staff: staffId, p_auth: authUserId });

  // 1回だけ使えるトークンを返す。ブラウザ側が verifyOtp でセッションに換える。
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) return json({ error: "ログインを発行できませんでした" }, 500);

  return json({ email, tokenHash });
});
