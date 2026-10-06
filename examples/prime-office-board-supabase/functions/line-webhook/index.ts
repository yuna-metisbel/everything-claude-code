// 公式アカウントに送られたメッセージを受け取り、要望・感想として残す。
//
// LINE Developers の Messaging API 設定で、Webhook URL をこの関数にする。
// LINE からの呼び出しには JWT が付かないので verify_jwt は外して置き、
// 代わりに X-Line-Signature（チャネルシークレットで作った HMAC）で本物かを確かめる。
//
// Secrets（導入する人がダッシュボードで入れる）：
//   LINE_MESSAGING_SECRET … Messaging API チャネルの「チャネルシークレット」
//   LINE_MESSAGING_TOKEN  … 返事を送るのに使う（通知と同じもの）
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function validSignature(raw: string, sig: string, secret: string): Promise<boolean> {
  if (!sig || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expect = btoa(String.fromCharCode(...mac));
  // 長さを揃えて1文字ずつ比べ、どこまで合っていたかが時間に出ないようにする。
  if (expect.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function reply(token: string, text: string) {
  const access = Deno.env.get("LINE_MESSAGING_TOKEN") || "";
  if (!access || !token) return;
  // 返事（reply）は無料枠の通数に数えられない。
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
    body: JSON.stringify({ replyToken: token, messages: [{ type: "text", text }] }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const ok = await validSignature(raw, req.headers.get("x-line-signature") || "",
    Deno.env.get("LINE_MESSAGING_SECRET") || "");
  if (!ok) {
    console.error("line webhook: signature mismatch");
    return new Response("forbidden", { status: 403 });
  }

  let body: { events?: Array<Record<string, any>> } = {};
  try { body = JSON.parse(raw); } catch { /* 空でもよい（LINE の接続確認は events が空） */ }

  for (const ev of body.events ?? []) {
    if (ev.type === "follow") {
      await reply(ev.replyToken, "友だち追加ありがとうございます。\n予定やリマインダーをここにお知らせします。\n" +
        "ボードへの要望や使い勝手の感想は、このトークに送ってください。");
      continue;
    }
    if (ev.type !== "message") continue;
    const lineUserId = String(ev.source?.userId || "");
    if (ev.message?.type !== "text") {
      await reply(ev.replyToken, "要望・感想は文字で送ってください。");
      continue;
    }
    const text = String(ev.message.text || "").trim().slice(0, 2000);
    if (!text) continue;

    const { data: link } = await db.from("line_links").select("user_id, display_name")
      .eq("line_user_id", lineUserId).maybeSingle();
    let memberId: string | null = null;
    if (link?.user_id) {
      const { count } = await db.from("members").select("id", { count: "exact", head: true }).eq("id", link.user_id);
      if (count) memberId = link.user_id;
    }
    const { error } = await db.from("feedback").insert({
      line_user_id: lineUserId, member_id: memberId,
      sender_name: link?.display_name || "", body: text,
    });
    if (error) console.error("line webhook: insert failed", error.message);
    await reply(ev.replyToken, error
      ? "ごめんなさい、うまく受け取れませんでした。少し時間をおいてもう一度送ってください。"
      : "ありがとうございます。要望・感想として受け取りました。");
  }
  return new Response("ok");
});
