/* PRIME 事務所ボード — staff shared board (Supabase build) */
(function(){
"use strict";

const SUPABASE_URL = "https://ixsycdkazorljshjejcz.supabase.co";
const SUPABASE_KEY = "sb_publishable_GwiqO3s7SeG6MkmRa5bI0A_-kX7twCN";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ============================ helpers ============================ */
const $ = (s, r) => (r || document).querySelector(s);
const el = id => document.getElementById(id);
const h = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => ymd(new Date());
const nowIso = () => new Date().toISOString();
const DOW = ["日","月","火","水","木","金","土"];
const daysInMonth = ym => { const p = ym.split("-").map(Number); return new Date(p[0], p[1], 0).getDate(); };
const dow = (ym, d) => { const p = ym.split("-").map(Number); return new Date(p[0], p[1] - 1, d).getDay(); };
const md = s => s ? (Number(s.slice(5,7)) + "/" + Number(s.slice(8,10))) : "";
const yen = n => "¥" + Number(n || 0).toLocaleString("ja-JP");
const stamp = iso => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return "";
  return (ymd(d) === today() ? "" : (d.getMonth()+1) + "/" + d.getDate() + " ") + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
function daysUntil(dateStr){
  if (!dateStr) return null;
  const a = new Date(today() + "T00:00:00"), b = new Date(dateStr + "T00:00:00");
  if (isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}
function ls(k, v){
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch(e){}
  return null;
}
const PALETTE = ["#9C6C1F","#3E6497","#2C7A5B","#A63244","#6B4E8F","#B0670F","#2F7E86","#8A5A3B"];
const KINDS = { work:{ label:"出勤", cls:"k-work", chip:"brass" }, off:{ label:"公休", cls:"k-off", chip:"bad" },
                half:{ label:"半休", cls:"k-half", chip:"warn" }, "":{ label:"未定", cls:"", chip:"" } };
const MEDIA_PRESETS = ["シティヘブンネット","エステ魂","メンエス魂","リフナビ","メンズエステ求人","エステの達人","X (旧Twitter)","公式LINE","Instagram","Googleビジネス","予約システム","勤怠システム"];

/* ============================ state ============================ */
const S = {
  user: null, me: null, ready: false, screen: "loading",
  members: [], office: { doorOpen:false }, sched: {}, tasks: [], payments: [], vault: [],
  vaultCfg: null, allowed: [],
  month: today().slice(0, 7), tab: ls("prime.tab") || "home",
  key: null, vaultErr: "", authErr: "", authMode: "in", busy: false,
  taskFilter: "all", payFilter: "unpaid", reveal: {}, draftColor: PALETTE[0]
};
const member = id => S.members.find(m => m.id === id) || null;
const meName = () => (S.me ? S.me.name : "");
const dayOf = (memberId, date) => S.sched[memberId + "|" + date] || null;

function toast(msg){
  const r = el("toastRoot");
  r.innerHTML = '<div class="toast">' + h(msg) + "</div>";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { r.innerHTML = ""; }, 2600);
}
function fail(error, fallback){
  const msg = error && error.message ? error.message : "";
  if (/row-level security|violates row-level/i.test(msg)) return "この操作を行う権限がありません。";
  if (/duplicate key/i.test(msg)) return "同じ内容がすでに登録されています。";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "通信に失敗しました。電波の良い場所で再度お試しください。";
  return fallback || (msg || "保存に失敗しました。もう一度お試しください。");
}
async function run(promise, okMsg){
  const res = await promise;
  if (res && res.error){ toast(fail(res.error)); throw res.error; }
  if (okMsg) toast(okMsg);
  return res;
}

/* ============================ crypto (媒体アカウント) ============================ */
const TE = new TextEncoder(), TD = new TextDecoder();
const b64 = buf => { const b = new Uint8Array(buf); let s = ""; for (let i=0;i<b.length;i++) s += String.fromCharCode(b[i]); return btoa(s); };
const ub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const VERIFY_TOKEN = "PRIME-VAULT-V1";
async function deriveKey(pass, saltB64){
  const km = await crypto.subtle.importKey("raw", TE.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name:"PBKDF2", salt: ub64(saltB64), iterations: 250000, hash:"SHA-256" },
    km, { name:"AES-GCM", length:256 }, false, ["encrypt","decrypt"]);
}
async function sealJson(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name:"AES-GCM", iv: iv }, key, TE.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function openJson(key, blob){
  const pt = await crypto.subtle.decrypt({ name:"AES-GCM", iv: ub64(blob.iv) }, key, ub64(blob.ct));
  return JSON.parse(TD.decode(pt));
}
async function copy(text, what){
  try { await navigator.clipboard.writeText(text); toast((what || "") + "をコピーしました"); }
  catch(e){ toast("コピーできませんでした。長押しで選択してください。"); }
}

/* ============================ data ============================ */
const normMember = r => ({ id:r.id, name:r.name, color:r.color, present:r.present, presentAt:r.present_at });
const normTask   = r => ({ id:r.id, title:r.title, detail:r.detail, assignee:r.assignee, status:r.status,
                           due:r.due, createdBy:r.created_by, createdAt:r.created_at, takenAt:r.taken_at, doneAt:r.done_at });
const normPay    = r => ({ id:r.id, title:r.title, payee:r.payee, amount:Number(r.amount), due:r.due, method:r.method,
                           assignee:r.assignee, status:r.status, note:r.note, paidAt:r.paid_at, createdAt:r.created_at });
const normDay    = r => ({ memberId:r.member_id, date:r.date, kind:r.kind, plan:r.plan,
                           ngFrom:r.ng_from, ngTo:r.ng_to, note:r.note });

async function loadAll(){
  const from = S.month + "-01";
  const to = S.month + "-" + pad(daysInMonth(S.month));
  const [mem, off, sch, tsk, pay, vlt, vcf, alw] = await Promise.all([
    sb.from("members").select("*").order("created_at"),
    sb.from("office").select("*").eq("id", 1).maybeSingle(),
    sb.from("schedule").select("*").gte("date", from).lte("date", to),
    sb.from("tasks").select("*"),
    sb.from("payments").select("*"),
    sb.from("vault").select("*"),
    sb.from("vault_config").select("*").eq("id", 1).maybeSingle(),
    sb.from("allowed_emails").select("*").order("email")
  ]);
  if (mem.data) S.members = mem.data.map(normMember);
  if (off.data) S.office = { doorOpen: off.data.door_open, updatedBy: off.data.updated_by, updatedAt: off.data.updated_at };
  S.sched = {};
  (sch.data || []).forEach(r => { S.sched[r.member_id + "|" + r.date] = normDay(r); });
  if (tsk.data) S.tasks = tsk.data.map(normTask);
  if (pay.data) S.payments = pay.data.map(normPay);
  if (vlt.data) S.vault = vlt.data;
  S.vaultCfg = vcf.data || null;
  S.allowed = alw.data || [];
  S.me = S.members.find(m => m.id === (S.user && S.user.id)) || null;
}

let reloadTimer = null;
function scheduleReload(){
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { loadAll().then(render).catch(() => {}); }, 250);
}
function subscribeLive(){
  const ch = sb.channel("board");
  ["members","office","schedule","tasks","payments","vault","vault_config","allowed_emails"].forEach(t => {
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, scheduleReload);
  });
  ch.subscribe();
}

