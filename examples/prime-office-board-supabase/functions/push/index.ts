// スマホへの通知（Web Push）を送る役。
//
// 送信鍵（VAPID）はこの中で作って push_config に置く。人の手で貼らないので、
// 会話にもリポジトリにも鍵が出ない。push_config は RLS を有効にしたうえで
// ポリシーを1つも置いていないので、service_role 以外からは1行も見えない。
//
//   { action: "key"  }            … 購読に必要な公開鍵を返す（ログイン済みなら誰でも）
//   { action: "send", ... }       … 実際に送る（service_role か、DB が持つ合言葉）
//
// 送信を名乗りなしで通すと、誰でも全員の端末を鳴らせてしまう。
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

// 鍵が無ければ作って入れる。以降はそれを使い回す。
async function vapid(): Promise<{ publicKey: string; privateKey: string }> {
  const { data } = await db.from("push_config").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (data?.public_key && data?.private_key) {
    return { publicKey: data.public_key, privateKey: data.private_key };
  }
  const made = webpush.generateVAPIDKeys();
  await db.from("push_config").upsert({
    id: 1, public_key: made.publicKey, private_key: made.privateKey, updated_at: new Date().toISOString(),
  });
  return made;
}

// 呼び出し元が service_role か。JWT はプラットフォーム側で検証済みなので、
// ここでは中身の role だけを見る。
function isService(req: Request): boolean {
  const raw = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const part = raw.split(".")[1];
  if (!part) return false;
  try {
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)));
    return claims.role === "service_role";
  } catch { return false; }
}

// DB（pg_net）から呼ぶときは service_role の鍵を SQL に置きたくないので、
// push_config の合言葉で名乗る。長さを揃えて1文字ずつ比べ、
// 何文字目まで合っていたかが時間に出ないようにする。
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 空でもよい */ }
  const action = String(body.action || "key");

  const keys = await vapid();
  if (action === "key") return json({ publicKey: keys.publicKey });

  if (action !== "send") return json({ error: "unknown action" }, 400);
  const { data: cfg } = await db.from("push_config").select("send_secret").eq("id", 1).maybeSingle();
  const named = isService(req) ||
    sameSecret(req.headers.get("x-push-secret") || "", cfg?.send_secret || "");
  if (!named) return json({ error: "forbidden" }, 403);

  const title = String(body.title || "PRIME 事務所ボード");
  const text = String(body.text || "");
  const url = String(body.url || "/");
  const tag = String(body.tag || "");

  // 同じ知らせを二度鳴らさない。tag を一意キーにしてあるので、
  // 2回目の insert は必ず失敗し、そこで止まる。
  if (tag) {
    const { error } = await db.from("push_log").insert({ tag, title });
    if (error) return json({ skipped: "already sent", tag });
  }

  const only = Array.isArray(body.members) ? body.members as string[] : null;
  let q = db.from("push_subs").select("id, endpoint, p256dh, auth");
  if (only && only.length) q = q.in("member_id", only);
  const { data: subs } = await q;

  webpush.setVapidDetails("mailto:office@prime.example", keys.publicKey, keys.privateKey);
  const payload = JSON.stringify({ title, text, url, tag });

  let ok = 0;
  const dead: string[] = [];
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      ok += 1;
    } catch (e) {
      // 404 / 410 は、その端末がもう受け取らないという意味。消してよい。
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
    }
  }
  if (dead.length) await db.from("push_subs").delete().in("id", dead);

  // LINE にも送る（addons/line を入れたボードだけ。鍵が無ければ何もしない）。
  // 無料枠は月200通で、1人に1通が1と数えられる。宛先を絞るのは呼ぶ側（DB）の仕事で、
  // ここでは本人が「受け取らない」にした種類を外すだけ。
  const lineToken = Deno.env.get("LINE_MESSAGING_TOKEN") || "";
  let lineOk = 0, lineTotal = 0;
  if (lineToken) {
    const kind = String(body.kind || "updates");
    let lq = db.from("line_links").select("user_id, line_user_id, notify");
    if (only && only.length) lq = lq.in("user_id", only);
    const { data: links } = await lq;
    const { data: lc } = await db.from("line_config").select("board_url").eq("id", 1).maybeSingle();
    const msg = [title, text, lc?.board_url || ""].filter(Boolean).join("\n").slice(0, 4900);
    for (const l of links ?? []) {
      if (l.notify && l.notify[kind] === false) continue;
      lineTotal += 1;
      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${lineToken}` },
        body: JSON.stringify({ to: l.line_user_id, messages: [{ type: "text", text: msg }] }),
      });
      if (res.ok) lineOk += 1;
    }
  }

  const total = (subs?.length ?? 0) + lineTotal;
  if (tag) await db.from("push_log").update({ ok_count: ok + lineOk, fail_count: total - ok - lineOk }).eq("tag", tag);

  return json({ sent: ok, removed: dead.length, total: subs?.length ?? 0, line: lineOk, lineTotal });
});
