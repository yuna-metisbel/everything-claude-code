// LINE でログインする。
//
// 画面は LINE の許可画面から戻ってきた code をここに渡すだけ。チャネルシークレットは
// ここ（Edge Function の Secrets）にしか無いので、code と引き換えに LINE の利用者 ID を
// 確かめられるのはサーバー側だけになる。確かめたら、その人の Supabase 認証ユーザーを
// 引き当てて（初回は作って）、staff-login と同じく1回だけ使えるトークンを返す。
//
// Secrets（導入する人がダッシュボードで入れる）：
//   LINE_LOGIN_CHANNEL_SECRET … LINE ログイン チャネルのチャネルシークレット
// チャネル ID は秘密ではないので line_config 表に置く。
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

// 実際にメールを送ることはない。LINE の利用者ごとに認証ユーザーを1人作るための宛先。
const emailFor = (lineUserId: string) => `line-${lineUserId.toLowerCase()}@line.board.invalid`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: { code?: string; redirectUri?: string; nonce?: string; inviteCode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "入力を読み取れませんでした" }, 400);
  }
  const code = String(body.code || "");
  const redirectUri = String(body.redirectUri || "");
  const nonce = String(body.nonce || "");
  const inviteCode = String(body.inviteCode || "").trim();
  if (!code || !redirectUri || !nonce) return json({ error: "LINE からの戻り値が足りません" }, 400);

  const secret = Deno.env.get("LINE_LOGIN_CHANNEL_SECRET") || "";
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: cfg } = await admin.from("line_config").select("login_channel_id").eq("id", 1).maybeSingle();
  const channelId = cfg?.login_channel_id || "";
  if (!secret || !channelId) return json({ error: "LINE ログインの設定がまだ済んでいません" }, 500);

  // code をトークンに換える。redirect_uri は許可画面に渡したものと一字一句同じでないと断られる。
  const tok = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri,
      client_id: channelId, client_secret: secret,
    }),
  });
  const tj = await tok.json().catch(() => ({}));
  if (!tok.ok || !tj.id_token) {
    // 理由はログにだけ出す（code やシークレットは出さない）。
    console.error("line token exchange failed", tok.status, tj.error, tj.error_description);
    return json({ error: "LINE でのログインを確かめられませんでした。もう一度お試しください", detail: tj.error_description || tj.error || tok.status }, 401);
  }

  // ID トークンの署名・宛先・nonce は LINE 側で確かめてもらう。
  const ver = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: tj.id_token, client_id: channelId, nonce }),
  });
  const vj = await ver.json().catch(() => ({}));
  if (!ver.ok || !vj.sub) {
    console.error("line id_token verify failed", ver.status, vj.error, vj.error_description);
    return json({ error: "LINE でのログインを確かめられませんでした。もう一度お試しください", detail: vj.error_description || ver.status }, 401);
  }
  const lineUserId = String(vj.sub);
  const displayName = String(vj.name || "").slice(0, 40);

  const email = emailFor(lineUserId);
  let userId: string | null = null;
  const found = await admin.rpc("staff_auth_id_by_email", { p_email: email });
  userId = (found.data as string | null) || null;

  if (!userId) {
    const made = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: crypto.randomUUID() + crypto.randomUUID(),
      user_metadata: { invite_code: inviteCode, line_name: displayName },
    });
    userId = made.data?.user?.id || null;
    if (!userId) return json({ error: "ログインを作成できませんでした" }, 500);
  } else if (inviteCode) {
    // まだ本部の一員になっていない人が、正しいコードを入れ直して来たときのため。
    const { count } = await admin.from("members").select("id", { count: "exact", head: true }).eq("id", userId);
    if (!count) {
      await admin.auth.admin.updateUserById(userId, {
        user_metadata: { invite_code: inviteCode, line_name: displayName },
      });
    }
  }

  await admin.from("line_links").upsert({
    user_id: userId, line_user_id: lineUserId, display_name: displayName,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) return json({ error: "ログインを発行できませんでした" }, 500);

  return json({ tokenHash, name: displayName });
});