/* ============================ auth ============================ */
async function boot(){
  const { data } = await sb.auth.getSession();
  S.user = data && data.session ? data.session.user : null;
  sb.auth.onAuthStateChange(function(_e, session){
    const next = session ? session.user : null;
    const changed = (next && next.id) !== (S.user && S.user.id);
    S.user = next;
    if (changed){ S.key = null; S.reveal = {}; refresh(); }
  });
  await refresh();
  subscribeLive();
}
async function refresh(){
  if (!S.user){ S.screen = "auth"; S.ready = true; render(); return; }
  try { await loadAll(); } catch(e){ /* rendered as empty below */ }
  S.screen = S.me ? "app" : "profile";
  S.ready = true;
  render();
}
async function signIn(){
  const email = valOf("au_email"), pw = valOf("au_pw");
  if (!email || !pw){ S.authErr = "メールアドレスとパスワードを入力してください。"; render(); return; }
  S.busy = true; S.authErr = ""; render();
  const { error } = await sb.auth.signInWithPassword({ email: email, password: pw });
  S.busy = false;
  if (error){
    S.authErr = /Invalid login/i.test(error.message)
      ? "メールアドレスかパスワードが違います。"
      : /Email not confirmed/i.test(error.message)
      ? "このメールアドレスはまだ許可されていません。管理者に「設定」タブから追加してもらってください。"
      : error.message;
    render(); return;
  }
  await refresh();
}
async function signUp(){
  const email = valOf("au_email"), pw = valOf("au_pw");
  if (!email || pw.length < 8){ S.authErr = "メールアドレスと、8文字以上のパスワードを入力してください。"; render(); return; }
  S.busy = true; S.authErr = ""; render();
  const { data, error } = await sb.auth.signUp({ email: email, password: pw });
  S.busy = false;
  if (error){
    S.authErr = /already registered/i.test(error.message)
      ? "このメールアドレスは登録済みです。「ログイン」から入ってください。"
      : error.message;
    render(); return;
  }
  if (!data.session){
    // The address is confirmed on insert when it is allow-listed, so signing in
    // right away works even though sign-up did not hand back a session.
    S.busy = true; render();
    const retry = await sb.auth.signInWithPassword({ email: email, password: pw });
    S.busy = false;
    if (retry.error){
      S.authMode = "in";
      S.authErr = "アカウントを作成しました。このままログインしてください。入れない場合は、管理者にメールアドレスの登録を確認してもらってください。";
      render(); return;
    }
  }
  await refresh();
}
async function createProfile(){
  const name = valOf("pf_name");
  if (!name){ S.authErr = "名前を入力してください。"; render(); return; }
  S.busy = true; S.authErr = ""; render();
  const { error } = await sb.from("members").insert({ id: S.user.id, name: name, color: S.draftColor });
  S.busy = false;
  if (error){
    S.authErr = /row-level security|violates row-level/i.test(error.message)
      ? "このメールアドレスはまだ許可されていません。管理者に「設定」タブから追加してもらってください。"
      : error.message;
    render(); return;
  }
  await refresh();
}
async function signOut(){ await sb.auth.signOut(); S.key = null; S.reveal = {}; await refresh(); }
const valOf = id => { const n = el(id); return n ? n.value.trim() : ""; };

/* ============================ render: shell ============================ */
const TABS = [
  { id:"home",   label:"ホーム" },
  { id:"sched",  label:"スケジュール" },
  { id:"tasks",  label:"タスク" },
  { id:"pay",    label:"支払い" },
  { id:"vault",  label:"媒体アカウント" },
  { id:"set",    label:"設定" }
];
const openTasks = () => S.tasks.filter(t => t.status !== "done");
const wantedTasks = () => openTasks().filter(t => !t.assignee);
const unpaid = () => S.payments.filter(p => p.status !== "paid");

function render(){
  const chrome = S.screen === "app";
  el("masthead").hidden = !chrome;
  el("tabsNav").hidden = !chrome;
  const v = el("view");
  if (!S.ready){ v.innerHTML = '<p class="empty" style="border:0">読み込み中…</p>'; return; }
  if (S.screen === "auth"){ v.className = ""; v.innerHTML = viewAuth(); return; }
  if (S.screen === "profile"){ v.className = ""; v.innerHTML = viewProfile(); return; }
  v.className = "wrap";
  renderDoor(); renderHere(); renderTabs();
  v.innerHTML = S.tab === "sched" ? viewSched()
    : S.tab === "tasks" ? viewTasks()
    : S.tab === "pay"   ? viewPay()
    : S.tab === "vault" ? viewVault()
    : S.tab === "set"   ? viewSettings()
    : viewHome();
}
function renderTabs(){
  const badges = { tasks: wantedTasks().length,
                   pay: unpaid().filter(p => { const n = daysUntil(p.due); return n !== null && n <= 0; }).length };
  el("tabs").innerHTML = TABS.map(t =>
    '<button class="tab" role="tab" aria-selected="' + (S.tab === t.id) + '" data-tab="' + t.id + '">' + h(t.label) +
    (badges[t.id] ? '<span class="badge num">' + badges[t.id] + "</span>" : "") + "</button>").join("");
}
function renderDoor(){
  const open = !!S.office.doorOpen;
  const by = S.office.updatedBy ? (member(S.office.updatedBy) || {}).name : "";
  el("doorBox").innerHTML =
    '<div class="door ' + (open ? "open" : "") + '">' +
      '<span class="lamp"></span>' +
      '<span class="txt"><b>事務所 ' + (open ? "あいてます" : "しまっています") + "</b>" +
        "<small>" + (S.office.updatedAt ? h((by || "誰か") + " が " + stamp(S.office.updatedAt)) : "まだ記録がありません") + "</small></span>" +
      '<button class="btn sm" data-act="door">' + (open ? "閉めた" : "開けた") + "</button>" +
    "</div>";
}
function renderHere(){
  const here = S.members.filter(m => m.present);
  el("hereBox").innerHTML =
    '<div class="avatars">' + S.members.map(m =>
      '<span class="av' + (m.present ? "" : " off") + '" style="background:' + h(m.color || "#888") + '" title="' +
      h(m.name + (m.present ? "・在席" : "・不在")) + '">' + h((m.name || "?").slice(0, 1)) + "</span>").join("") + "</div>" +
    '<span class="chip ' + (here.length ? "ok" : "") + '"><span class="dot"></span>在席 ' + here.length + " / " + S.members.length + "</span>" +
    (S.me ? '<button class="btn sm ' + (S.me.present ? "" : "primary") + '" data-act="present">' +
      (S.me.present ? "事務所を出る" : "事務所に入った") + "</button>" : "");
}

/* ============================ view: ログイン / プロフィール ============================ */
function viewAuth(){
  const up = S.authMode === "up";
  return '<div class="gate"><div class="gate-card">' +
    '<div class="brand" style="display:flex"><span class="mark">PRIME</span><span class="sub">事務所ボード</span></div>' +
    "<h1>" + (up ? "アカウントを作る" : "ログイン") + "</h1>" +
    '<p class="lead">' + (up
      ? "管理者から許可されたメールアドレスで登録できます。<br>パスワードは8文字以上にしてください。"
      : "スタッフ用の共有ボードです。") + "</p>" +
    '<div class="fields">' +
      '<label class="f">メールアドレス<input type="email" id="au_email" autocomplete="username" inputmode="email"></label>' +
      '<label class="f">パスワード<input type="password" id="au_pw" autocomplete="' + (up ? "new-password" : "current-password") + '"></label>' +
    "</div>" +
    (S.authErr ? '<p class="err">' + h(S.authErr) + "</p>" : "") +
    '<button class="btn primary" style="width:100%" data-act="' + (up ? "signup" : "signin") + '"' + (S.busy ? " disabled" : "") + ">" +
      (S.busy ? "処理中…" : up ? "登録する" : "ログイン") + "</button>" +
    '<p class="swap">' + (up ? "すでにアカウントがある方は " : "はじめての方は ") +
      '<button data-act="authmode" data-v="' + (up ? "in" : "up") + '">' + (up ? "ログイン" : "アカウント作成") + "</button></p>" +
    "</div></div>";
}
function viewProfile(){
  return '<div class="gate"><div class="gate-card">' +
    "<h1>表示名を決めてください</h1>" +
    '<p class="lead">スケジュール・タスク・在席表示に使われる名前です。<br>あとから「設定」タブで変更できます。</p>' +
    '<div class="fields">' +
      '<label class="f">名前<input type="text" id="pf_name" maxlength="12" placeholder="例：ゆうな"></label>' +
      '<label class="f">色<div class="colorpick" id="pf_colors">' +
        PALETTE.map(c => '<button type="button" data-act="draft-color" data-v="' + c + '" aria-pressed="' +
          (S.draftColor === c) + '" style="background:' + c + '" aria-label="' + c + '"></button>').join("") + "</div></label>" +
    "</div>" +
    (S.authErr ? '<p class="err">' + h(S.authErr) + "</p>" : "") +
    '<button class="btn primary" style="width:100%" data-act="create-profile"' + (S.busy ? " disabled" : "") + ">" +
      (S.busy ? "作成中…" : "はじめる") + "</button>" +
    '<p class="swap"><button data-act="signout">別のアカウントでログイン</button></p>' +
    "</div></div>";
}

/* ============================ view: ホーム ============================ */
const kindChip = k => '<span class="chip ' + KINDS[k || ""].chip + '">' + KINDS[k || ""].label + "</span>";
function todayRow(m){
  const d = dayOf(m.id, today()) || {};
  const isMe = S.me && m.id === S.me.id;
  const ng = (d.ngFrom || d.ngTo)
    ? '<div class="ng">連絡不可 <span class="num">' + h(d.ngFrom || "--:--") + "〜" + h(d.ngTo || "--:--") + "</span>" +
      (d.note ? " ・ " + h(d.note) : "") + "</div>"
    : (d.note ? '<div class="ng">' + h(d.note) + "</div>" : "");
  return '<div class="today-row">' +
    '<div class="today-meta">' +
      '<span class="who"><span class="pip" style="background:' + h(m.color) + '"></span>' + h(m.name) +
      (isMe ? ' <span style="color:var(--muted);font-weight:400;font-size:11px">(あなた)</span>' : "") + "</span>" +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + kindChip(d.kind) +
        (m.present ? '<span class="chip ok"><span class="dot"></span>事務所</span>' : "") + "</div>" +
    "</div><div>" +
      '<div class="today-plan' + (d.plan ? "" : " blank") + '">' + (d.plan ? h(d.plan) : "今日の動きは未記入") + "</div>" + ng +
      '<div style="margin-top:7px"><button class="btn sm" data-act="edit-day" data-id="' + h(m.id) + '" data-date="' + today() + '">' +
        (isMe ? "自分の今日を書く" : "この日を編集") + "</button></div>" +
    "</div></div>";
}
function dueChip(due, doneish){
  if (!due) return "";
  const n = daysUntil(due);
  if (n === null) return "";
  const cls = doneish ? "" : n < 0 ? "bad" : n <= 3 ? "warn" : "cool";
  const txt = n < 0 ? md(due) + " (" + Math.abs(n) + "日超過)" : n === 0 ? "今日まで" : n === 1 ? "明日まで" : md(due) + " (あと" + n + "日)";
  return '<span class="chip ' + cls + '">' + h(txt) + "</span>";
}
function whoChip(id){
  const m = member(id);
  if (!m) return '<span class="chip brass">募集中</span>';
  return '<span class="chip" style="background:' + h(m.color) + '22;color:' + h(m.color) + '">' + h(m.name) + "</span>";
}
function viewHome(){
  const soon = openTasks().filter(t => t.assignee && t.due && daysUntil(t.due) !== null && daysUntil(t.due) <= 7)
    .sort((a,b) => (a.due||"").localeCompare(b.due||""));
  const wanted = wantedTasks().sort((a,b) => (a.due||"9").localeCompare(b.due||"9"));
  const bills = unpaid().sort((a,b) => (a.due||"9").localeCompare(b.due||"9")).slice(0, 4);
  const load = S.members.map(m => ({ m: m, n: openTasks().filter(t => t.assignee === m.id).length }));
  return '<div class="grid-home"><div>' +
      '<section class="sec"><div class="sec-head"><div class="eyebrow">' + h(today().replace(/-/g,"/")) + " (" + DOW[new Date().getDay()] + ")" +
        '</div><div class="spacer"></div><span class="hint">今日の全員の動き</span></div>' +
        '<h2 style="font-family:var(--serif);font-size:19px;margin-bottom:12px">今日は誰が、何をしていますか</h2>' +
        '<div class="panel">' + (S.members.length ? S.members.map(todayRow).join("") : '<div class="empty">メンバーがいません</div>') + "</div></section>" +
      '<section class="sec"><div class="sec-head"><h2>手が空いている人へ</h2>' +
        '<span class="hint">担当が決まっていない作業です。引き受けると自分のタスクになります。</span></div>' +
        '<div class="panel">' + (wanted.length ? wanted.map(function(t){ return taskRow(t); }).join("") : '<div class="empty">募集中の作業はありません</div>') + "</div></section>" +
    "</div><div>" +
      '<section class="sec"><div class="sec-head"><h2>いまの持ち分</h2></div>' +
        '<div class="panel"><div class="rows" style="border-top:0">' +
        (load.length ? load.map(x =>
          '<div class="row" style="align-items:center"><span class="who" style="flex:1"><span class="pip" style="background:' + h(x.m.color) + '"></span>' +
          h(x.m.name) + '</span><span class="num" style="font-size:17px;font-weight:600;color:' + (x.n >= 4 ? "var(--bad)" : x.n ? "var(--ink)" : "var(--muted)") + '">' +
          x.n + '</span><span style="font-size:11px;color:var(--muted);align-self:flex-end;padding-bottom:3px">件</span></div>').join("")
          : '<div class="empty">—</div>') + "</div></div></section>" +
      '<section class="sec"><div class="sec-head"><h2>期限が近い</h2></div>' +
        '<div class="panel">' + (soon.length ? soon.map(function(t){ return taskRow(t, true); }).join("") : '<div class="empty">7日以内の期限はありません</div>') + "</div></section>" +
      '<section class="sec"><div class="sec-head"><h2>支払い予定</h2><div class="spacer"></div>' +
        '<span class="chip ' + (unpaid().length ? "warn" : "ok") + '">未払い ' + unpaid().length + "件</span></div>" +
        '<div class="panel"><div class="rows" style="border-top:0">' +
        (bills.length ? bills.map(p =>
          '<div class="row" style="align-items:center;gap:10px"><div style="flex:1;min-width:0">' +
          '<div style="font-size:13.5px;font-weight:500">' + h(p.title) + "</div>" +
          '<div style="margin-top:3px;display:flex;gap:6px;flex-wrap:wrap">' + dueChip(p.due) +
          (p.payee ? '<span class="chip">' + h(p.payee) + "</span>" : "") + "</div></div>" +
          '<span class="num" style="font-weight:600">' + h(yen(p.amount)) + "</span></div>").join("")
          : '<div class="empty">未払いはありません</div>') + "</div></div></section>" +
    "</div></div>";
}

/* ============================ view: スケジュール ============================ */
function shiftMonth(delta){
  const p = S.month.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  S.month = d.getFullYear() + "-" + pad(d.getMonth() + 1);
  loadAll().then(render);
}
function viewSched(){
  const ym = S.month, n = daysInMonth(ym), t = today();
  let head = '<tr><th class="name">メンバー</th>';
  for (let d = 1; d <= n; d++){
    const w = dow(ym, d);
    head += '<th class="' + (w === 0 ? "sun" : w === 6 ? "sat" : "") + '">' + d + "<br>" + DOW[w] + "</th>";
  }
  head += "</tr>";
  const body = S.members.map(m => {
    let r = '<td class="name"><span class="who"><span class="pip" style="background:' + h(m.color) + '"></span>' + h(m.name) + "</span></td>";
    for (let d = 1; d <= n; d++){
      const date = ym + "-" + pad(d), day = dayOf(m.id, date) || {};
      const K = KINDS[day.kind || ""];
      const marks = ((day.ngFrom || day.ngTo) ? '<span class="m ngm"></span>' : "") + ((day.plan || day.note) ? '<span class="m notem"></span>' : "");
      r += '<td class="day ' + K.cls + (date === t ? " today-col" : "") + '">' +
        '<button class="cell" data-act="edit-day" data-id="' + h(m.id) + '" data-date="' + date + '" title="' + h(m.name + " " + date) + '">' +
        '<span class="k">' + (day.kind ? K.label.slice(0, 2) : "") + '</span><span class="marks">' + marks + "</span></button></td>";
    }
    return "<tr>" + r + "</tr>";
  }).join("");
  const label = ym.slice(0, 4) + "年" + Number(ym.slice(5, 7)) + "月";
  const ngList = [];
  S.members.forEach(m => {
    for (let d = 1; d <= n; d++){
      const date = ym + "-" + pad(d), day = dayOf(m.id, date);
      if (day && (day.ngFrom || day.ngTo)) ngList.push({ m: m, date: date, d: day });
    }
  });
  return '<section class="sec"><div class="sec-head"><h2>' + h(label) + " の勤務・休み</h2><div class=\"spacer\"></div>" +
    '<button class="btn sm" data-act="month" data-delta="-1">← 前の月</button>' +
    '<button class="btn sm" data-act="month" data-delta="0">今月</button>' +
    '<button class="btn sm" data-act="month" data-delta="1">次の月 →</button></div>' +
    '<div class="cal-scroll"><table class="cal"><thead>' + head + "</thead><tbody>" +
    (S.members.length ? body : '<tr><td class="name">—</td><td colspan="' + n + '" style="padding:18px;text-align:center;color:var(--muted)">メンバーがいません</td></tr>') +
    "</tbody></table></div>" +
    '<div class="legend">' +
      '<span><i style="background:var(--brass-soft);border:1px solid var(--brass-line)"></i>出勤</span>' +
      '<span><i style="background:var(--bad-soft);border:1px solid var(--line)"></i>公休</span>' +
      '<span><i style="background:var(--cool-soft);border:1px solid var(--line)"></i>半休</span>' +
      '<span><i style="background:var(--bad);border-radius:50%"></i>連絡がつかない時間帯あり</span>' +
      '<span><i style="background:var(--brass);border-radius:50%"></i>その日の予定メモあり</span>' +
      '<span style="margin-left:auto">マスを押すと編集できます</span></div></section>' +
    '<section class="sec"><div class="sec-head"><h2>連絡がつかない時間帯（今月）</h2></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (ngList.length ? ngList.sort((a,b) => a.date.localeCompare(b.date)).map(x =>
      '<div class="row" style="align-items:center"><span class="num" style="width:56px;color:var(--muted)">' + h(md(x.date)) +
      "(" + DOW[dow(ym, Number(x.date.slice(8, 10)))] + ")</span>" +
      '<span class="who" style="width:110px"><span class="pip" style="background:' + h(x.m.color) + '"></span>' + h(x.m.name) + "</span>" +
      '<span class="ng" style="flex:1"><span class="num">' + h(x.d.ngFrom || "--:--") + "〜" + h(x.d.ngTo || "--:--") + "</span>" +
      (x.d.note ? " ・ " + h(x.d.note) : "") + "</span></div>").join("")
      : '<div class="empty">今月の登録はありません</div>') + "</div></div></section>";
}

/* ============================ view: タスク ============================ */
function taskRow(t, compact){
  const done = t.status === "done";
  const mine = S.me && t.assignee === S.me.id;
  return '<div class="t-row' + (done ? " done" : "") + (!t.assignee && !done ? " wanted" : "") + '">' +
    '<button class="tick' + (done ? " on" : "") + '" data-act="toggle-task" data-id="' + h(t.id) + '" aria-label="完了切り替え">' + (done ? "✓" : "") + "</button>" +
    '<div><div class="t-title">' + h(t.title) + "</div>" +
      (t.detail ? '<div class="t-detail">' + h(t.detail) + "</div>" : "") +
      '<div class="t-meta">' + whoChip(t.assignee) + dueChip(t.due, done) +
        (t.status === "doing" ? '<span class="chip cool">進行中</span>' : "") +
        '<span style="font-size:11px;color:var(--muted)">' + h((member(t.createdBy) || {}).name || "") +
        (t.createdAt ? " が " + h(stamp(t.createdAt)) + " に登録" : "") + "</span></div></div>" +
    (compact ? "" : '<div class="t-acts">' +
      (!done && !t.assignee ? '<button class="btn sm primary" data-act="take" data-id="' + h(t.id) + '">引き受ける</button>' : "") +
      (!done && mine && t.status !== "doing" ? '<button class="btn sm" data-act="start" data-id="' + h(t.id) + '">着手</button>' : "") +
      (!done && t.assignee && !mine ? '<button class="btn sm" data-act="take" data-id="' + h(t.id) + '">代わる</button>' : "") +
      (!done && t.assignee ? '<button class="btn sm ghost" data-act="release" data-id="' + h(t.id) + '">手放す</button>' : "") +
      '<button class="btn sm ghost" data-act="edit-task" data-id="' + h(t.id) + '">編集</button>' +
    "</div>") + "</div>";
}
function viewTasks(){
  const f = S.taskFilter, myId = S.me ? S.me.id : null;
  const all = S.tasks.slice().sort((a,b) => {
    const rank = t => t.status === "done" ? 2 : t.assignee ? 1 : 0;
    return rank(a) - rank(b) || (a.due || "9999").localeCompare(b.due || "9999") || (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  const list = all.filter(t =>
    f === "wanted" ? (!t.assignee && t.status !== "done")
    : f === "mine" ? (t.assignee === myId && t.status !== "done")
    : f === "done" ? t.status === "done"
    : t.status !== "done");
  const chips = [["all","未完了"],["wanted","募集中"],["mine","自分の分"],["done","完了"]];
  return '<section class="sec"><div class="sec-head"><h2>作業とその期限</h2>' +
    '<span class="hint">担当を空にすると「募集中」になり、手が空いた人が引き受けられます。</span>' +
    '<div class="spacer"></div><button class="btn primary" data-act="new-task">＋ 作業を登録</button></div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
    chips.map(c => '<button class="btn sm' + (f === c[0] ? " primary" : "") + '" data-act="task-filter" data-f="' + c[0] + '">' + c[1] + "</button>").join("") + "</div>" +
    '<div class="panel">' + (list.length ? list.map(function(t){ return taskRow(t); }).join("") : '<div class="empty">該当する作業はありません</div>') + "</div></section>";
}

/* ============================ view: 支払い ============================ */
function viewPay(){
  const up = unpaid();
  const overdue = up.filter(p => { const n = daysUntil(p.due); return n !== null && n < 0; });
  const sum = up.reduce((a, p) => a + Number(p.amount || 0), 0);
  const thisMonth = S.payments.filter(p => p.status === "paid" && (p.paidAt || "").slice(0, 7) === today().slice(0, 7));
  const paidSum = thisMonth.reduce((a, p) => a + Number(p.amount || 0), 0);
  const list = S.payments.filter(p => S.payFilter === "paid" ? p.status === "paid" : S.payFilter === "all" ? true : p.status !== "paid")
    .sort((a,b) => (a.status === "paid" ? 1 : 0) - (b.status === "paid" ? 1 : 0) || (a.due || "9999").localeCompare(b.due || "9999"));
  const chips = [["unpaid","未払い"],["paid","支払済"],["all","すべて"]];
  return '<section class="sec"><div class="sec-head"><h2>支払い管理</h2>' +
    '<div class="spacer"></div><button class="btn primary" data-act="new-pay">＋ 支払いを登録</button></div>' +
    '<div class="tiles" style="margin-bottom:16px">' +
      '<div class="tile"><span class="lab">未払い合計</span><span class="val ' + (sum ? "warn" : "ok") + '">' + h(yen(sum)) + '</span><span class="sub">' + up.length + " 件</span></div>" +
      '<div class="tile"><span class="lab">期限超過</span><span class="val ' + (overdue.length ? "bad" : "ok") + '">' + overdue.length + '</span><span class="sub">' +
        (overdue.length ? h(overdue.map(p => p.title).slice(0, 2).join("、")) : "なし") + "</span></div>" +
      '<div class="tile"><span class="lab">今月の支払済</span><span class="val">' + h(yen(paidSum)) + '</span><span class="sub">' + thisMonth.length + " 件</span></div></div>" +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
    chips.map(c => '<button class="btn sm' + (S.payFilter === c[0] ? " primary" : "") + '" data-act="pay-filter" data-f="' + c[0] + '">' + c[1] + "</button>").join("") + "</div>" +
    '<div class="panel tbl-scroll"><table class="data"><thead><tr>' +
    "<th>期日</th><th>名目</th><th>支払先</th><th class=\"r\">金額</th><th>方法</th><th>担当</th><th></th></tr></thead><tbody>" +
    (list.length ? list.map(p =>
      '<tr class="' + (p.status === "paid" ? "paid" : "") + '">' +
        "<td>" + (p.status === "paid" ? '<span class="chip ok">済 ' + h(md((p.paidAt || "").slice(0,10) || p.due || "")) + "</span>" : (dueChip(p.due) || '<span class="chip">未定</span>')) + "</td>" +
        "<td>" + h(p.title) + (p.note ? '<div style="font-size:11.5px;color:var(--muted)">' + h(p.note) + "</div>" : "") + "</td>" +
        "<td>" + h(p.payee || "—") + "</td>" +
        '<td class="r num" style="font-weight:600">' + h(yen(p.amount)) + "</td>" +
        "<td>" + h(p.method || "—") + "</td>" +
        "<td>" + (p.assignee ? whoChip(p.assignee) : '<span class="chip brass">未定</span>') + "</td>" +
        '<td class="acts" style="white-space:nowrap;text-align:right">' +
          '<button class="btn sm" data-act="toggle-pay" data-id="' + h(p.id) + '">' + (p.status === "paid" ? "未払いに戻す" : "支払った") + "</button> " +
          '<button class="btn sm ghost" data-act="edit-pay" data-id="' + h(p.id) + '">編集</button></td></tr>').join("")
      : '<tr><td colspan="7" style="text-align:center;padding:22px;color:var(--muted)">該当する支払いはありません</td></tr>') +
    "</tbody></table></div></section>";
}

/* ============================ view: 媒体アカウント ============================ */
function viewVault(){
  const head = '<section class="sec"><div class="sec-head"><h2>媒体アカウント</h2>' +
    '<span class="hint">各媒体のURL・ID・パスワードをまとめておく場所です。</span>';
  if (!crypto.subtle) return head + "</div><div class=\"note\">この環境では暗号化が使えないため、この機能は利用できません。</div></section>";
  if (!S.vaultCfg){
    return head + "</div>" +
      '<div class="note" style="margin-bottom:16px">ID・パスワードは<strong>この画面の中で暗号化してから</strong>保存します。合言葉はどこにも保存されないので、合言葉を知っているスタッフだけが中身を読めます。<br>合言葉を忘れると復元できません。必ず全員で共有し、控えを残してください。</div>' +
      '<div class="panel lockbox"><div class="glyph">🔐</div>' +
      '<h3 style="font-family:var(--serif);font-size:17px;margin-bottom:4px">合言葉を決める</h3>' +
      '<p style="font-size:13px;color:var(--muted);margin-bottom:14px">最初の一人が決めて、他のスタッフに伝えてください。</p>' +
      '<div class="fields" style="text-align:left">' +
      '<label class="f">合言葉（8文字以上）<input type="password" id="vp1" autocomplete="new-password"></label>' +
      '<label class="f">もう一度<input type="password" id="vp2" autocomplete="new-password"></label>' +
      '<button class="btn primary" data-act="vault-init">この合言葉で始める</button></div></div></section>';
  }
  if (!S.key){
    return head + "</div>" +
      '<div class="panel lockbox"><div class="glyph">🔑</div>' +
      '<h3 style="font-family:var(--serif);font-size:17px;margin-bottom:4px">合言葉を入力</h3>' +
      '<p style="font-size:13px;color:var(--muted);margin-bottom:14px">スタッフ間で共有している合言葉を入れてください。</p>' +
      '<div class="fields" style="text-align:left">' +
      '<label class="f">合言葉<input type="password" id="vp1" autocomplete="current-password"></label>' +
      (S.vaultErr ? '<p style="color:var(--bad);font-size:12.5px;font-weight:700">' + h(S.vaultErr) + "</p>" : "") +
      '<button class="btn primary" data-act="vault-unlock">解錠する</button></div></div></section>';
  }
  const rows = S.vault.slice().sort((a,b) => (a.media || "").localeCompare(b.media || "", "ja"));
  return head + '<div class="spacer"></div><button class="btn sm ghost" data-act="vault-lock">施錠する</button>' +
    '<button class="btn primary" data-act="new-vault">＋ 媒体を追加</button></div>' +
    '<div class="panel tbl-scroll"><table class="data" style="min-width:720px"><thead><tr>' +
    "<th>媒体</th><th>URL</th><th>ID</th><th>パスワード</th><th>メモ</th><th></th></tr></thead><tbody>" +
    (rows.length ? rows.map(function(v){
      const r = S.reveal[v.id];
      return "<tr><td style=\"font-weight:700\">" + h(v.media) + "</td>" +
        "<td>" + (v.url ? '<a href="' + h(v.url) + '" target="_blank" rel="noopener noreferrer">開く ↗</a>' : "—") + "</td>" +
        '<td><span class="secret"><code>' + (r ? h(r.loginId || "—") : "••••••••") + "</code>" +
          (r ? '<button class="btn sm ghost" data-act="copy-v" data-id="' + h(v.id) + '" data-k="loginId">複製</button>' : "") + "</span></td>" +
        '<td><span class="secret"><code>' + (r ? h(r.password || "—") : "••••••••") + "</code>" +
          (r ? '<button class="btn sm ghost" data-act="copy-v" data-id="' + h(v.id) + '" data-k="password">複製</button>' : "") + "</span></td>" +
        '<td style="color:var(--muted);font-size:12.5px">' + h(v.note || "") + "</td>" +
        '<td style="white-space:nowrap;text-align:right">' +
          '<button class="btn sm" data-act="reveal" data-id="' + h(v.id) + '">' + (r ? "隠す" : "表示") + "</button> " +
          '<button class="btn sm ghost" data-act="edit-vault" data-id="' + h(v.id) + '">編集</button></td></tr>';
    }).join("") : '<tr><td colspan="6" style="text-align:center;padding:22px;color:var(--muted)">まだ登録がありません</td></tr>') +
    "</tbody></table></div>" +
    '<p style="font-size:12px;color:var(--muted);margin-top:10px">保存されているのは暗号文だけです。合言葉はこのブラウザのメモリ上にのみ置かれ、タブを閉じると消えます。</p></section>';
}

/* ============================ view: 設定 ============================ */
function viewSettings(){
  return '<section class="sec"><div class="sec-head"><h2>スタッフ</h2></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (S.members.length ? S.members.map(m =>
      '<div class="row" style="align-items:center;gap:10px">' +
      '<span class="who" style="flex:1"><span class="pip" style="background:' + h(m.color) + '"></span>' + h(m.name) +
      (S.me && m.id === S.me.id ? ' <span class="chip">あなた</span>' : "") + "</span>" +
      '<span class="chip ' + (m.present ? "ok" : "") + '">' + (m.present ? "在席" : "不在") + "</span>" +
      '<button class="btn sm ghost" data-act="edit-member" data-id="' + h(m.id) + '">編集</button></div>').join("")
      : '<div class="empty">—</div>') + "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>ログインを許可するメールアドレス</h2>' +
    '<span class="hint">ここに登録した人だけがアカウントを作れます。</span>' +
    '<div class="spacer"></div><button class="btn primary" data-act="new-allowed">＋ 追加</button></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (S.allowed.length ? S.allowed.map(a =>
      '<div class="row" style="align-items:center;gap:10px"><span class="num" style="flex:1;font-size:13px">' + h(a.email) + "</span>" +
      (a.note ? '<span class="chip">' + h(a.note) + "</span>" : "") +
      '<button class="btn sm danger" data-act="del-allowed" data-id="' + h(a.email) + '">削除</button></div>').join("")
      : '<div class="empty">まだ登録がありません。スタッフのメールアドレスを追加してください。</div>') + "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>このアカウント</h2></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
      '<div class="row" style="align-items:center"><span style="flex:1">表示名</span><b>' + h(meName()) + "</b>" +
      '<button class="btn sm" data-act="edit-member" data-id="' + h(S.me ? S.me.id : "") + '">変更</button></div>' +
      '<div class="row" style="align-items:center"><span style="flex:1">メールアドレス</span>' +
      '<span class="num" style="font-size:12.5px;color:var(--muted)">' + h(S.user ? S.user.email : "") + "</span></div>" +
      '<div class="row" style="align-items:center"><span style="flex:1">ログアウト</span>' +
      '<button class="btn sm" data-act="signout">ログアウト</button></div>' +
    "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>データの扱い</h2></div>' +
    '<div class="note">予定・タスク・支払いは、ログインしたスタッフ全員が読み書きできます。<br>' +
    '媒体のID・パスワードは合言葉で暗号化してから保存されるため、合言葉を知らない人には読めません。<br>' +
    '銀行やクレジットカードの認証情報など、漏れると被害が大きいものはここに置かないでください。</div></section>';
}

/* ============================ modal ============================ */
function closeModal(){ el("modalRoot").innerHTML = ""; }
function showModal(title, bodyHtml, footerHtml){
  el("modalRoot").innerHTML =
    '<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="' + h(title) + '">' +
    "<header><h3>" + h(title) + '</h3><div style="margin-left:auto"></div>' +
    '<button class="btn sm ghost" data-act="close-modal" aria-label="閉じる">✕</button></header>' +
    '<div class="body">' + bodyHtml + "</div><footer>" + footerHtml + "</footer></div></div>";
  const first = $(".modal .body input, .modal .body textarea, .modal .body select");
  if (first) first.focus();
}
function memberOptions(sel, blankLabel){
  return '<option value="">' + h(blankLabel || "— なし —") + "</option>" +
    S.members.map(m => '<option value="' + h(m.id) + '"' + (m.id === sel ? " selected" : "") + ">" + h(m.name) + "</option>").join("");
}
function modalDay(memberId, date){
  const m = member(memberId) || {}, d = dayOf(memberId, date) || {};
  const w = DOW[dow(date.slice(0, 7), Number(date.slice(8, 10)))];
  showModal(m.name + " ・ " + date.replace(/-/g, "/") + "（" + w + "）",
    '<div class="fields">' +
    '<label class="f">その日の区分<select id="d_kind">' +
      ["", "work", "off", "half"].map(k => '<option value="' + k + '"' + ((d.kind || "") === k ? " selected" : "") + ">" +
        KINDS[k].label + "</option>").join("") + "</select></label>" +
    '<label class="f">今日1日の動き（全員が見られます）<textarea id="d_plan" placeholder="例：13時まで在宅で写真の差し替え、15時から事務所、夕方に面接1件">' + h(d.plan || "") + "</textarea></label>" +
    '<div class="fields two">' +
      '<label class="f">連絡がつかない時間帯（開始）<input type="time" id="d_ngf" value="' + h(d.ngFrom || "") + '"></label>' +
      '<label class="f">同（終了）<input type="time" id="d_ngt" value="' + h(d.ngTo || "") + '"></label></div>' +
    '<label class="f">補足（理由・行き先など）<input type="text" id="d_note" maxlength="60" value="' + h(d.note || "") + '"></label></div>',
    '<button class="btn ghost left" data-act="clear-day" data-id="' + h(memberId) + '" data-date="' + date + '">この日を空にする</button>' +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-day" data-id="' + h(memberId) + '" data-date="' + date + '">保存</button>');
}
function modalTask(t){
  t = t || {};
  showModal(t.id ? "作業を編集" : "作業を登録",
    '<div class="fields">' +
    '<label class="f">やること<input type="text" id="t_title" maxlength="80" value="' + h(t.title || "") + '" placeholder="例：新人プロフィールの写真を差し替える"></label>' +
    '<label class="f">詳細・手順<textarea id="t_detail" placeholder="任せる相手が迷わないように書いておくと引き受けてもらいやすいです">' + h(t.detail || "") + "</textarea></label>" +
    '<div class="fields two">' +
      '<label class="f">担当<select id="t_assignee">' + memberOptions(t.assignee, "— 募集中（誰か手が空いた人）—") + "</select></label>" +
      '<label class="f">いつまでに<input type="date" id="t_due" value="' + h(t.due || "") + '"></label></div></div>',
    (t.id ? '<button class="btn danger left" data-act="del-task" data-id="' + h(t.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-task" data-id="' + h(t.id || "") + '">保存</button>');
}
function modalPay(p){
  p = p || {};
  showModal(p.id ? "支払いを編集" : "支払いを登録",
    '<div class="fields"><div class="fields two">' +
      '<label class="f">名目<input type="text" id="p_title" maxlength="60" value="' + h(p.title || "") + '" placeholder="例：事務所家賃"></label>' +
      '<label class="f">支払先<input type="text" id="p_payee" maxlength="40" value="' + h(p.payee || "") + '" placeholder="例：◯◯不動産"></label></div>' +
    '<div class="fields two">' +
      '<label class="f">金額（円）<input type="number" id="p_amount" min="0" step="1" inputmode="numeric" value="' + h(p.amount != null ? p.amount : "") + '"></label>' +
      '<label class="f">期日<input type="date" id="p_due" value="' + h(p.due || "") + '"></label></div>' +
    '<div class="fields two">' +
      '<label class="f">支払方法<input type="text" id="p_method" maxlength="30" value="' + h(p.method || "") + '" placeholder="例：口座振替 / カード / 現金"></label>' +
      '<label class="f">担当<select id="p_assignee">' + memberOptions(p.assignee, "— 未定 —") + "</select></label></div>" +
    '<label class="f">メモ<input type="text" id="p_note" maxlength="80" value="' + h(p.note || "") + '"></label></div>',
    (p.id ? '<button class="btn danger left" data-act="del-pay" data-id="' + h(p.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-pay" data-id="' + h(p.id || "") + '">保存</button>');
}
function modalVault(v, plain){
  v = v || {}; plain = plain || {};
  showModal(v.id ? "媒体アカウントを編集" : "媒体アカウントを追加",
    '<div class="fields">' +
    '<label class="f">媒体名<input type="text" id="v_media" maxlength="40" value="' + h(v.media || "") + '" placeholder="例：シティヘブンネット"></label>' +
    '<div class="presets">' + MEDIA_PRESETS.map(x => '<button type="button" class="preset" data-act="preset" data-v="' + h(x) + '">' + h(x) + "</button>").join("") + "</div>" +
    '<label class="f">管理画面のURL<input type="url" id="v_url" value="' + h(v.url || "") + '" placeholder="https://"></label>' +
    '<div class="fields two">' +
      '<label class="f">ID<input type="text" id="v_id" value="' + h(plain.loginId || "") + '" autocomplete="off"></label>' +
      '<label class="f">パスワード<input type="text" id="v_pw" value="' + h(plain.password || "") + '" autocomplete="off"></label></div>' +
    '<label class="f">メモ（暗号化されません）<input type="text" id="v_note" maxlength="60" value="' + h(v.note || "") + '"></label>' +
    '<p style="font-size:12px;color:var(--muted)">IDとパスワードは保存時に暗号化されます。媒体名・URL・メモは暗号化されないので、機密はメモに書かないでください。</p></div>',
    (v.id ? '<button class="btn danger left" data-act="del-vault" data-id="' + h(v.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-vault" data-id="' + h(v.id || "") + '">保存</button>');
}
function modalMember(m){
  m = m || {};
  showModal("スタッフを編集",
    '<div class="fields">' +
    '<label class="f">名前<input type="text" id="m_name" maxlength="12" value="' + h(m.name || "") + '"></label>' +
    '<label class="f">色<div class="colorpick" id="m_colors">' +
      PALETTE.map(c => '<button type="button" data-act="pick-color" data-v="' + c + '" aria-pressed="' +
        ((m.color || "") === c) + '" style="background:' + c + '" aria-label="' + c + '"></button>').join("") + "</div></label>" +
    '<input type="hidden" id="m_color" value="' + h(m.color || PALETTE[0]) + '"></div>',
    (m.id && S.me && m.id !== S.me.id ? '<button class="btn danger left" data-act="del-member" data-id="' + h(m.id) + '">このスタッフを外す</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-member" data-id="' + h(m.id || "") + '">保存</button>');
}
function modalAllowed(){
  showModal("ログインを許可するメールアドレス",
    '<div class="fields">' +
    '<label class="f">メールアドレス<input type="email" id="a_email" inputmode="email" placeholder="staff@example.com"></label>' +
    '<label class="f">メモ（誰のものか）<input type="text" id="a_note" maxlength="30" placeholder="例：たかし"></label>' +
    '<p style="font-size:12px;color:var(--muted)">追加したあと、本人が「アカウント作成」から同じメールアドレスで登録します。</p></div>',
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-allowed">追加</button>');
}

/* ============================ actions ============================ */
async function saveDay(memberId, date, day){
  await run(sb.from("schedule").upsert({
    member_id: memberId, date: date, kind: day.kind || "", plan: day.plan || "",
    ng_from: day.ngFrom || "", ng_to: day.ngTo || "", note: day.note || "",
    updated_by: S.me.id, updated_at: nowIso()
  }, { onConflict: "member_id,date" }));
}
async function saveTaskFromModal(id){
  const title = valOf("t_title");
  if (!title){ toast("やることを入力してください"); return; }
  const body = { title: title, detail: valOf("t_detail"), assignee: valOf("t_assignee") || null, due: valOf("t_due") || null };
  if (id){
    const cur = S.tasks.find(t => t.id === id) || {};
    if (body.assignee && body.assignee !== cur.assignee) body.taken_at = nowIso();
    await run(sb.from("tasks").update(body).eq("id", id), "保存しました");
  } else {
    body.status = "open"; body.created_by = S.me.id;
    if (body.assignee) body.taken_at = nowIso();
    await run(sb.from("tasks").insert(body), "登録しました");
  }
  closeModal();
}
async function savePayFromModal(id){
  const title = valOf("p_title");
  if (!title){ toast("名目を入力してください"); return; }
  const body = { title: title, payee: valOf("p_payee"), amount: Number(valOf("p_amount") || 0),
    due: valOf("p_due") || null, method: valOf("p_method"), assignee: valOf("p_assignee") || null, note: valOf("p_note") };
  if (id) await run(sb.from("payments").update(body).eq("id", id), "保存しました");
  else { body.status = "unpaid"; await run(sb.from("payments").insert(body), "登録しました"); }
  closeModal();
}
async function saveVaultFromModal(id){
  const media = valOf("v_media");
  if (!media){ toast("媒体名を入力してください"); return; }
  if (!S.key){ toast("先に合言葉で解錠してください"); return; }
  const enc = await sealJson(S.key, { loginId: valOf("v_id"), password: valOf("v_pw") });
  const body = { media: media, url: valOf("v_url"), note: valOf("v_note"), enc: enc, updated_by: S.me.id, updated_at: nowIso() };
  if (id){ await run(sb.from("vault").update(body).eq("id", id), "保存しました"); delete S.reveal[id]; }
  else await run(sb.from("vault").insert(body), "保存しました");
  closeModal();
}
async function vaultInit(){
  const p1 = valOf("vp1"), p2 = valOf("vp2");
  if (p1.length < 8){ toast("合言葉は8文字以上にしてください"); return; }
  if (p1 !== p2){ toast("2つの合言葉が一致しません"); return; }
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(p1, salt);
  const verify = await sealJson(key, VERIFY_TOKEN);
  await run(sb.from("vault_config").upsert({ id: 1, salt: salt, verify: verify }, { onConflict: "id" }));
  S.key = key; S.vaultErr = ""; toast("合言葉を設定しました");
}
async function vaultUnlock(){
  const p = valOf("vp1");
  if (!p) return;
  try {
    const key = await deriveKey(p, S.vaultCfg.salt);
    if (await openJson(key, S.vaultCfg.verify) !== VERIFY_TOKEN) throw new Error("bad");
    S.key = key; S.vaultErr = "";
  } catch(e){ S.vaultErr = "合言葉が違います。"; }
  render();
}
async function revealOne(id){
  if (S.reveal[id]){ delete S.reveal[id]; render(); return; }
  const v = S.vault.find(x => x.id === id);
  if (!v || !v.enc || !S.key) return;
  try { S.reveal[id] = await openJson(S.key, v.enc); }
  catch(e){ toast("この行は今の合言葉では読めません"); }
  render();
}

/* ============================ events ============================ */
document.addEventListener("click", async function(ev){
  const tabBtn = ev.target.closest("[data-tab]");
  if (tabBtn){ S.tab = tabBtn.dataset.tab; ls("prime.tab", S.tab); render(); return; }
  const btn = ev.target.closest("[data-act]");
  if (!btn){ if (ev.target.dataset && ev.target.dataset.scrim) closeModal(); return; }
  const a = btn.dataset.act, id = btn.dataset.id;
  try {
    switch (a){
      case "close-modal": closeModal(); break;

      case "signin": await signIn(); break;
      case "signup": await signUp(); break;
      case "authmode": S.authMode = btn.dataset.v; S.authErr = ""; render(); break;
      case "draft-color": S.draftColor = btn.dataset.v; render(); break;
      case "create-profile": await createProfile(); break;
      case "signout": await signOut(); break;

      case "door":
        await run(sb.from("office").update({ door_open: !S.office.doorOpen, updated_by: S.me.id, updated_at: nowIso() }).eq("id", 1));
        break;
      case "present":
        await run(sb.from("members").update({ present: !S.me.present, present_at: nowIso() }).eq("id", S.me.id));
        break;
      case "month":
        if (btn.dataset.delta === "0"){ S.month = today().slice(0, 7); await loadAll(); render(); }
        else shiftMonth(Number(btn.dataset.delta));
        break;

      case "edit-day": modalDay(id, btn.dataset.date); break;
      case "save-day":
        await saveDay(id, btn.dataset.date, { kind: valOf("d_kind"), plan: valOf("d_plan"),
          ngFrom: valOf("d_ngf"), ngTo: valOf("d_ngt"), note: valOf("d_note") });
        toast("保存しました"); closeModal(); break;
      case "clear-day":
        await saveDay(id, btn.dataset.date, { kind:"", plan:"", ngFrom:"", ngTo:"", note:"" });
        toast("空にしました"); closeModal(); break;

      case "task-filter": S.taskFilter = btn.dataset.f; render(); break;
      case "new-task": modalTask(null); break;
      case "edit-task": modalTask(S.tasks.find(t => t.id === id)); break;
      case "save-task": await saveTaskFromModal(id); break;
      case "del-task": await run(sb.from("tasks").delete().eq("id", id), "削除しました"); closeModal(); break;
      case "toggle-task": {
        const t = S.tasks.find(x => x.id === id) || {};
        await run(sb.from("tasks").update(t.status === "done"
          ? { status: t.assignee ? "doing" : "open", done_at: null, done_by: null }
          : { status: "done", done_at: nowIso(), done_by: S.me.id }).eq("id", id));
        break;
      }
      case "take":
        await run(sb.from("tasks").update({ assignee: S.me.id, taken_at: nowIso(), status: "doing" }).eq("id", id), "引き受けました");
        break;
      case "start": await run(sb.from("tasks").update({ status: "doing" }).eq("id", id)); break;
      case "release":
        await run(sb.from("tasks").update({ assignee: null, status: "open" }).eq("id", id), "募集中に戻しました"); break;

      case "pay-filter": S.payFilter = btn.dataset.f; render(); break;
      case "new-pay": modalPay(null); break;
      case "edit-pay": modalPay(S.payments.find(p => p.id === id)); break;
      case "save-pay": await savePayFromModal(id); break;
      case "del-pay": await run(sb.from("payments").delete().eq("id", id), "削除しました"); closeModal(); break;
      case "toggle-pay": {
        const p = S.payments.find(x => x.id === id) || {};
        await run(sb.from("payments").update(p.status === "paid"
          ? { status: "unpaid", paid_at: null, paid_by: null }
          : { status: "paid", paid_at: nowIso(), paid_by: S.me.id }).eq("id", id));
        break;
      }

      case "vault-init": await vaultInit(); break;
      case "vault-unlock": await vaultUnlock(); break;
      case "vault-lock": S.key = null; S.reveal = {}; render(); toast("施錠しました"); break;
      case "new-vault": modalVault(null, null); break;
      case "edit-vault": {
        const v = S.vault.find(x => x.id === id);
        let plain = S.reveal[id];
        if (!plain && v && v.enc && S.key){ try { plain = await openJson(S.key, v.enc); } catch(e){ plain = null; } }
        modalVault(v, plain); break;
      }
      case "save-vault": await saveVaultFromModal(id); break;
      case "del-vault":
        await run(sb.from("vault").delete().eq("id", id), "削除しました"); delete S.reveal[id]; closeModal(); break;
      case "reveal": await revealOne(id); break;
      case "copy-v": {
        const r = S.reveal[id];
        if (r) copy(r[btn.dataset.k] || "", btn.dataset.k === "password" ? "パスワード" : "ID");
        break;
      }
      case "preset": { const n = el("v_media"); if (n){ n.value = btn.dataset.v; n.focus(); } break; }

      case "edit-member": modalMember(member(id)); break;
      case "pick-color": {
        el("m_color").value = btn.dataset.v;
        Array.prototype.forEach.call(el("m_colors").children, function(c){
          c.setAttribute("aria-pressed", String(c.dataset.v === btn.dataset.v));
        });
        break;
      }
      case "save-member": {
        const name = valOf("m_name");
        if (!name){ toast("名前を入力してください"); break; }
        await run(sb.from("members").update({ name: name, color: valOf("m_color") }).eq("id", id), "保存しました");
        closeModal(); break;
      }
      case "del-member":
        await run(sb.from("members").delete().eq("id", id), "スタッフを外しました"); closeModal(); break;

      case "new-allowed": modalAllowed(); break;
      case "save-allowed": {
        const email = valOf("a_email").toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast("メールアドレスの形式が正しくありません"); break; }
        await run(sb.from("allowed_emails").insert({ email: email, note: valOf("a_note") }), "追加しました");
        closeModal(); break;
      }
      case "del-allowed":
        await run(sb.from("allowed_emails").delete().eq("email", id), "削除しました"); break;
    }
  } catch(e){ /* run() already surfaced it */ }
  if (S.screen === "app") { try { await loadAll(); } catch(e){} render(); }
});
document.addEventListener("keydown", function(ev){
  if (ev.key === "Escape" && el("modalRoot").innerHTML) closeModal();
  if (ev.key === "Enter" && S.screen === "auth"){
    const b = $('[data-act="' + (S.authMode === "up" ? "signup" : "signin") + '"]');
    if (b && document.activeElement && document.activeElement.tagName === "INPUT") b.click();
  }
});

/* keep typing safe: skip the body re-render while an input in the main view has focus */
const _render = render;
render = function(){
  const f = document.activeElement, v = el("view");
  if (f && v && v.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && S.screen === "app"){
    renderDoor(); renderHere(); renderTabs(); return;
  }
  _render();
};

boot();
})();
