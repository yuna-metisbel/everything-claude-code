/* 事務所ボード — staff shared board (Supabase build)
   会社ごとに変わるもの（接続先・表示名）は config.js に置く。 */
(function(){
"use strict";

// 接続先と会社名は config.js に置く。導入ごとに差し替えるのはあちらだけで、
// このファイルは全社共通のまま保つ（1社に直したつもりが全社に及ぶ、を防ぐ）。
const CONFIG = window.BOARD_CONFIG || {};
const SUPABASE_URL = CONFIG.supabaseUrl || "";
const SUPABASE_KEY = CONFIG.supabaseKey || "";
// 名前は「設定」から変えられるボードもある（editableBrand）。そのときは読み込み後に差し替わる。
let BRAND = CONFIG.brand || "BOARD";
let BRAND_SUB = CONFIG.brandSub || "事務所ボード";
// 追加機能（addons/line を流したボードだけ）。空なら一切呼ばないので、PRIME などには影響しない。
//   lineLogin   … LINE ログイン チャネルの ID。入っていればメールのログイン画面の代わりに LINE で入る
//   lineOaId    … 通知を送る公式アカウントの ID（@ から）。友だち追加の案内に使う
//   editableBrand … ボードの名前を「設定」から変えられるようにする
//   reminders   … ホームにリマインダー欄を出す
const LINE_LOGIN = String(CONFIG.lineLogin || "").trim();
const LINE_OA = String(CONFIG.lineOaId || "").trim();
const EDITABLE_BRAND = !!CONFIG.editableBrand;
const REMINDERS = !!CONFIG.reminders;
// 困ったときの連絡先。設置した人が config.js に書く。空なら何も出さない
// （嘘の窓口を出すより、出さないほうがまし）。
const SUPPORT = String(CONFIG.support || "").trim();
// このブロックは h() より前に動くので、最低限のエスケープを自分で持つ。
function esc1(t){
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// 連絡先の1行。読む人が「どこに言えばいいのか」だけ分かればよい。
function supportLine(){
  if (!SUPPORT) return "";
  return '<p class="lead" style="margin-top:12px;font-size:12.5px">' +
    "うまくいかないときの連絡先：<br>" + esc1(SUPPORT) + "</p>";
}
if (!SUPABASE_URL || !SUPABASE_KEY){
  // 設置のときに config.js を置き忘れると、ここで止まる。
  // 白い画面のまま原因が分からない、が一番困るので名指しで出す。
  document.getElementById("view").innerHTML =
    '<div class="gate"><div class="gate-card">' +
    "<h1>設定がありません</h1>" +
    '<p class="lead">config.js に接続先が書かれていません。<br>' +
    "設置した人に連絡してください。</p>" + supportLine() + "</div></div>";
  return;
}
// 画面の上に出る名前は config.js から入れる。index.html に直書きすると、
// 1社ぶん直したつもりが全社共通のファイルに入ってしまう。
// <title> と apple-mobile-web-app-title は JS より先に読まれるので index.html 側に残る。
function applyBrand(){
  const mark = document.getElementById("brandMark");
  const sub = document.getElementById("brandSub");
  if (mark) mark.textContent = BRAND;
  if (sub) sub.textContent = BRAND_SUB;
  document.title = (BRAND + " " + BRAND_SUB).trim();
  // 名前を画面から変えるボードは、ホーム画面に置いたときの名前も合わせる。
  // iPhone は追加した瞬間の apple-mobile-web-app-title を、Android は manifest を見る。
  if (CONFIG.editableBrand){
    document.documentElement.classList.add("brand-edit");
    const am = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (am) am.setAttribute("content", BRAND);
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const mf = { name: document.title, short_name: BRAND.slice(0, 12), start_url: base, scope: base,
      display: "standalone", background_color: "#FFFFFF", theme_color: "#FFFFFF", lang: "ja",
      icons: [{ src: base + "icon-192.png", sizes: "192x192", type: "image/png" },
              { src: base + "icon-512.png", sizes: "512x512", type: "image/png" }] };
    const link = document.querySelector('link[rel="manifest"]');
    try {
      if (link) link.setAttribute("href", URL.createObjectURL(new Blob([JSON.stringify(mf)], { type: "application/manifest+json" })));
    } catch(e){ /* 古いブラウザは元の manifest のまま */ }
  }
}
applyBrand();
// DB に名前が入っていれば、そちらを使う（空の欄は config.js のまま）。
function setBrandFrom(b){
  if (!b) return;
  const changed = (b.brand && b.brand !== BRAND) || (b.sub && b.sub !== BRAND_SUB);
  if (b.brand) BRAND = b.brand;
  if (b.sub) BRAND_SUB = b.sub;
  if (changed) applyBrand();
}

if (!window.supabase || !window.supabase.createClient){
  // The Supabase client is loaded from a CDN; without it the page can do nothing,
  // so say so rather than leaving a blank screen.
  document.getElementById("view").innerHTML =
    '<div class="gate"><div class="gate-card">' +
    '<h1>読み込めませんでした</h1>' +
    '<p class="lead">通信環境の影響で、必要なファイルを取得できませんでした。<br>' +
    '電波の良い場所でページを再読み込みしてください。</p>' +
    '<button class="btn primary" style="width:100%" onclick="location.reload()">再読み込み</button>' +
    supportLine() +
    "</div></div>";
  return;
}
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
const THEMES = [["light","\u2600","明るい"],["dark","\u263e","暗い"],["auto","\u25d0","端末に合わせる"]];
function applyTheme(){
  if (S.theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", S.theme);
}
// 画面の見え方は端末と持ち主でちがう。こちらで決め打つより、選べるようにする。
// 端末ごとの好みなので、データベースではなくこの端末にだけ覚える。
const FONT_SIZES = [["s","小"],["m","中"],["l","大"]];
function applyFontSize(){
  document.documentElement.setAttribute("data-fs", S.fontSize);
}
function setFontSize(v){
  if (!FONT_SIZES.some(f => f[0] === v)) return;
  S.fontSize = v; ls("prime.fontsize", v); applyFontSize(); render();
}
// 下の帯の高さ。端末の縁の作りも持ち方も人それぞれで、こちらから当てにいくと
// 何度も往復になる。文字の大きさと同じく選ばせる。
const BAR_SIZES = [["s","低め"],["m","ふつう"],["l","高め"]];
function applyBarSize(){
  document.documentElement.setAttribute("data-bar", S.barSize);
}
function setBarSize(v){
  if (!BAR_SIZES.some(x => x[0] === v)) return;
  S.barSize = v; ls("prime.barsize", v); applyBarSize(); render();
}
function cycleTheme(){
  const i = THEMES.findIndex(t => t[0] === S.theme);
  S.theme = THEMES[(i + 1) % THEMES.length][0];
  ls("prime.theme", S.theme); applyTheme(); render();
}
const PALETTE = ["#9C6C1F","#3E6497","#2C7A5B","#A63244","#6B4E8F","#B0670F","#2F7E86","#8A5A3B"];
// Everyone is an independent contractor, so this says where they are working
// from rather than whether they clocked in.
const KINDS = {
  office: { label:"事務所",   cell:"事務所", mini:"事",   cls:"k-office", chip:"brass" },
  // 半分は在宅で半分は事務所、という日。どちらか一方を選ばせると、
  // 選ばなかった側の時間が予定から消えてしまう。
  both:   { label:"事務所＋在宅", cell:"事＋在", mini:"事在", cls:"k-both", chip:"brass" },
  home:   { label:"在宅",     cell:"在宅",   mini:"在",   cls:"k-home",   chip:"cool" },
  out:    { label:"外仕事",   cell:"外",     mini:"外",   cls:"k-out",    chip:"warn" },
  off:    { label:"休み",     cell:"休",     mini:"休",   cls:"k-off",    chip:"bad" },
  "":     { label:"未定",     cell:"",       mini:"",     cls:"",         chip:"" }
};
const KIND_ORDER = ["", "office", "both", "home", "out", "off"];
const VAULT_COLS = [
  ["media",     "媒体"],
  ["shop",      "店舗"],
  ["cast_name", "キャスト"],
  ["url",       "URL"],
  ["login_id",  "ID"],
  ["password",  "パスワード"],
  ["note",      "メモ"]
];
const VAULT_GROUPS = [["media","媒体別"],["shop","店舗別"],["cast_name","キャスト別"],["","まとめない"]];
// 同じ媒体はいつも同じ色になるように、名前そのものから色を決める。
// 並び順から決めると、1件足しただけで全部の色が入れ替わって覚え直しになる。
const GROUP_COLORS = 8;
function groupColor(name){
  const s = String(name || "").trim();
  if (!s) return 0; // 未設定は色を付けない
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 1000003;
  return (n % GROUP_COLORS) + 1;
}
// 名前から決めた色がすでに使われていたら、次の空きにずらす。
// 違うものが同じ色で並ぶと、色を付けた意味がなくなるため。
function assignColors(names){
  const out = {}, taken = {};
  names.forEach(function(name){
    const want = groupColor(name);
    if (!want) return;
    let c = want;
    for (let i = 0; i < GROUP_COLORS && taken[c]; i++) c = (c % GROUP_COLORS) + 1;
    taken[c] = true;
    out[name] = c;
  });
  return out;
}
// Set は array-like ではないので slice では取り出せない。Array.from を使う。
const uniqNames = key => Array.from(
  new Set(S.vault.map(v => String(v[key] || "").trim()).filter(Boolean))
).sort((a, b) => a.localeCompare(b, "ja"));
// 媒体の色は一覧全体で1回だけ決める。検索で絞っても、まとめ方を変えても同じ色でいてほしい。
let mediaColors = {};
const colorDot = name => {
  const c = mediaColors[String(name || "").trim()] || 0;
  return c ? '<span class="g-dot g' + c + '"></span>' : "";
};
// Categories the office actually books expenses under; free text is still allowed.
// 会議の時間は、決まっている日もあれば「17時以降」までしか決まらない日もある。
const TIME_HINTS = ["17時以降", "夕方", "午前中", "午後", "終日", "10:00", "14:00", "19:00〜"];
const EXPENSE_CATEGORIES = ["広告・媒体掲載料","家賃","水道光熱費","通信費","備品・消耗品","交通費","外注費","接待交際費","講習・研修","その他"];
const MEDIA_PRESETS = ["シティヘブンネット","エステ魂","メンエス魂","リフナビ","メンズエステ求人","エステの達人","X (旧Twitter)","公式LINE","Instagram","Googleビジネス","予約システム","勤怠システム"];

/* ============================ state ============================ */
const S = {
  user: null, me: null, ready: false, screen: "loading",
  members: [], office: { doorOpen:false }, sched: {}, tasks: [], payments: [], vault: [],
  shops: [], notices: [], allowed: [],
  month: today().slice(0, 7), tab: ls("prime.tab") || "home",
  authErr: "", authMode: "in", busy: false,
  theme: ls("prime.theme") || "light", fontSize: ls("prime.fontsize") || "m",
  barSize: ls("prime.barsize") || "m", tabBar: [],
  settings: null, form: {}, mode: "",
  // 個人情報の取り扱い。登録する前に読めないと意味がないので、ログイン前も持つ。
  privacy: "",
  taskFilter: "all", payFilter: "unpaid", payMonth: today().slice(0, 7), reveal: {}, draftColor: PALETTE[0],
  vaultGroup: ls("prime.vaultGroup") || "media", vaultQ: "",
  shopKind: ls("prime.shopKind") || "shop",
  notes: [], noteSide: ls("prime.noteSide") || "team",
  // 読み直しに失敗しているか、変更の通知が繋がっているか
  stale: false, live: false,
  // スマホの通知。端末ごとに入れるものなので localStorage ではなく、その場で調べる。
  push: { ready: false, on: false, busy: false, why: "" },
  devices: [], deviceLog: [],
  // 拠点（スタッフ用の入り口）。本部は sites を切り替えて見る。
  siteCode: "", gate: null, staffMe: null, gateMode: "in", pinShown: {},
  sites: [], siteId: ls("prime.siteId") || "", siteTab: ls("prime.siteTab") || "att",
  siteDay: today(), siteMonth: today().slice(0, 7), taskSite: ls("prime.taskSite") || "all",
  staff: [], punches: [], keyEvents: [], keyDuty: {}, sshifts: {},
  // LINE（addons/line）。lineLink は自分のひも付け、lineName は初回の名前の候補。
  lineLink: null, lineName: "", reminders: [],
  // 自由な一覧（addons/line の 02）
  lists: [], listItems: [], listId: ls("prime.listId") || "",
  // LINE から届いた要望・感想（addons/line の 03）
  feedback: []
};
const member = id => S.members.find(m => m.id === id) || null;
const meName = () => (S.me ? S.me.name : "");
const recruitUrl = () => (S.settings && S.settings.recruit_url) || "";
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

/* ============================ clipboard ============================ */
// LINE などのアプリ内ブラウザでは navigator.clipboard が無い / 拒否されることがある。
// 使えなかったときに黙って失敗しないよう、古い execCommand に必ず落とす。
function copyFallback(text){
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS は select() だけでは範囲が決まらない
  let ok = false;
  try { ok = document.execCommand("copy"); } catch(e){ ok = false; }
  document.body.removeChild(ta);
  return ok;
}
function copy(text, what){
  const value = String(text == null ? "" : text);
  const done = ok => toast(ok ? (what || "") + "をコピーしました"
                              : "コピーできませんでした。長押しで選択してください。");
  // 空をコピーして「コピーしました」と出すと、貼れない理由が分からなくなる。
  if (!value){ toast("コピーする内容がありません"); return; }
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(value).then(function(){ done(true); },
                                              function(){ done(copyFallback(value)); });
    return;
  }
  done(copyFallback(value));
}

/* ============================ data ============================ */
const normMember = r => ({ id:r.id, name:r.name, color:r.color, present:r.present, presentAt:r.present_at,
                           phone:r.phone || "", emergency:r.emergency || "" });
const normTask   = r => ({ id:r.id, title:r.title, detail:r.detail, assignee:r.assignee, status:r.status,
                           due:r.due, createdBy:r.created_by, createdAt:r.created_at, takenAt:r.taken_at, doneAt:r.done_at,
                           siteId:r.site_id, staffAssignee:r.staff_assignee, staffCreatedBy:r.staff_created_by,
                           staffDoneBy:r.staff_done_by, doneMemo:r.done_memo, doneBy:r.done_by,
                           share:r.share || "all", sharedWith:r.shared_with || [], openSites:r.open_sites || [] });
const normPay    = r => ({ id:r.id, title:r.title, payee:r.payee, amount:Number(r.amount), due:r.due, method:r.method,
                           category:r.category, paidOn:r.paid_on,
                           assignee:r.assignee, status:r.status, note:r.note, paidAt:r.paid_at, createdAt:r.created_at });
const normDevice = r => ({ id:r.id, name:r.name, note:r.note, active:r.active, sortOrder:r.sort_order });
const normDevLog = r => ({ id:r.id, deviceId:r.device_id, kind:r.kind, memberId:r.member_id,
                           happenedAt:r.happened_at, note:r.note });
const normNote   = r => ({ id:r.id, owner:r.owner, kind:r.kind, title:r.title, body:r.body, status:r.status,
                           due:r.due, share:r.share, sharedWith:r.shared_with || [],
                           createdAt:r.created_at });
const normDay    = r => ({ memberId:r.member_id, date:r.date, kind:r.kind, plan:r.plan, done:r.done,
                           ngFrom:r.ng_from, ngTo:r.ng_to, note:r.note,
                           from:r.from_time, to:r.to_time, url:r.link_url });

async function loadAll(){
  const from = S.month + "-01";
  const to = S.month + "-" + pad(daysInMonth(S.month));
  const [mem, off, sch, tsk, pay, vlt, shp, ntc, alw, bst, sit, stf, nte, dev, dlg] = await Promise.all([
    sb.from("members").select("*").order("created_at"),
    sb.from("office").select("*").eq("id", 1).maybeSingle(),
    sb.from("schedule").select("*").gte("date", from).lte("date", to),
    sb.from("tasks").select("*"),
    sb.from("payments").select("*"),
    sb.from("vault").select("*"),
    sb.from("shops").select("*").order("sort_order").order("name"),
    sb.from("notices").select("*").order("created_at", { ascending: false }),
    sb.from("allowed_emails").select("*").order("email"),
    sb.from("board_settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("sites").select("*").order("sort_order").order("name"),
    sb.from("staff").select(STAFF_COLS).order("sort_order").order("name"),
    sb.from("notes").select("*").order("created_at", { ascending: false }),
    sb.from("devices").select("*").order("sort_order").order("name"),
    sb.from("device_log").select("*").order("happened_at", { ascending: false }).limit(80)
  ]);
  // 取れなかったところは、前に読めていたものを残す。空で上書きすると
  // 「データが消えた」ように見えるうえ、失敗したこと自体が伝わらない。
  const parts = [mem, off, sch, tsk, pay, vlt, shp, ntc, alw, bst, sit, stf, nte, dev, dlg];
  const ok = r => !(r && r.error);
  S.stale = parts.some(r => !ok(r));
  if (ok(mem)) S.members = (mem.data || []).map(normMember);
  if (ok(off) && off.data) S.office = { doorOpen: off.data.door_open, updatedBy: off.data.updated_by, updatedAt: off.data.updated_at };
  if (ok(sch)){
    S.sched = {};
    (sch.data || []).forEach(r => { S.sched[r.member_id + "|" + r.date] = normDay(r); });
  }
  if (ok(tsk)) S.tasks = (tsk.data || []).map(normTask);
  if (ok(pay)) S.payments = (pay.data || []).map(normPay);
  if (ok(vlt)) S.vault = (vlt.data || []).map(v => Object.assign({}, v,
    { sharedWith: v.shared_with || [], openSites: v.open_sites || [] }));
  if (ok(shp)) S.shops = shp.data || [];
  // 見えないものは RLS がそもそも返さない。ここに来た時点で読んでよいものだけ。
  if (ok(nte)) S.notes = (nte.data || []).map(normNote);
  if (ok(ntc)) S.notices = ntc.data || [];
  if (ok(alw)) S.allowed = alw.data || [];
  if (ok(bst)){
    S.settings = bst.data || null;
    if (S.settings) S.mode = S.settings.signup_mode;
    if (S.settings && EDITABLE_BRAND) setBrandFrom({ brand: S.settings.brand, sub: S.settings.brand_sub });
    if (customizable()) applyUi(S.settings.ui);
  }
  if (LINE_LOGIN || REMINDERS || customizable()) await loadLineExtras();
  S.me = S.members.find(m => m.id === (S.user && S.user.id)) || null;
  if (ok(sit)) S.sites = sit.data || [];
  if (ok(stf)) S.staff = (stf.data || []).map(normStaff);
  if (ok(dev)) S.devices = (dev.data || []).map(normDevice);
  if (ok(dlg)) S.deviceLog = (dlg.data || []).map(normDevLog);
  if (!site(S.siteId)) S.siteId = S.sites.length ? S.sites[0].id : "";
  await loadSite(S.siteId);
}

// 追加機能のぶん。表が無いボードでは呼ばない（呼んでも前の値を残すだけ）。
async function loadLineExtras(){
  const lists = customizable();
  const [lnk, rem, lst, itm, fbk] = await Promise.all([
    LINE_LOGIN ? sb.from("line_links").select("display_name, notify").eq("user_id", S.user.id).maybeSingle() : null,
    REMINDERS ? sb.from("reminders").select("*").order("remind_at") : null,
    lists ? sb.from("lists").select("*").order("sort_order").order("created_at") : null,
    lists ? sb.from("list_items").select("*").order("sort_order").order("created_at") : null,
    LINE_LOGIN ? sb.from("feedback").select("*").order("created_at", { ascending: false }).limit(100) : null
  ]);
  if (lnk && !lnk.error) S.lineLink = lnk.data || null;
  if (rem && !rem.error) S.reminders = rem.data || [];
  if (lst && !lst.error) S.lists = lst.data || [];
  if (itm && !itm.error) S.listItems = itm.data || [];
  if (fbk && !fbk.error) S.feedback = fbk.data || [];
}

// スタッフとして入っているときは、自分の拠点ぶんだけを読む。
async function loadStaffAll(){
  const [sit, stf, tsk] = await Promise.all([
    sb.from("sites").select("*").eq("id", S.staffMe.siteId),
    sb.from("staff").select(STAFF_COLS).eq("site_id", S.staffMe.siteId).order("sort_order").order("name"),
    sb.from("tasks").select("*").eq("site_id", S.staffMe.siteId)
  ]);
  // 本部側と同じで、取れなかったところは前のままにしておく。
  const ok = r => !(r && r.error);
  S.stale = [sit, stf, tsk].some(r => !ok(r));
  if (ok(sit)) S.sites = sit.data || [];
  if (ok(stf)) S.staff = (stf.data || []).map(normStaff);
  if (ok(tsk)) S.tasks = (tsk.data || []).map(normTask);
  S.siteId = S.staffMe.siteId;
  S.staffMe = S.staff.find(x => x.id === S.staffMe.id) || S.staffMe;
  await loadSite(S.siteId);
}

let reloadTimer = null;
function scheduleReload(){
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(function(){
    const load = S.screen === "staff" ? loadStaffAll() : loadAll();
    load.then(render).catch(function(){ S.stale = true; render(); });
  }, 250);
}
// realtime の配信対象に入っている表だけを並べる。入っていない表を混ぜると
// その購読が通らず、同じチャンネルに乗せた他の表まで届かなくなる。
// staff は pin 列があるので配信対象にしていない（下の定期読み直しで追いつく）。
const LIVE_TABLES = ["members","office","schedule","tasks","payments","vault","shops","notices",
                     "board_settings","sites","punches","key_events","key_duty","staff_shifts","notes",
                     "devices","device_log"].concat(REMINDERS ? ["reminders"] : [])
                     .concat(EDITABLE_BRAND ? ["lists", "list_items"] : [])
                     .concat(LINE_LOGIN ? ["feedback"] : []);
function subscribeLive(){
  const ch = sb.channel("board");
  LIVE_TABLES.forEach(t => {
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, scheduleReload);
  });
  // 繋がらなかったことに気づけないと、更新が止まったまま使い続けることになる。
  ch.subscribe(function(status){
    S.live = status === "SUBSCRIBED";
    if (!S.live) scheduleReload();
  });
}

// 画面に戻ったときは必ず読み直す。スマホは裏に回っている間に接続が切れるので、
// 戻ってきた画面が何時間も前のままだった、というのがいちばん起きやすい。
function watchForStaleness(){
  const again = () => { if (!document.hidden) scheduleReload(); };
  document.addEventListener("visibilitychange", again);
  window.addEventListener("focus", again);
  window.addEventListener("online", again);
  // 通知が来なくても置いていかれないよう、開いている間は定期的にも読み直す。
  setInterval(again, 60000);
}

/* ============================ スマホの通知 ============================ */
// 通知はページを閉じていても届く必要があるので、受け口は service worker に置く。
// iPhone は「ホーム画面に追加」したときしか通知を許さないので、そこだけ先に見る。
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true;

async function pushRegister(){
  if (!("serviceWorker" in navigator) || !("PushManager" in window)){
    S.push.why = "この端末（またはブラウザ）は通知に対応していません。";
    return null;
  }
  if (isIos() && !isStandalone()){
    S.push.why = "iPhone は、共有ボタンから「ホーム画面に追加」して、そこから開くと通知を受け取れます。";
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    S.push.ready = true;
    const sub = await reg.pushManager.getSubscription();
    S.push.on = !!sub;
    return reg;
  } catch(e){
    S.push.why = "通知の準備に失敗しました。";
    return null;
  }
}

// 公開鍵は base64url で来る。subscribe はバイト列しか受け取らない。
function keyToBytes(b64){
  const pad = b64.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(pad + "=".repeat((4 - pad.length % 4) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function pushTurnOn(){
  const reg = await pushRegister();
  if (!reg){ toast(S.push.why || "通知を使えません"); return; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted"){
    toast("通知が許可されませんでした。端末の設定からも変えられます。");
    return;
  }
  const r = await sb.functions.invoke("push", { body: { action: "key" } });
  const pub = r && r.data && r.data.publicKey;
  if (!pub){ toast("通知の鍵を取れませんでした"); return; }
  // ここは端末側の都合で落ちることがある（機内モード、通知サービスに繋がらない等）。
  // 黙って終わると押しても何も起きないように見えるので、必ず何か返す。
  let sub = null;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: keyToBytes(pub)
    });
  } catch(e){
    toast("この端末で通知を始められませんでした。少し時間をおいて、もう一度お試しください。");
    return;
  }
  const j = sub.toJSON();
  // endpoint が端末そのもの。同じ端末で入れ直しても増えないよう、それを鍵にする。
  await run(sb.from("push_subs").upsert({
    member_id: S.me.id, endpoint: j.endpoint,
    p256dh: j.keys.p256dh, auth: j.keys.auth,
    label: (navigator.userAgent.match(/iPhone|iPad|Android|Mac|Windows/) || ["端末"])[0]
  }, { onConflict: "endpoint" }), "この端末に通知が届くようにしました");
  S.push.on = true;
  render();
}

async function pushTurnOff(){
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub){
      await sb.from("push_subs").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch(e){ /* 端末側が先に消えていることがある */ }
  S.push.on = false;
  toast("この端末への通知を止めました");
  render();
}

/* ============================ auth ============================ */
async function boot(){
  applyTheme();
  applyFontSize();
  applyBarSize();
  S.tabBar = loadTabBar();
  S.siteCode = urlSiteCode();
  // ログイン前の画面にもボードの名前を出す（招待コードと同じ行なので、名前だけを関数で読む）。
  if (EDITABLE_BRAND){
    try {
      const b = await sb.rpc("board_brand");
      if (b && !b.error){ setBrandFrom(b.data); BOARD_SEASON = (b.data && b.data.theme) || ""; }
    } catch(e){ /* 既定の名前のまま */ }
    applySeason();
  }
  // LINE の許可画面から戻ってきたところなら、先にログインを済ませる。
  if (LINE_LOGIN) await finishLineLogin();
  const { data } = await sb.auth.getSession();
  S.user = data && data.session ? data.session.user : null;
  sb.auth.onAuthStateChange(function(_e, session){
    const next = session ? session.user : null;
    const changed = (next && next.id) !== (S.user && S.user.id);
    S.user = next;
    if (changed){ S.reveal = {}; S.mode = ""; S.staffMe = null; refresh(); }
  });
  await refresh();
  subscribeLive();
  watchForStaleness();
  // 端末側の状態を見てから設定画面の表示を合わせる。
  pushRegister().then(function(){ if (S.screen === "app") render(); });
}
// 本文だけを開けた関数から読む。board_settings そのものは本部のみ（招待コードが同じ行にある）。
async function loadPrivacy(){
  if (S.privacy) return;
  const r = await sb.rpc("privacy_text");
  if (r && !r.error && typeof r.data === "string") S.privacy = r.data;
}
// ログイン前は rpc で読んだもの、本部は board_settings から来たものを使う。
function privacyText(){
  return ((S.settings && S.settings.privacy_text) || S.privacy || "").trim();
}
function privacyLink(){
  if (!privacyText()) return "";
  return '<p class="swap" style="margin-top:12px">' +
    '<button data-act="privacy">個人情報の取り扱い</button></p>';
}
function modalPrivacy(){
  showModal("個人情報の取り扱い",
    '<div style="white-space:pre-wrap;line-height:1.85;font-size:13px">' +
      linkify(privacyText()) + "</div>",
    '<button class="btn" data-act="close-modal">閉じる</button>');
}
async function refresh(){
  if (S.user) S.form = {};
  if (!S.user){
    // 入り口コード付きの URL はスタッフ用。素の URL は本部のログイン。
    await loadPrivacy();
    if (S.siteCode){ await loadGate(S.siteCode); S.screen = "sitegate"; S.ready = true; render(); return; }
    if (!S.mode){
      const r = await sb.rpc("signup_mode");
      S.mode = (r && !r.error && r.data) ? r.data : "code";
    }
    S.screen = "auth"; S.ready = true; render(); return;
  }
  // ログイン済みなら、まず本部メンバーかスタッフかを見分ける。
  const st = await sb.from("staff").select(STAFF_COLS).eq("auth_user_id", S.user.id).maybeSingle();
  S.staffMe = st.data ? normStaff(st.data) : null;
  if (S.staffMe){
    try { await loadStaffAll(); } catch(e){ /* 下で空として描く */ }
    if (!siteTabs().some(t => t.id === S.siteTab)) S.siteTab = (siteTabs()[0] || {}).id || "att";
    S.screen = "staff"; S.ready = true; render(); return;
  }
  if (!S.mode){
    const r = await sb.rpc("signup_mode");
    S.mode = (r && !r.error && r.data) ? r.data : "code";
  }
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
      ? (S.mode === "code" ? "招待コードが違うか、登録が許可されていません。管理者に確認してください。"
         : "登録が許可されていません。管理者に確認してください。")
      : error.message;
    render(); return;
  }
  await refresh();
}
async function signUp(){
  const email = valOf("au_email"), pw = valOf("au_pw");
  if (!email || pw.length < 8){ S.authErr = "メールアドレスと、8文字以上のパスワードを入力してください。"; render(); return; }
  S.busy = true; S.authErr = ""; render();
  const code = valOf("au_code");
  const { data, error } = await sb.auth.signUp({
    email: email, password: pw, options: { data: { invite_code: code } }
  });
  S.busy = false;
  if (error){
    // 招待コードが違う（許可リストに無い）登録は確認メールに回され、Supabase 標準の
    // メール送信がそれを断るので、英語の「Email address ... is invalid」や送信回数の
    // 上限エラーとして返ってくる。アドレスの誤りに見えるが、実際はコード違い。
    const refused = S.mode !== "open" && (
      /email_address_invalid|email_address_not_authorized|over_email_send_rate_limit/.test(error.code || "") ||
      /is invalid|not authorized|rate limit/i.test(error.message));
    S.authErr = /already registered/i.test(error.message)
      ? "このメールアドレスは登録済みです。「ログイン」から入ってください。"
      : refused
      ? (S.mode === "code" ? "招待コードが違います。管理者から聞いたコードを確かめてください。"
         : "このメールアドレスは登録が許可されていません。管理者に確認してください。")
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
      S.authErr = "アカウントを作成しました。このままログインしてください。";
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
      ? (LINE_LOGIN
          ? "招待コードが違うか、入っていません。下の「戻る」から、招待コードを入れてもう一度 LINE でログインしてください。"
          : S.mode === "code" ? "招待コードが違うか、登録が許可されていません。管理者に確認してください。"
          : "登録が許可されていません。管理者に確認してください。")
      : error.message;
    render(); return;
  }
  await refresh();
}
async function signOut(){ await sb.auth.signOut(); S.reveal = {}; await refresh(); }

/* ============================ LINE でログイン（addons/line） ============================ */
// 戻り先は LINE Developers の「コールバックURL」に登録したものと一字一句同じでないと断られる。
// クエリを付けない、このページそのものにする。
const lineRedirect = () => location.origin + location.pathname;
function randomToken(){
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
}
// state に nonce と招待コードを入れて LINE に預ける。iPhone では Safari で始めても、
// 許可のあと LINE アプリの中のブラウザに戻ってくることがあり、始めたブラウザに
// 覚えさせたものは戻った先から読めないため（実際にそれでログインが打ち切られた）。
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
function startLineLogin(){
  const nonce = randomToken();
  const state = randomToken() + "." + b64u(JSON.stringify({ n: nonce, c: valOf("au_code") }));
  // 同じブラウザに戻ってきたときは、自分が始めたものかどうかも確かめる。
  try { sessionStorage.setItem("board.line", state); } catch(e){ /* 戻り先で state だけを使う */ }
  const q = new URLSearchParams({
    response_type: "code", client_id: LINE_LOGIN, redirect_uri: lineRedirect(),
    state: state, scope: "profile openid", nonce: nonce,
    // ログインと同時に公式アカウントの友だち追加をすすめる。友だちでないと通知が届かない。
    bot_prompt: "aggressive"
  });
  location.href = "https://access.line.me/oauth2/v2.1/authorize?" + q.toString();
}
async function finishLineLogin(){
  const q = new URLSearchParams(location.search);
  if (!q.has("state") || !(q.has("code") || q.has("error"))) return;
  let started = null;
  try { started = sessionStorage.getItem("board.line"); sessionStorage.removeItem("board.line"); } catch(e){}
  // 戻り値はアドレス欄から消しておく（再読み込みで同じ code を2回使わないため）。
  history.replaceState(null, "", lineRedirect() + location.hash);
  if (q.has("error")){
    S.authErr = q.get("error") === "access_denied" ? "LINE でのログインを取りやめました。" : "LINE でログインできませんでした。";
    return;
  }
  const state = q.get("state") || "";
  let carried = null;
  try { carried = JSON.parse(unb64u(state.split(".")[1] || "")); } catch(e){}
  // 同じブラウザで始めたのに state が違うなら、よそから差し込まれたものとして断る。
  // 別のブラウザに戻ってきたとき（started が無い）は、state に入れた nonce を LINE 側で照合する。
  if (!carried || !carried.n || (started && started !== state)){
    S.authErr = "ログインを確かめられませんでした。もう一度「LINEでログイン」を押してください。";
    return;
  }
  const out = await sb.functions.invoke("line-login", { body: {
    code: q.get("code"), redirectUri: lineRedirect(), nonce: carried.n, inviteCode: carried.c || "" } });
  if (out.error || !out.data || !out.data.tokenHash){
    let msg = "LINE でログインできませんでした。もう一度お試しください。";
    try {
      const body = out.error && out.error.context ? await out.error.context.json() : null;
      if (body && body.error) msg = body.error;
    } catch(e){ /* 既定の文言 */ }
    S.authErr = msg; return;
  }
  S.lineName = out.data.name || "";
  const v = await sb.auth.verifyOtp({ token_hash: out.data.tokenHash, type: "email" });
  if (v.error) S.authErr = "ログインできませんでした。もう一度お試しください。";
}
// 本人が「どの通知を LINE で受け取るか」を切り替える。
async function toggleLineNotify(kind){
  const cur = Object.assign({ updates: true, morning: true, before: true, remind: true },
    (S.lineLink && S.lineLink.notify) || {});
  cur[kind] = !cur[kind];
  await run(sb.from("line_links").update({ notify: cur, updated_at: nowIso() }).eq("user_id", S.user.id));
  S.lineLink = Object.assign({}, S.lineLink, { notify: cur });
  render();
}
const valOf = id => { const n = el(id); return n ? n.value.trim() : ""; };

/* ============================ render: shell ============================ */
// 下のメニューに出す並び。人によって毎日開くタブが違うので、決め打たずに選ばせる。
// 端末ごとの好みなので、データベースではなくこの端末にだけ覚える。
const TAB_MAX = 5;
function tabIds(){ return visibleTabs().map(function(t){ return t.id; }); }
function loadTabBar(){
  const saved = (ls("prime.tabbar") || "").split(",")
    .filter(function(x){ return tabIds().indexOf(x) >= 0; });
  const uniq = saved.filter(function(x, i){ return saved.indexOf(x) === i; });
  return uniq.length ? uniq.slice(0, TAB_MAX) : tabIds().slice(0, TAB_MAX);
}
function saveTabBar(){ ls("prime.tabbar", S.tabBar.join(",")); render(); }
function moveTab(id, delta){
  const i = S.tabBar.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= S.tabBar.length) return;
  S.tabBar.splice(j, 0, S.tabBar.splice(i, 1)[0]);
  saveTabBar();
}
function showTab(id){
  if (S.tabBar.indexOf(id) >= 0) return;
  // 5つを超えると、1つあたりが狭くなって字が読めなくなる。
  if (S.tabBar.length >= TAB_MAX){ toast("下のメニューは" + TAB_MAX + "つまでです。どれかを外してください。"); return; }
  S.tabBar.push(id); saveTabBar();
}
function hideTab(id){
  // 全部外すと行き先がなくなる。1つは残す。
  if (S.tabBar.length <= 1){ toast("少なくとも1つは残してください。"); return; }
  S.tabBar = S.tabBar.filter(function(x){ return x !== id; });
  saveTabBar();
}
function resetTabBar(){ S.tabBar = tabIds().slice(0, TAB_MAX); saveTabBar(); }

const TABS = [
  { id:"home",   label:"ホーム",         short:"ホーム" },
  { id:"sched",  label:"スケジュール",   short:"予定" },
  { id:"tasks",  label:"タスク",         short:"タスク" },
  { id:"pay",    label:"支払い",         short:"支払" },
  { id:"sites",  label:"スタッフ拠点",   short:"拠点" },
  { id:"shops",  label:"店舗",           short:"店舗" },
  { id:"vault",  label:"ID /パス",       short:"ID" },
  { id:"set",    label:"設定",           short:"設定" }
];


// 本部のタスクと拠点のタスクは同じもの。site_id が null なら本部、値があればその拠点。
const hqTasks = () => S.tasks.filter(t => !t.siteId);
const openTasks = () => hqTasks().filter(t => t.status !== "done");
const wantedTasks = () => openTasks().filter(t => !t.assignee);
// 担当は本部メンバーか拠点スタッフのどちらか。認証の系統が別なので列が2つある。
const taskHasOwner = t => !!(t.assignee || t.staffAssignee);
const taskIsMine = t => (!!S.me && t.assignee === S.me.id) ||
                        (!!staffMeId() && t.staffAssignee === staffMeId());
function taskOwnerChip(t){
  if (t.assignee) return whoChip(t.assignee);
  if (t.staffAssignee) return '<span class="chip">' + h(staffName(t.staffAssignee)) + "</span>";
  return '<span class="chip brass">募集中</span>';
}
function taskDoneByName(t){
  if (t.doneBy) return (member(t.doneBy) || {}).name || "";
  if (t.staffDoneBy) return staffName(t.staffDoneBy);
  return "";
}
const taskSiteName = t => (t.siteId ? ((site(t.siteId) || {}).name || "拠点") : "本部");
const unpaid = () => S.payments.filter(p => p.status !== "paid");

/* ---- 自分だけの持ち物 ----
   tasks はチーム全員が読める前提の表なので、私物はそこに混ぜず notes に分けてある。
   既定は「自分だけ」で、本人が見せると決めた相手にだけ届く。 */
const SHARE_KEYS = ["private", "some", "all"];
const SHARE_LABEL = { private: "自分だけ", some: "選んだ人だけ", all: "本部の全員" };
const myNotes = () => S.notes.filter(x => S.me && x.owner === S.me.id);
// 自分のものでない = 誰かが自分に見せてくれたもの（RLS がそれ以外を返さない）
const notesToMe = () => S.notes.filter(x => !S.me || x.owner !== S.me.id);
const openMyNotes = () => myNotes().filter(x => x.kind === "task" && x.status !== "done");
function noteShareChip(x){
  // 「たかし」だけだと、見せている相手なのか書いた人なのか読めない。必ず向きを添える。
  if (x.share === "all") return '<span class="chip cool">本部の全員に公開</span>';
  if (x.share === "some"){
    const names = (x.sharedWith || []).map(id => (member(id) || {}).name).filter(Boolean);
    return '<span class="chip cool">' + h(names.length ? names.join("・") + " に公開" : "公開先が未選択") + "</span>";
  }
  return '<span class="chip">自分だけ</span>';
}
function sortNotes(list){
  return list.slice().sort(function(a, b){
    const rank = x => x.status === "done" ? 2 : x.kind === "task" ? 0 : 1;
    return rank(a) - rank(b) ||
      (a.due || "9999").localeCompare(b.due || "9999") ||
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function renderStale(){
  const bar = el("staleBar"), show = S.stale && (S.screen === "app" || S.screen === "staff");
  bar.hidden = !show;
  if (show){
    bar.innerHTML = '<span>最新の状態を取れませんでした。表示は前に読めたときのままです。</span>' +
      '<button class="btn sm" data-act="reload-all">読み直す</button>';
  }
}
function render(){
  const hq = S.screen === "app", staff = S.screen === "staff";
  el("masthead").hidden = !hq;
  el("tabsNav").hidden = !(hq || staff);
  renderStale();
  const v = el("view");
  if (!S.ready){ v.innerHTML = '<p class="empty" style="border:0">読み込み中…</p>'; return; }
  if (S.screen === "auth"){ v.className = ""; v.innerHTML = viewAuth(); return; }
  if (S.screen === "sitegate"){ v.className = ""; v.innerHTML = viewSiteGate(); return; }
  if (S.screen === "profile"){ v.className = ""; v.innerHTML = viewProfile(); return; }
  v.className = "wrap";
  if (staff){
    renderStaffBar(); renderStaffTabs();
    v.innerHTML = S.siteTab === "key" ? viewKey()
      : S.siteTab === "todo"  ? viewTasks()
      : S.siteTab === "shift" ? viewShift()
      : viewAtt();
    if (S.siteTab === "shift") scrollShiftToToday();
    return;
  }
  if (!tabOn(S.tab)) S.tab = "home";
  renderDoor(); renderHere(); renderTabs();
  v.innerHTML = S.tab === "sched" ? viewSched()
    : S.tab === "lists" ? viewLists()
    : S.tab === "shops" ? viewShops()
    : S.tab === "tasks" ? viewTasks()
    : S.tab === "pay"   ? viewPay()
    : S.tab === "sites" ? viewSites()
    : S.tab === "vault" ? viewVault()
    : S.tab === "set"   ? viewSettings()
    : viewHome();
  if (S.tab === "sites" && S.siteTab === "shift") scrollShiftToToday();
}
// スタッフ側は本部のヘッダーを出さず、拠点名と自分の名前だけを出す。
function renderStaffBar(){
  const t = curSite() || {};
  el("bannerBox").innerHTML =
    '<div class="wrap staff-bar"><span class="mark">' + h(BRAND) + "</span>" +
    '<span class="staff-site">' + h(t.name || "") + "</span>" +
    '<span class="spacer" style="flex:1"></span>' +
    '<button class="staff-me" data-act="my-pin">' + h(S.staffMe ? S.staffMe.name : "") +
      (S.staffMe && S.staffMe.role === "manager" ? '<span class="chip brass">店長</span>' : "") + "</button>" +
    '<button class="btn sm ghost" data-act="theme" aria-label="' + h(themeLabel()) + '">' + themeGlyph() + "</button>" +
    '<button class="btn sm ghost" data-act="signout">出る</button></div>';
}
function renderStaffTabs(){
  const tabs = siteTabs();
  el("tabs").innerHTML = tabs.map(t =>
    '<button class="tab" role="tab" aria-selected="' + (S.siteTab === t.id) + '" data-stab="' + t.id + '">' +
    '<span class="t-lg">' + h(t.label) + '</span><span class="t-sm">' + h(t.short) + "</span></button>").join("");
}
function tabBadges(){
  return { set: S.feedback.filter(f => !f.done).length, tasks: wantedTasks().length,
           pay: unpaid().filter(p => { const n = daysUntil(p.due); return n !== null && n <= 0; }).length };
}
function tabButton(t, badges){
  return '<button class="tab" role="tab" aria-selected="' + (S.tab === t.id) + '" data-tab="' + t.id + '">' +
    '<span class="t-lg">' + h(t.label) + '</span><span class="t-sm">' + h(t.short) + "</span>" +
    (badges[t.id] ? '<span class="badge num">' + badges[t.id] + "</span>" : "") + "</button>";
}
function renderTabs(){
  const badges = tabBadges();
  const shown = S.tabBar.map(function(id){ return visibleTabs().find(function(t){ return t.id === id; }); }).filter(Boolean);
  const rest = visibleTabs().filter(function(t){ return S.tabBar.indexOf(t.id) < 0; });
  // 外したタブも「その他」から必ず開ける。設定を外して設定に戻れない、をなくす。
  const restBadge = rest.reduce(function(a, t){ return a + (badges[t.id] || 0); }, 0);
  el("tabs").innerHTML = shown.map(function(t){ return tabButton(t, badges); }).join("") +
    (rest.length
      ? '<button class="tab" role="tab" aria-selected="' +
        rest.some(function(t){ return t.id === S.tab; }) + '" data-act="more-tabs">' +
        '<span class="t-lg">その他</span><span class="t-sm">その他</span>' +
        (restBadge ? '<span class="badge num">' + restBadge + "</span>" : "") + "</button>"
      : "");
}
function modalMoreTabs(){
  const badges = tabBadges();
  showModal("ほかの画面",
    '<div class="pick-list">' + visibleTabs().map(function(t){
      return '<button class="pick' + (S.tab === t.id ? " on" : "") + '" data-tab="' + t.id + '">' +
        h(t.label) + (badges[t.id] ? ' <span class="badge num">' + badges[t.id] + "</span>" : "") +
        (S.tabBar.indexOf(t.id) >= 0 ? ' <span class="chip">下のメニュー</span>' : "") + "</button>";
    }).join("") + "</div>",
    '<button class="btn" data-act="close-modal">閉じる</button>');
}
// 持ち出しの状態は列に持たず、最後の記録から決める（鍵と同じ考え方）。
function deviceState(id){
  const last = S.deviceLog.find(x => x.deviceId === id);
  if (!last || last.kind === "in") return null;
  return last;
}
const devicesOut = () => S.devices.filter(d => d.active && deviceState(d.id))
  .map(d => ({ d: d, at: deviceState(d.id) }));
function renderDoor(){
  if (!uiHome("door")){
    el("doorBox").innerHTML = devicesOut().map(function(x){
      return '<span class="chip warn out-chip">' + h(x.d.name) + " " +
        h((member(x.at.memberId) || {}).name || "誰か") + " 持ち出し中</span>"; }).join("");
    return;
  }
  const open = !!S.office.doorOpen;
  const by = S.office.updatedBy ? (member(S.office.updatedBy) || {}).name : "";
  // 昨日以前の記録は、今日の状態の証拠にならない。日をまたいだら未確認に戻す。
  // そうしないと、何日も前に開けた人の名前が「いまの担当」のように出続ける。
  const fresh = !!S.office.updatedAt && jstDay(S.office.updatedAt) === today();
  el("doorBox").innerHTML =
    '<div class="door ' + (fresh ? (open ? "open" : "shut") : "unknown") + '">' +
      '<span class="lamp"></span>' +
      '<span class="txt"><b>' + h(PLACE) + " " +
        (fresh ? (open ? "あいてます" : "しまっています") : "未確認") + "</b>" +
        "<small>" + (fresh
          ? h((by || "誰か") + " が " + stamp(S.office.updatedAt))
          : "今日はまだ誰も記録していません") + "</small></span>" +
      '<span class="btn-row" style="margin-left:auto">' +
        (fresh
          ? '<button class="btn sm" data-act="door" data-v="' + (open ? "close" : "open") + '">' +
            (open ? "閉めた" : "開けた") + "</button>"
          // 未確認のときは、どちらを押すかを人が決める。片方だけ出すと、
          // 押した結果がその日の記録として残るので、勝手に決めてはいけない。
          : '<button class="btn sm" data-act="door" data-v="open">開けた</button>' +
            '<button class="btn sm" data-act="door" data-v="close">閉めた</button>') +
      "</span>" +
    "</div>" +
    // 持ち出されているものは、探す前に目に入る場所に出す。
    devicesOut().map(function(x){
      return '<span class="chip warn out-chip">' + h(x.d.name) + " " +
        h((member(x.at.memberId) || {}).name || "誰か") + " 持ち出し中</span>"; }).join("");
}
const themeEntry = () => THEMES.find(t => t[0] === S.theme) || THEMES[0];
const themeGlyph = () => themeEntry()[1];
const themeLabel = () => "表示: " + themeEntry()[2] + "（押すと切替）";
function renderHere(){
  const here = S.members.filter(m => m.present);
  el("hereBox").innerHTML =
    '<div class="avatars">' + S.members.map(m =>
      '<span class="av' + (m.present ? "" : " off") + '" style="background:' + h(m.color || "#888") + '" title="' +
      h(m.name + (m.present ? "・在席" : "・不在")) + '">' + h((m.name || "?").slice(0, 1)) + "</span>").join("") + "</div>" +
    '<span class="chip ' + (here.length ? "ok" : "") + '"><span class="dot"></span>在席 ' + here.length + " / " + S.members.length + "</span>" +
    (S.me && uiHome("present") ? '<button class="btn sm ' + (S.me.present ? "" : "primary") + '" data-act="present">' +
      (S.me.present ? "出た" : "入った") + "</button>" : "") +
    '<button class="themebtn" data-act="theme" title="' + h(themeLabel()) + '" aria-label="' + h(themeLabel()) + '">' +
      h(themeGlyph()) + "</button>";
}

/* ============================ view: ログイン / プロフィール ============================ */
// LINE で入るボードの入口。メールとパスワードは出さない。
function viewAuthLine(){
  return '<div class="gate"><div class="gate-card">' +
    '<div class="brand" style="display:flex"><span class="mark">' + h(BRAND) + '</span><span class="sub">' + h(BRAND_SUB) + "</span></div>" +
    "<h1>ログイン</h1>" +
    '<p class="lead">LINE のアカウントで入ります。<br>はじめての人は、途中で出てくる公式アカウントを' +
      "友だちに追加してください（予定やリマインダーが LINE に届きます）。</p>" +
    (S.mode === "code"
      ? '<div class="fields"><label class="f">招待コード（はじめての人だけ）' +
          '<input type="text" id="au_code" autocomplete="off" placeholder="招待した人から聞いたコード" value="' +
          h(S.form.au_code || "") + '"></label></div>'
      : "") +
    (S.authErr ? '<p class="err">' + h(S.authErr) + "</p>" : "") +
    '<button class="btn line" style="width:100%" data-act="line-login"' + (S.busy ? " disabled" : "") + ">" +
      (S.busy ? "処理中…" : "LINEでログイン") + "</button>" +
    privacyLink() +
    supportLine() +
    "</div></div>";
}
function viewAuth(){
  if (LINE_LOGIN) return viewAuthLine();
  const up = S.authMode === "up";
  return '<div class="gate"><div class="gate-card">' +
    '<div class="brand" style="display:flex"><span class="mark">' + h(BRAND) + '</span><span class="sub">' + h(BRAND_SUB) + "</span></div>" +
    "<h1>" + (up ? "アカウントを作る" : "ログイン") + "</h1>" +
    '<p class="lead">' + (up
      ? (S.mode === "code"
          ? "管理者から聞いた招待コードを入れてください。<br>パスワードは8文字以上にしてください。"
          : "メールアドレスとパスワードを決めるだけで始められます。<br>パスワードは8文字以上にしてください。")
      : "スタッフ用の共有ボードです。") + "</p>" +
    '<div class="fields">' +
      '<label class="f">メールアドレス<input type="email" id="au_email" autocomplete="username" inputmode="email" value="' + h(S.form.au_email || "") + '"></label>' +
      '<label class="f">パスワード<input type="password" id="au_pw" autocomplete="' + (up ? "new-password" : "current-password") + '" value="' + h(S.form.au_pw || "") + '"></label>' +
      (up && S.mode === "code" ? '<label class="f">招待コード<input type="text" id="au_code" autocomplete="off" placeholder="管理者から聞いたコード" value="' + h(S.form.au_code || "") + '"></label>' : "") +
    "</div>" +
    (S.authErr ? '<p class="err">' + h(S.authErr) + "</p>" : "") +
    '<button class="btn primary" style="width:100%" data-act="' + (up ? "signup" : "signin") + '"' + (S.busy ? " disabled" : "") + ">" +
      (S.busy ? "処理中…" : up ? "登録する" : "ログイン") + "</button>" +
    '<p class="swap">' + (up ? "すでにアカウントがある方は " : "はじめての方は ") +
      '<button data-act="authmode" data-v="' + (up ? "in" : "up") + '">' + (up ? "ログイン" : "アカウント作成") + "</button></p>" +
    privacyLink() +
    "</div></div>";
}
function viewProfile(){
  return '<div class="gate"><div class="gate-card">' +
    "<h1>表示名を決めてください</h1>" +
    '<p class="lead">スケジュール・タスク・在席表示に使われる名前です。<br>あとから「設定」タブで変更できます。</p>' +
    '<div class="fields">' +
      '<label class="f">名前<input type="text" id="pf_name" maxlength="12" placeholder="例：ゆうな" value="' + h(S.form.pf_name || S.lineName.slice(0, 12) || "") + '"></label>' +
      '<label class="f">色<div class="colorpick" id="pf_colors">' +
        PALETTE.map(c => '<button type="button" data-act="draft-color" data-v="' + c + '" aria-pressed="' +
          (S.draftColor === c) + '" style="background:' + c + '" aria-label="' + c + '"></button>').join("") + "</div></label>" +
    "</div>" +
    (S.authErr ? '<p class="err">' + h(S.authErr) + "</p>" : "") +
    '<button class="btn primary" style="width:100%" data-act="create-profile"' + (S.busy ? " disabled" : "") + ">" +
      (S.busy ? "作成中…" : "はじめる") + "</button>" +
    '<p class="swap"><button data-act="signout">' + (LINE_LOGIN ? "戻る" : "別のアカウントでログイン") + "</button></p>" +
    "</div></div>";
}

/* ============================ お知らせ・共通予定 ============================ */
// Team-wide entries: a whole-team meeting, a call with a media rep, or a plain
// announcement such as a new staff member joining.
// 本文に貼られた URL は、そのままだと1行を丸ごと占めて本文が読めなくなる。
// 先にエスケープしてから短いリンクに置き換える（順番を逆にすると危ない）。
function linkify(text){
  return h(String(text || "")).replace(/https?:\/\/[^\s<>"']+/g, function(u){
    const label = u.replace(/^https?:\/\//, "").replace(/^www\./, "");
    // 後ろを切ると、末尾だけが違う URL が全部同じ見た目になる（入り口コードなど）。
    // 真ん中を省いて、頭と末尾を残す。
    const short = label.length > 34 ? label.slice(0, 15) + "…" + label.slice(-16) : label;
    return '<a href="' + u + '" target="_blank" rel="noopener noreferrer" class="in-link">' +
      short + "</a>";
  });
}
function noticeRow(n){
  const d = n.date ? daysUntil(n.date) : null;
  const meeting = n.kind === "meeting";
  const when = n.date
    ? '<span class="chip ' + (d === null ? "" : d < 0 ? "" : d === 0 ? "warn" : d <= 7 ? "cool" : "") + '">' +
      h(md(n.date)) + "(" + DOW[new Date(n.date + "T00:00:00").getDay()] + ")" +
      (d === 0 ? " 今日" : d === 1 ? " 明日" : "") + "</span>"
    : "";
  const whenMore = [n.at_time, n.place].filter(Boolean).join(" ・ ");
  // 掲示板として読めるように、上から「いつ・何の話か」→「見出し」→「本文」→「誰がいつ」。
  // 見出しと編集ボタンを同じ行に並べると、見出しが折り返して読みにくくなる。
  return '<article class="note' + (n.pinned ? " pin" : "") + '">' +
    '<div class="note-top">' +
      (n.pinned ? '<span class="chip brass">重要</span>' : "") +
      (meeting ? '<span class="chip cool">会議</span>' : "") + when +
      (whenMore ? '<span class="note-when">' + h(whenMore) + "</span>" : "") +
    "</div>" +
    '<h3 class="note-title">' + h(n.title) + "</h3>" +
    (n.body ? '<div class="note-body">' + linkify(n.body) + "</div>" : "") +
    (n.decided ? '<div class="decided"><span class="done-tag">決まったこと</span>' + linkify(n.decided) + "</div>" : "") +
    (n.url ? '<div class="note-link"><a href="' + h(n.url) + '" target="_blank" rel="noopener noreferrer">リンクを開く ↗</a></div>' : "") +
    '<div class="note-foot">' +
      "<span>" + h((member(n.created_by) || {}).name || "") +
        (n.created_at ? " ・ " + h(stamp(n.created_at)) : "") + "</span>" +
      '<button class="btn sm ghost" data-act="edit-notice" data-id="' + h(n.id) + '">編集</button>' +
    "</div></article>";
}
function sortedNotices(){
  return S.notices.slice().sort(function(a, b){
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ad = a.date ? daysUntil(a.date) : null, bd = b.date ? daysUntil(b.date) : null;
    // upcoming dated items first, then undated, then past
    const rank = x => x === null ? 1 : x >= 0 ? 0 : 2;
    if (rank(ad) !== rank(bd)) return rank(ad) - rank(bd);
    if (ad !== null && bd !== null) return rank(ad) === 2 ? bd - ad : ad - bd;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}
function modalNotice(n){
  n = n || {};
  const isMeeting = n.kind === "meeting";
  showModal(n.id ? (isMeeting ? "会議を編集" : "お知らせを編集") : "お知らせ・会議を追加",
    '<div class="fields">' +
    '<label class="f">種類<select id="nt_kind">' +
      '<option value="notice"' + (isMeeting ? "" : " selected") + ">お知らせ・共通予定</option>" +
      '<option value="meeting"' + (isMeeting ? " selected" : "") + ">会議</option></select></label>" +
    '<label class="f">見出し<input type="text" id="n_title" maxlength="80" value="' + h(n.title || "") + '" placeholder="例：全体ミーティング / 新人スタッフが入りました"></label>' +
    '<div class="fields two">' +
      '<label class="f">日付（お知らせだけなら空でも可）<input type="date" id="n_date" value="' + h(n.date || "") + '"></label>' +
      // 「17時以降」「夕方」のように決まりきらないことのほうが多い。
      // 時計の入力だと、決まっていない時間を書けずに空欄で出すことになる。
      '<label class="f">時間<input type="text" id="nt_time" list="dl_time" maxlength="20" value="' +
        h(n.at_time || "") + '" placeholder="例：17時以降 / 夕方 / 14:00〜"></label></div>' +
    '<datalist id="dl_time">' + TIME_HINTS.map(x => '<option value="' + h(x) + '">').join("") + "</datalist>" +
    '<div class="presets">' + TIME_HINTS.map(x =>
      '<button type="button" class="preset" data-act="time-preset" data-v="' + h(x) + '">' + h(x) + "</button>").join("") + "</div>" +
    '<label class="f">場所<input type="text" id="nt_place" maxlength="60" value="' + h(n.place || "") + '" placeholder="例：事務所 / オンライン"></label>' +
    '<label class="f">内容・議題<textarea id="n_body" placeholder="話すこと、共有したいこと">' + h(n.body || "") + "</textarea></label>" +
    '<label class="f">決まったこと（会議のあとに書く）<textarea id="nt_decided" placeholder="例：10月から受付時間を1時間延ばす。担当はかいと。">' +
      h(n.decided || "") + "</textarea></label>" +
    '<label class="f">リンク<input type="url" id="n_url" value="' + h(n.url || "") + '" placeholder="https://"></label>' +
    '<label class="f" style="flex-direction:row;align-items:center;gap:8px">' +
      '<input type="checkbox" id="n_pin" style="width:auto"' + (n.pinned ? " checked" : "") + ">上に固定する（重要）</label></div>",
    (n.id ? '<button class="btn danger left" data-act="del-notice" data-id="' + h(n.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-notice" data-id="' + h(n.id || "") + '">保存</button>');
}
async function saveNoticeFromModal(id){
  const title = valOf("n_title");
  if (!title){ toast("見出しを入力してください"); return; }
  const pin = el("n_pin");
  const body = { title: title, date: valOf("n_date") || null, body: valOf("n_body"),
    url: valOf("n_url"), pinned: !!(pin && pin.checked), updated_at: nowIso(),
    kind: valOf("nt_kind") || "notice", at_time: valOf("nt_time"),
    place: valOf("nt_place"), decided: valOf("nt_decided") };
  if (id) await run(sb.from("notices").update(body).eq("id", id), "保存しました");
  else { body.created_by = S.me.id; await run(sb.from("notices").insert(body), "登録しました"); }
  closeModal();
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
        ((d.from || d.to) ? '<span class="chip"><span class="num">' + h(d.from || "--:--") + "〜" + h(d.to || "--:--") + "</span></span>" : "") +
        (m.present ? '<span class="chip ok"><span class="dot"></span>在席</span>' : "") + "</div>" +
    "</div><div>" +
      '<div class="today-plan' + (d.plan ? "" : " blank") + '">' + (d.plan ? h(d.plan) : "今日の動きは未記入") + "</div>" +
      (d.done ? '<div class="today-done"><span class="done-tag">やったこと</span>' + h(d.done) + "</div>" : "") + ng +
      (d.url ? '<div style="margin-top:4px"><a href="' + h(d.url) + '" target="_blank" rel="noopener noreferrer" style="font-size:12.5px">関連リンクを開く ↗</a></div>' : "") +
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
  const notices = sortedNotices();
  return '<div class="grid-home"><div>' +
      '<section class="sec"><div class="sec-head"><h2>お知らせ・共通予定</h2>' +
        '<span class="hint">全体ミーティングや打ち合わせ、共有事項など。</span>' +
        '<div class="spacer"></div><button class="btn sm primary" data-act="new-notice">＋ 追加</button></div>' +
        '<div class="panel"><div class="rows" style="border-top:0">' +
        (notices.length ? notices.map(function(x){ return noticeRow(x); }).join("")
          : '<div class="empty">お知らせはありません</div>') + "</div></div>" +
      "</section>" +
      '<section class="sec"><div class="sec-head"><div class="eyebrow">' + h(today().replace(/-/g,"/")) + " (" + DOW[new Date().getDay()] + ")" +
        '</div><div class="spacer"></div><span class="hint">今日の全員の動き</span></div>' +
        '<h2 style="font-family:var(--serif);font-size:19px;margin-bottom:12px">今日は誰が、何をしていますか</h2>' +
        '<div class="panel">' + (S.members.length ? S.members.map(todayRow).join("") : '<div class="empty">メンバーがいません</div>') + "</div></section>" +
      (tabOn("tasks") ? '<section class="sec"><div class="sec-head"><h2>手が空いている人へ</h2>' +
        '<span class="hint">担当が決まっていない作業です。引き受けると自分のタスクになります。</span></div>' +
        '<div class="panel">' + (wanted.length ? wanted.map(function(t){ return taskRow(t); }).join("") : '<div class="empty">募集中の作業はありません</div>') + "</div></section>" : "") +
    "</div><div>" +
      (tabOn("tasks") ? '<section class="sec"><div class="sec-head"><h2>いまの持ち分</h2></div>' +
        '<div class="panel"><div class="rows" style="border-top:0">' +
        (load.length ? load.map(x =>
          '<div class="row" style="align-items:center"><span class="who" style="flex:1"><span class="pip" style="background:' + h(x.m.color) + '"></span>' +
          h(x.m.name) + '</span><span class="num" style="font-size:17px;font-weight:600;color:' + (x.n >= 4 ? "var(--bad)" : x.n ? "var(--ink)" : "var(--muted)") + '">' +
          x.n + '</span><span style="font-size:11px;color:var(--muted);align-self:flex-end;padding-bottom:3px">件</span></div>').join("")
          : '<div class="empty">—</div>') + "</div></div></section>" +
      '<section class="sec"><div class="sec-head"><h2>期限が近い</h2></div>' +
        '<div class="panel">' + (soon.length ? soon.map(function(t){ return taskRow(t, true); }).join("") : '<div class="empty">7日以内の期限はありません</div>') + "</div></section>" : "") +
      (tabOn("pay") ? '<section class="sec"><div class="sec-head"><h2>支払い予定</h2><div class="spacer"></div>' +
        '<span class="chip ' + (unpaid().length ? "warn" : "ok") + '">未払い ' + unpaid().length + "件</span></div>" +
        '<div class="panel"><div class="rows" style="border-top:0">' +
        (bills.length ? bills.map(p =>
          '<div class="row" style="align-items:center;gap:10px"><div style="flex:1;min-width:0">' +
          '<div style="font-size:13.5px;font-weight:500">' + h(p.title) + "</div>" +
          '<div style="margin-top:3px;display:flex;gap:6px;flex-wrap:wrap">' + dueChip(p.due) +
          (p.payee ? '<span class="chip">' + h(p.payee) + "</span>" : "") + "</div></div>" +
          '<span class="num" style="font-weight:600">' + h(yen(p.amount)) + "</span></div>").join("")
          : '<div class="empty">未払いはありません</div>') + "</div></div></section>" : "") +
      (uiHome("devices") ? homeDevices() : "") +
      (REMINDERS && uiHome("reminders") ? homeReminders() : "") +
      (uiHome("notes") ? homeNotes() : "") +
    "</div></div>";
}

// 事務所から持ち出すもの。鍵と同じで、状態は最後の記録から決まる。
function homeDevices(){
  const list = S.devices.filter(d => d.active);
  if (!list.length) return "";
  return '<section class="sec"><div class="sec-head"><h2>' + h(PLACE) + "から持ち出すもの</h2></div>" +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    list.map(function(d){
      const at = deviceState(d.id);
      const who = at ? ((member(at.memberId) || {}).name || "誰か") : "";
      return '<div class="row" style="align-items:center;gap:10px">' +
        '<span style="flex:1;min-width:0">' +
          '<span style="font-size:13.5px;font-weight:500">' + h(d.name) + "</span>" +
          '<div style="font-size:11.5px;color:var(--muted)">' +
            (at ? h(who + " が " + stamp(at.happenedAt) + " に持ち出し") + (at.note ? " ・ " + h(at.note) : "")
                : PLACE + "にあります") + "</div></span>" +
        '<span class="chip ' + (at ? "warn" : "ok") + '">' + (at ? "持ち出し中" : "あり") + "</span>" +
        '<button class="btn sm' + (at ? "" : " primary") + '" data-act="device" data-id="' + h(d.id) +
          '" data-v="' + (at ? "in" : "out") + '">' + (at ? "返した" : "持ち出す") + "</button></div>";
    }).join("") + "</div></div></section>";
}

/* ============================ リマインダー（addons/line） ============================ */
// 時刻になったら LINE に届く。宛先を選ばなければ自分だけ。送ったものは1日だけ残して見せる。
const remWhen = iso => { const d = new Date(iso); return isNaN(d) ? "" :
  (d.getMonth() + 1) + "/" + d.getDate() + "（" + DOW[d.getDay()] + "）" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
function remTargetsText(r){
  const ids = (r.targets || []).length ? r.targets : [r.created_by];
  return ids.map(function(id){ const m = member(id); return m ? m.name : "?"; }).join("・");
}
function homeReminders(){
  const cutoff = Date.now() - 86400000;
  const list = S.reminders.filter(function(r){ return !r.sent_at || new Date(r.sent_at).getTime() > cutoff; });
  return '<section class="sec"><div class="sec-head"><h2>リマインダー</h2>' +
    '<span class="hint">時刻になると LINE に届きます。</span><div class="spacer"></div>' +
    '<button class="btn sm primary" data-act="new-reminder">＋ 追加</button></div>' +
    '<div class="panel">' + (list.length ? '<div class="rows" style="border-top:0">' + list.map(function(r){
      const mine = S.me && r.created_by === S.me.id;
      return '<div class="row" style="align-items:center;gap:10px">' +
        '<span style="flex:1;min-width:0"><span style="font-weight:600">' + h(remWhen(r.remind_at)) + "</span> " +
          h(r.text) + '<br><span style="font-size:12px;color:var(--muted)">' +
          (mine ? "宛先：" + h(remTargetsText(r)) : "From " + h((member(r.created_by) || {}).name || "?")) + "</span></span>" +
        (r.sent_at ? '<span class="chip ok">送りました</span>' : "") +
        (mine ? '<button class="btn sm ghost" data-act="del-reminder" data-id="' + h(r.id) + '">消す</button>' : "") +
        "</div>";
    }).join("") + "</div>" : '<div class="empty">予定しているリマインダーはありません</div>') +
    "</div></section>";
}
function modalReminder(){
  const now = new Date(Date.now() + 3600000);
  showModal("リマインダーを追加",
    '<div class="fields">' +
      '<label class="f">内容<input type="text" id="rm_text" maxlength="300" placeholder="例：〇〇さんに電話"></label>' +
      '<div class="fields two"><label class="f">日付<input type="date" id="rm_date" value="' + ymd(now) + '"></label>' +
      '<label class="f">時刻<input type="time" id="rm_time" value="' + pad(now.getHours()) + ':00"></label></div>' +
      '<div class="f">送る相手<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">' +
        S.members.map(function(m){
          return '<label style="display:flex;align-items:center;gap:6px;font-size:14px">' +
            '<input type="checkbox" class="rm_to" value="' + h(m.id) + '"' + (S.me && m.id === S.me.id ? " checked" : "") + ">" +
            h(m.name) + "</label>";
        }).join("") + "</div></div>" +
    "</div>",
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-reminder">追加する</button>');
}
async function saveReminder(){
  const text = valOf("rm_text"), date = valOf("rm_date"), time = valOf("rm_time");
  if (!text){ toast("内容を入れてください"); return; }
  if (!date || !time){ toast("日付と時刻を入れてください"); return; }
  const at = new Date(date + "T" + time + ":00");
  if (isNaN(at) || at.getTime() < Date.now() - 60000){ toast("これからの時刻を選んでください"); return; }
  const to = Array.from(document.querySelectorAll(".rm_to:checked")).map(function(x){ return x.value; });
  if (!to.length){ toast("送る相手を1人以上選んでください"); return; }
  // 自分だけなら空で持つ（DB 側で「作った本人」に送る）。
  const targets = (to.length === 1 && S.me && to[0] === S.me.id) ? [] : to;
  await run(sb.from("reminders").insert({ text: text, remind_at: at.toISOString(), targets: targets }), "追加しました");
  closeModal();
}

// 自分用はホームにも小さく出しておく。タブを開かないと思い出せないものは書かれない。
function homeNotes(){
  const mine = sortNotes(openMyNotes()).slice(0, 4);
  const shared = sortNotes(notesToMe().filter(x => x.status !== "done")).slice(0, 3);
  const rows = mine.map(function(x){ return noteRow(x, false); })
    .concat(shared.map(function(x){ return noteRow(x, true); }));
  return '<section class="sec"><div class="sec-head"><h2>自分用</h2><div class="spacer"></div>' +
    '<button class="btn sm primary" data-act="new-note">＋ 追加</button></div>' +
    '<div class="panel">' + (rows.length ? rows.join("")
      : '<div class="empty">自分だけのやること・メモはありません</div>') + "</div></section>";
}

/* ============================ view: スケジュール ============================ */
function shiftMonth(delta){
  const p = S.month.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  S.month = d.getFullYear() + "-" + pad(d.getMonth() + 1);
  loadAll().then(render);
}
// その日に出ているお知らせ・会議。カレンダーのマスと、開いた日の両方で使う。
function noticesOn(date){
  return sortedNotices().filter(function(n){ return n.date === date; });
}
// 月のマス1つ。誰がどう動くかを、名前と1〜2文字の区分で並べる。
function monthCell(ym, d, t){
  const date = ym + "-" + pad(d), w = dow(ym, d);
  const who = S.members.map(function(m){
    const day = dayOf(m.id, date);
    if (!day) return "";
    // 区分も中身も無い日は、書かれていないのと同じなので出さない。
    if (!(day.kind || day.plan || day.done || day.ngFrom || day.ngTo || day.note || day.url)) return "";
    const K = KINDS[day.kind || ""];
    return '<span class="mc-who ' + K.cls + '">' +
      '<span class="pip" style="background:' + h(m.color) + '"></span>' +
      '<span class="mc-nm">' + h(m.name) + "</span>" +
      // スマホの1マスに名前は入らないので、そこは頭の1文字に切り替える。
      '<span class="mc-ab">' + h(String(m.name).slice(0, 1)) + "</span>" +
      '<span class="mc-k">' + h(K.mini) + "</span>" +
      ((day.ngFrom || day.ngTo) ? '<span class="m ngm"></span>' : "") +
      (day.done ? '<span class="m donem"></span>' : "") + "</span>";
  }).join("");
  const nt = noticesOn(date);
  return '<td class="mc' + (w === 0 ? " sun" : w === 6 ? " sat" : "") +
    (date === t ? " today" : "") + '">' +
    '<button class="mc-in" data-act="open-day" data-date="' + date + '" aria-label="' + h(date) + '">' +
      '<span class="mc-d">' + d + "</span>" +
      nt.map(function(x){
        return '<span class="mc-nt' + (x.kind === "meeting" ? " meet" : "") + '">' +
          h(x.at_time ? x.at_time + " " : "") + h(x.title) + "</span>"; }).join("") +
      who +
    "</button></td>";
}
function viewSched(){
  const ym = S.month, n = daysInMonth(ym), t = today();
  const label = ym.slice(0, 4) + "年" + Number(ym.slice(5, 7)) + "月";
  // 1ヶ月をまるごと1画面に出す。横に長い表だとスマホで端が見えず、
  // 「その月がどうなっているか」という一番読みたいことが読めない。
  const rows = [];
  let row = [];
  for (let i = 0; i < dow(ym, 1); i++) row.push('<td class="mc pad"></td>');
  for (let d = 1; d <= n; d++){
    row.push(monthCell(ym, d, t));
    if (row.length === 7){ rows.push(row); row = []; }
  }
  if (row.length){
    while (row.length < 7) row.push('<td class="mc pad"></td>');
    rows.push(row);
  }
  const head = "<tr>" + DOW.map(function(w, i){
    return '<th class="' + (i === 0 ? "sun" : i === 6 ? "sat" : "") + '">' + w + "</th>"; }).join("") + "</tr>";

  const ngList = [], doneList = [];
  S.members.forEach(m => {
    for (let d = 1; d <= n; d++){
      const date = ym + "-" + pad(d), day = dayOf(m.id, date);
      if (!day) continue;
      if (day.ngFrom || day.ngTo) ngList.push({ m: m, date: date, d: day });
      if ((day.done || "").trim()) doneList.push({ m: m, date: date, d: day });
    }
  });

  return '<section class="sec"><div class="sec-head"><h2>' + h(label) + "</h2>" +
    '<span class="hint">日を押すと、その日の全員の動きが出ます。</span>' +
    '<div class="btn-row month-nav">' +
    '<button class="btn sm" data-act="month" data-delta="-1" aria-label="前の月">' +
      '<span class="t-lg">← 前の月</span><span class="t-sm">←</span></button>' +
    '<button class="btn sm" data-act="month" data-delta="0">今月</button>' +
    '<button class="btn sm" data-act="month" data-delta="1" aria-label="次の月">' +
      '<span class="t-lg">次の月 →</span><span class="t-sm">→</span></button></div></div>' +
    '<table class="mcal"><thead>' + head + "</thead><tbody>" +
    rows.map(function(r){ return "<tr>" + r.join("") + "</tr>"; }).join("") +
    "</tbody></table>" +
    '<div class="legend">' +
      '<span><i style="background:var(--brass-soft);border:1px solid var(--brass-line)"></i>' + h(KINDS.office.mini + "＝" + KINDS.office.label) + "</span>" +
      '<span><i class="k-both-sw" style="border:1px solid var(--line)"></i>' + h(KINDS.both.mini + "＝" + KINDS.both.label) + "</span>" +
      '<span><i style="background:var(--cool-soft);border:1px solid var(--line)"></i>' + h(KINDS.home.mini + "＝" + KINDS.home.label) + "</span>" +
      '<span><i style="background:var(--warn-soft);border:1px solid var(--line)"></i>' + h(KINDS.out.mini + "＝" + KINDS.out.label) + "</span>" +
      '<span><i style="background:var(--bad-soft);border:1px solid var(--line)"></i>' + h(KINDS.off.mini + "＝" + KINDS.off.label) + "</span>" +
      '<span><i style="background:var(--bad);border-radius:50%"></i>連絡がつかない時間帯あり</span>' +
      '<span><i style="background:var(--ok);border-radius:50%"></i>やったこと記録あり</span>' +
    "</div></section>" +

    '<section class="sec"><div class="sec-head"><h2>やったこと（今月）</h2>' +
      '<span class="hint">日ごとの記録をまとめて読む場所です。直すときはカレンダーの日から。</span></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (doneList.length
      ? doneList.sort((a, b) => b.date.localeCompare(a.date) ||
          String(a.m.name).localeCompare(String(b.m.name), "ja")).map(function(x){
          return '<div class="done-row">' +
            '<span class="done-mark" aria-hidden="true">✓</span>' +
            '<div><div class="done-head">' +
              '<span class="num" style="color:var(--muted)">' + h(md(x.date)) +
              "(" + DOW[dow(ym, Number(x.date.slice(8, 10)))] + ")</span>" +
              '<span class="who"><span class="pip" style="background:' + h(x.m.color) + '"></span>' +
              h(x.m.name) + "</span></div>" +
            '<div class="done-body">' + h(x.d.done.trim()) + "</div></div></div>"; }).join("")
      : '<div class="empty">今月の記録はまだありません</div>') + "</div></div></section>" +

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
  const owned = taskHasOwner(t), mine = taskIsMine(t);
  const by = (member(t.createdBy) || {}).name || (t.staffCreatedBy ? staffName(t.staffCreatedBy) : "");
  const doneBy = taskDoneByName(t);
  return '<div class="t-row' + (done ? " done" : "") + (!owned && !done ? " wanted" : "") + '">' +
    '<button class="tick' + (done ? " on" : "") + '" data-act="toggle-task" data-id="' + h(t.id) + '" aria-label="完了切り替え">' + (done ? "✓" : "") + "</button>" +
    '<div><div class="t-title">' + h(t.title) + "</div>" +
      (t.detail ? '<div class="t-detail">' + h(t.detail) + "</div>" : "") +
      // 終わった人が次の人のために残すメモ。終わっても畳まない。
      (t.doneMemo ? '<div class="today-done">' + h(t.doneMemo) + "</div>" : "") +
      '<div class="t-meta">' +
        // 本部から見るときだけ、どこの仕事かを出す。スタッフ側は自分の拠点しか出ない。
        (isHq() ? '<span class="chip' + (t.siteId ? "" : " cool") + '">' + h(taskSiteName(t)) + "</span>" : "") +
        (isHq() ? shareChip(t) : "") +
        taskOwnerChip(t) + dueChip(t.due, done) +
        (t.status === "doing" ? '<span class="chip cool">進行中</span>' : "") +
        (done && doneBy ? '<span class="done-tag">' + h(doneBy) + " が完了</span>" : "") +
        '<span style="font-size:11px;color:var(--muted)">' + h(by) +
        (t.createdAt ? " が " + h(stamp(t.createdAt)) + " に登録" : "") + "</span></div></div>" +
    (compact ? "" : '<div class="t-acts">' +
      (!done && !owned ? '<button class="btn sm primary" data-act="take" data-id="' + h(t.id) + '">引き受ける</button>' : "") +
      (!done && mine && t.status !== "doing" ? '<button class="btn sm" data-act="start" data-id="' + h(t.id) + '">着手</button>' : "") +
      (!done && owned && !mine ? '<button class="btn sm" data-act="take" data-id="' + h(t.id) + '">代わる</button>' : "") +
      (!done && owned ? '<button class="btn sm ghost" data-act="release" data-id="' + h(t.id) + '">手放す</button>' : "") +
      '<button class="btn sm ghost" data-act="edit-task" data-id="' + h(t.id) + '">編集</button>' +
    "</div>") + "</div>";
}
function noteRow(x, fromOther){
  const done = x.status === "done", isTask = x.kind === "task";
  return '<div class="t-row' + (done ? " done" : "") + '">' +
    (isTask
      ? '<button class="tick' + (done ? " on" : "") + '"' + (fromOther ? " disabled" : "") +
        ' data-act="toggle-note" data-id="' + h(x.id) + '" aria-label="完了切り替え">' + (done ? "✓" : "") + "</button>"
      : '<span class="tick memo" aria-hidden="true">✎</span>') +
    '<div><div class="t-title">' + h(x.title) + "</div>" +
      (x.body ? '<div class="t-detail">' + h(x.body) + "</div>" : "") +
      '<div class="t-meta">' +
        (fromOther
          ? '<span class="chip brass">' + h((member(x.owner) || {}).name || "") + " から</span>"
          : noteShareChip(x)) +
        (isTask ? dueChip(x.due, done) : '<span class="chip">メモ</span>') +
        '<span style="font-size:11px;color:var(--muted)">' +
          (x.createdAt ? h(stamp(x.createdAt)) + " に作成" : "") + "</span></div></div>" +
    // 見せてもらっている側は読むだけ。書き換えも削除も持ち主にしかできない。
    (fromOther ? "" : '<div class="t-acts"><button class="btn sm ghost" data-act="edit-note" data-id="' +
      h(x.id) + '">編集</button></div>') + "</div>";
}
function taskSideSwitch(){
  if (!isHq()) return "";
  const myTeamCount = S.tasks.filter(t => taskIsMine(t) && t.status !== "done").length;
  const sides = [["team", "みんなの", S.tasks.length], ["mine", "自分用", myNotes().length + notesToMe().length + myTeamCount]];
  return '<div class="site-switch">' + sides.map(function(c){
    return '<button class="btn sm' + (S.noteSide === c[0] ? " primary" : "") + '" data-act="note-side" data-v="' +
      c[0] + '">' + c[1] + (c[2] ? " " + c[2] : "") + "</button>"; }).join("") + "</div>";
}
function viewNotes(){
  const mine = sortNotes(myNotes()), shared = sortNotes(notesToMe());
  const myTeamTasks = S.tasks.filter(t => taskIsMine(t) && t.status !== "done").sort((a,b) =>
    (a.due || "9999").localeCompare(b.due || "9999") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  return '<section class="sec"><div class="sec-head"><h2>自分用</h2>' +
    '<span class="hint">既定では自分にしか見えません。1件ずつ、誰に見せるかを選べます。</span>' +
    '<div class="btn-row"><button class="btn primary" data-act="new-note">＋ 追加</button></div></div>' +
    taskSideSwitch() +
    (myTeamTasks.length
      ? '<div class="sec-head" style="margin-bottom:8px"><h2>引き受けている全体タスク</h2>' +
        '<span class="hint">みんなのタスクの中で、自分が担当のもの。</span></div>' +
        '<div class="panel" style="margin-bottom:18px">' + myTeamTasks.map(function(t){ return taskRow(t); }).join("") + "</div>"
      : "") +
    '<div class="panel">' +
    (mine.length ? mine.map(function(x){ return noteRow(x, false); }).join("")
      : '<div class="empty">まだありません。やることでもメモでも、まず自分だけの場所に書けます。</div>') +
    "</div>" +
    (shared.length
      ? '<div class="sec-head" style="margin-top:22px"><h2>見せてもらっているもの</h2>' +
        '<span class="hint">相手が公開先に自分を入れたものです。読むだけで、書き換えはできません。</span></div>' +
        '<div class="panel">' + shared.map(function(x){ return noteRow(x, true); }).join("") + "</div>"
      : "") +
    "</section>";
}
function viewTasks(){
  if (isHq() && S.noteSide === "mine") return viewNotes();
  const f = S.taskFilter, hq = isHq();
  // 本部は全拠点ぶんを1つの画面で見て、置き場所で絞り込む。スタッフは自分の拠点だけ。
  const scoped = hq
    ? (S.taskSite === "all" ? S.tasks
       : S.taskSite === "hq" ? S.tasks.filter(t => !t.siteId)
       : S.tasks.filter(t => t.siteId === S.taskSite))
    : S.tasks.filter(t => t.siteId === S.siteId);
  const all = scoped.slice().sort((a,b) => {
    const rank = t => t.status === "done" ? 2 : taskHasOwner(t) ? 1 : 0;
    return rank(a) - rank(b) || (a.due || "9999").localeCompare(b.due || "9999") || (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  const list = all.filter(t =>
    f === "wanted" ? (!taskHasOwner(t) && t.status !== "done")
    : f === "mine" ? (taskIsMine(t) && t.status !== "done")
    : f === "done" ? t.status === "done"
    : t.status !== "done");
  const chips = [["all","未完了"],["wanted","募集中"],["mine","自分の分"],["done","完了"]];
  const scopes = [["all","すべて"],["hq","本部"]].concat(S.sites.map(x => [x.id, x.name]));
  return '<section class="sec"><div class="sec-head"><h2>やること</h2>' +
    '<span class="hint">担当を空にすると「募集中」になり、手が空いた人が引き受けられます。</span>' +
    '<div class="btn-row"><button class="btn primary" data-act="new-task">＋ 登録</button></div></div>' +
    taskSideSwitch() +
    (hq && S.sites.length
      ? '<div class="site-switch">' + scopes.map(c =>
          '<button class="btn sm' + (S.taskSite === c[0] ? " primary" : "") + '" data-act="task-site" data-v="' + h(c[0]) + '">' +
          h(c[1]) + "</button>").join("") + "</div>"
      : "") +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
    chips.map(c => '<button class="btn sm' + (f === c[0] ? " primary" : "") + '" data-act="task-filter" data-f="' + c[0] + '">' + c[1] + "</button>").join("") + "</div>" +
    '<div class="panel">' + (list.length ? list.map(function(t){ return taskRow(t); }).join("") : '<div class="empty">該当するものはありません</div>') + "</div></section>";
}

/* ============================ view: 支払い ============================ */
function shiftMonthStr(ym, delta){
  if (!delta) return today().slice(0, 7);
  const p = ym.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}
const paidDate = p => p.paidOn || (p.paidAt || "").slice(0, 10) || "";
// Expenses are read back a month at a time for the books, so total by category.
function expenseBreakdown(ym){
  const rows = S.payments.filter(p => p.status === "paid" && paidDate(p).slice(0, 7) === ym);
  const byCat = {}, order = [];
  rows.forEach(function(p){
    const c = (p.category || "").trim() || "未分類";
    if (!byCat[c]){ byCat[c] = { name: c, sum: 0, n: 0 }; order.push(byCat[c]); }
    byCat[c].sum += Number(p.amount || 0);
    byCat[c].n += 1;
  });
  order.sort((a, b) => b.sum - a.sum);
  return { rows: rows, cats: order, total: rows.reduce((a, p) => a + Number(p.amount || 0), 0) };
}
function viewPay(){
  const up = unpaid();
  const overdue = up.filter(p => { const n = daysUntil(p.due); return n !== null && n < 0; });
  const sum = up.reduce((a, p) => a + Number(p.amount || 0), 0);
  const showingPaid = S.payFilter === "paid";
  const brk = showingPaid ? expenseBreakdown(S.payMonth) : null;
  // 数え方が下の一覧とずれていると、金額と件数が合っていないように見える。
  // 絞り込みに合わせて数える範囲を変え、どの範囲なのかを見出しにも書く。
  const monthLabel = ym => Number(ym.slice(5, 7)) + "月の支払済";
  const paidRows = showingPaid ? brk.rows
    : S.payFilter === "all" ? S.payments.filter(p => p.status === "paid")
    : S.payments.filter(p => p.status === "paid" && paidDate(p).slice(0, 7) === today().slice(0, 7));
  const paidLabel = showingPaid ? monthLabel(S.payMonth)
    : S.payFilter === "all" ? "支払済 合計"
    : monthLabel(today());
  const paidSum = paidRows.reduce((a, p) => a + Number(p.amount || 0), 0);
  const list = (showingPaid ? brk.rows
      : S.payments.filter(p => S.payFilter === "all" ? true : p.status !== "paid"))
    .sort(showingPaid
      ? (a,b) => paidDate(b).localeCompare(paidDate(a))
      : (a,b) => (a.status === "paid" ? 1 : 0) - (b.status === "paid" ? 1 : 0) || (a.due || "9999").localeCompare(b.due || "9999"));
  const chips = [["unpaid","未払い"],["paid","支払済"],["all","すべて"]];
  return '<section class="sec"><div class="sec-head"><h2>支払い管理</h2>' +
    '<div class="btn-row">' +
      '<button class="btn" data-act="new-expense">＋ 経費を記録</button>' +
      '<button class="btn primary" data-act="new-pay">＋ 支払い予定</button></div></div>' +
    '<div class="tiles" style="margin-bottom:16px">' +
      '<div class="tile"><span class="lab">未払い合計</span><span class="val ' + (sum ? "warn" : "ok") + '">' + h(yen(sum)) + '</span><span class="sub">' + up.length + " 件</span></div>" +
      '<div class="tile"><span class="lab">期限超過</span><span class="val ' + (overdue.length ? "bad" : "ok") + '">' + overdue.length + '</span><span class="sub">' +
        (overdue.length ? h(overdue.map(p => p.title).slice(0, 2).join("、")) : "なし") + "</span></div>" +
      '<div class="tile"><span class="lab">' + h(paidLabel) + '</span><span class="val">' + h(yen(paidSum)) +
        '</span><span class="sub">' + paidRows.length + " 件</span></div></div>" +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
    chips.map(c => '<button class="btn sm' + (S.payFilter === c[0] ? " primary" : "") + '" data-act="pay-filter" data-f="' + c[0] + '">' + c[1] + "</button>").join("") + "</div>" +
    (showingPaid
      ? '<div class="sec-head" style="margin-bottom:8px"><h2 style="font-size:15px">' +
          h(S.payMonth.slice(0,4) + "年" + Number(S.payMonth.slice(5,7)) + "月の経費") + "</h2>" +
        '<span class="chip brass num">' + h(yen(brk.total)) + "</span>" +
        '<div class="btn-row">' +
          '<button class="btn sm" data-act="pay-month" data-delta="-1">← 前月</button>' +
          '<button class="btn sm" data-act="pay-month" data-delta="0">今月</button>' +
          '<button class="btn sm" data-act="pay-month" data-delta="1">翌月 →</button></div></div>' +
        (brk.cats.length
          ? '<div class="panel" style="margin-bottom:14px"><div class="rows" style="border-top:0">' +
            brk.cats.map(function(c){
              return '<div class="row" style="align-items:center;gap:10px">' +
                '<span style="flex:1;font-size:13.5px">' + h(c.name) + "</span>" +
                '<span style="font-size:11.5px;color:var(--muted)">' + c.n + "件</span>" +
                '<span class="num" style="font-weight:600">' + h(yen(c.sum)) + "</span></div>";
            }).join("") + "</div></div>"
          : "")
      : "") +
    '<div class="panel tbl-scroll"><table class="data"><thead><tr>' +
    "<th>" + (showingPaid ? "支払日" : "期日") + "</th><th>名目</th><th>支払先</th><th class=\"r\">金額</th><th>方法</th><th>" +
      (showingPaid ? "区分" : "担当") + "</th><th></th></tr></thead><tbody>" +
    (list.length ? list.map(p =>
      '<tr class="' + (!showingPaid && p.status === "paid" ? "paid" : "") + '">' +
        '<td data-label="' + (showingPaid ? "支払日" : "期日") + '"><span>' +
          (p.status === "paid" ? '<span class="chip ok">' + h(md(paidDate(p)) || "済") + "</span>"
                               : (dueChip(p.due) || '<span class="chip">未定</span>')) + "</span></td>" +
        '<td data-label="名目"><span>' + h(p.title) + (p.note ? '<div style="font-size:11.5px;color:var(--muted)">' + h(p.note) + "</div>" : "") + "</span></td>" +
        '<td data-label="支払先"><span>' + h(p.payee || "—") + "</span></td>" +
        '<td class="r num" data-label="金額" style="font-weight:600"><span>' + h(yen(p.amount)) + "</span></td>" +
        '<td data-label="方法"><span>' + h(p.method || "—") + "</span></td>" +
        '<td data-label="' + (showingPaid ? "区分" : "担当") + '"><span>' +
          (showingPaid
            ? (p.category ? '<span class="chip">' + h(p.category) + "</span>" : '<span class="chip">未分類</span>')
            : (p.assignee ? whoChip(p.assignee) : '<span class="chip brass">未定</span>')) + "</span></td>" +
        '<td class="acts" style="white-space:nowrap;text-align:right">' +
          '<button class="btn sm" data-act="toggle-pay" data-id="' + h(p.id) + '">' + (p.status === "paid" ? "未払いに戻す" : "支払った") + "</button> " +
          '<button class="btn sm ghost" data-act="edit-pay" data-id="' + h(p.id) + '">編集</button></td></tr>').join("")
      : '<tr><td colspan="7" style="text-align:center;padding:22px;color:var(--muted)">' +
        (showingPaid ? "この月の記録はありません" : "該当する支払いはありません") + "</td></tr>") +
    "</tbody></table></div></section>";
}

/* ============================ 拠点（スタッフ用の入り口） ============================ */
// 本部は members、各拠点のスタッフは staff。両者は別の入り口から入るが、
// 見る画面（勤怠・鍵・TODO・シフト）は同じ関数で描く。本部はそれを拠点ごとに切り替えて見る。
const STAFF_TABS = [
  { id:"att",   label:"勤怠",   short:"勤怠" },
  { id:"key",   label:"鍵",     short:"鍵" },
  { id:"todo",  label:"やること", short:"やる事" },
  { id:"shift", label:"シフト", short:"シフト" }
];
const SHIFT_KINDS = [
  ["work",      "出勤", "ok"],
  ["off",       "休み", "bad"],
  ["undecided", "未定", ""]
];
const shiftKind = k => SHIFT_KINDS.find(x => x[0] === k) || SHIFT_KINDS[2];

// 打刻はタイムスタンプで持つので、表示と日付のまとめは日本時間に直してから行う。
const JST_MS = 9 * 3600000;
const jstDay = iso => (iso ? new Date(Date.parse(iso) + JST_MS).toISOString().slice(0, 10) : "");
const jstHM  = iso => {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + JST_MS);
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
};
// 日本時間の "YYYY-MM-DDTHH:MM" を UTC の ISO に戻す（手動修正の入力欄用）。
const jstInputToIso = v => (v ? new Date(Date.parse(v + ":00+09:00")).toISOString() : null);
const isoToJstInput = iso => (iso ? new Date(Date.parse(iso) + JST_MS).toISOString().slice(0, 16) : "");

// 出勤→退勤を順に組にする。夜勤が日付をまたいでも、その勤務は出勤した日に残す。
function pairPunches(rows){
  const byStaff = {};
  rows.slice().sort((a, b) => a.punchedAt.localeCompare(b.punchedAt)).forEach(function(r){
    (byStaff[r.staffId] = byStaff[r.staffId] || []).push(r);
  });
  const out = [];
  Object.keys(byStaff).forEach(function(staffId){
    let pending = null;
    byStaff[staffId].forEach(function(r){
      if (r.kind === "in"){
        if (pending) out.push({ staffId: staffId, inRec: pending, outRec: null });
        pending = r;
      } else if (pending){
        out.push({ staffId: staffId, inRec: pending, outRec: r }); pending = null;
      } else {
        out.push({ staffId: staffId, inRec: null, outRec: r }); // 出勤のない単独の退勤
      }
    });
    if (pending) out.push({ staffId: staffId, inRec: pending, outRec: null }); // 勤務中
  });
  return out.map(function(p){
    return Object.assign(p, { day: jstDay((p.inRec || p.outRec).punchedAt) });
  });
}
const shiftsOnDay = day => pairPunches(S.punches).filter(p => p.day === day);
const onDutyNow = () => pairPunches(S.punches).filter(p => p.inRec && !p.outRec);
const myOnDuty = () => onDutyNow().find(p => p.staffId === staffMeId()) || null;

const site = id => S.sites.find(x => x.id === id) || null;
const curSite = () => site(S.siteId);
const staffOf = id => S.staff.find(x => x.id === id) || null;
// S.staff は見える拠点ぶん全部が入っている。拠点ごとの画面はここを通す。
const siteStaff = () => S.staff.filter(x => x.siteId === S.siteId);
const staffName = id => (staffOf(id) || {}).name || "—";
// 本部として見ているのか、スタッフとして入っているのか。
const isHq = () => !!S.me;
const staffMeId = () => (S.staffMe ? S.staffMe.id : null);
// 打刻の手直しや名簿の編集ができるのは本部と店長だけ。
const canManageSite = () => isHq() || !!(S.staffMe && S.staffMe.role === "manager");
const siteTabs = () => {
  const t = (curSite() || {}).tabs || {};
  return STAFF_TABS.filter(x => t[x.id] !== false);
};

const normStaff  = r => ({ id:r.id, siteId:r.site_id, name:r.name, role:r.role, keyHolder:r.key_holder,
                           keyNote:r.key_note, active:r.active, sortOrder:r.sort_order, pinSet:r.pin_set,
                           lastLoginAt:r.last_login_at });
const normPunch  = r => ({ id:r.id, siteId:r.site_id, staffId:r.staff_id, kind:r.kind,
                           punchedAt:r.punched_at, note:r.note });
const normKeyEv  = r => ({ id:r.id, siteId:r.site_id, staffId:r.staff_id, kind:r.kind,
                           happenedAt:r.happened_at, note:r.note });
const normSShift = r => ({ siteId:r.site_id, staffId:r.staff_id, date:r.date, kind:r.kind,
                           from:r.from_time, to:r.to_time, note:r.note });

// pin_hash は列ごと読めないようにしてあるので、* ではなく必要な列だけを名指しする。
const STAFF_COLS = "id,site_id,name,role,key_holder,key_note,active,sort_order,pin_set,last_login_at";

async function loadSite(siteId){
  if (!siteId){ S.punches = []; S.keyEvents = []; S.keyDuty = {}; S.sshifts = {}; return; }
  const m = S.siteMonth;
  const from = m + "-01", to = m + "-" + pad(daysInMonth(m));
  // 夜勤が前後の日にはみ出すので、打刻だけは前後1日ぶん広く取る。
  const fromIso = new Date(Date.parse(from + "T00:00:00+09:00") - 26 * 3600000).toISOString();
  const toIso   = new Date(Date.parse(to + "T23:59:59+09:00") + 26 * 3600000).toISOString();
  const [pch, kev, kdt, shf] = await Promise.all([
    sb.from("punches").select("*").eq("site_id", siteId).gte("punched_at", fromIso).lte("punched_at", toIso),
    sb.from("key_events").select("*").eq("site_id", siteId).order("happened_at", { ascending: false }).limit(60),
    sb.from("key_duty").select("*").eq("site_id", siteId).gte("date", from).lte("date", to),
    sb.from("staff_shifts").select("*").eq("site_id", siteId).gte("date", from).lte("date", to)
  ]);
  const ok = r => !(r && r.error);
  if ([pch, kev, kdt, shf].some(r => !ok(r))) S.stale = true;
  if (ok(pch)) S.punches = (pch.data || []).map(normPunch);
  if (ok(kev)) S.keyEvents = (kev.data || []).map(normKeyEv);
  if (ok(kdt)){ S.keyDuty = {}; (kdt.data || []).forEach(function(r){ S.keyDuty[r.date] = r; }); }
  if (ok(shf)){ S.sshifts = {}; (shf.data || []).forEach(function(r){ S.sshifts[r.staff_id + "|" + r.date] = normSShift(r); }); }
}

/* ---------------------------- スタッフの入り口 ---------------------------- */
function urlSiteCode(){
  const m = /[?&]s=([a-z0-9-]{2,24})/i.exec(location.search || "");
  return m ? m[1].toLowerCase() : "";
}
async function loadGate(code){
  const r = await sb.rpc("site_gate", { p_code: code });
  S.gate = (r && !r.error && r.data && r.data.id) ? r.data : null;
  if (!S.gate) S.authErr = "この入り口は見つからないか、いま停止中です。";
}
async function staffSignIn(){
  const staffId = S.form.st_who || "";
  const pin = (S.form.st_pin || "").trim();
  if (!staffId){ S.authErr = "名前を選んでください。"; render(); return; }
  if (!/^[0-9]{4}$/.test(pin)){ S.authErr = "暗証番号は数字4桁です。"; render(); return; }
  await staffLogin(staffId, pin);
}
// 自分で登録する。名前が空いていれば、その場で登録してそのままログインする。
async function staffRegister(){
  const name = (S.form.st_name || "").trim();
  const pin = (S.form.st_newpin || "").trim();
  const pin2 = (S.form.st_newpin2 || "").trim();
  if (!name){ S.authErr = "名前を入力してください。"; render(); return; }
  if (!/^[0-9]{4}$/.test(pin)){ S.authErr = "暗証番号は数字4桁です。"; render(); return; }
  if (pin !== pin2){ S.authErr = "確認用の暗証番号が一致しません。"; render(); return; }
  S.busy = true; S.authErr = ""; render();
  const r = await sb.rpc("staff_register", { p_code: S.siteCode, p_name: name, p_pin: pin });
  if (r.error || !r.data || !r.data.ok){
    S.busy = false;
    S.authErr = (r.data && r.data.error) || "登録できませんでした。";
    render(); return;
  }
  await staffLogin(r.data.staffId, pin);
}
async function staffLogin(staffId, pin){
  S.busy = true; S.authErr = ""; render();
  let out = null;
  try {
    out = await sb.functions.invoke("staff-login", { body: { code: S.siteCode, staffId: staffId, pin: pin } });
  } catch(e){ out = { error: e }; }
  if (out.error || !out.data || !out.data.tokenHash){
    let msg = "ログインできませんでした。";
    // Edge Function はエラー本文に理由を入れて返す。
    try {
      const body = out.error && out.error.context ? await out.error.context.json() : null;
      if (body && body.error) msg = body.error;
    } catch(e){ /* 本文が読めないときは既定の文言 */ }
    S.busy = false; S.authErr = msg;
    S.form.st_pin = ""; S.form.st_newpin = ""; S.form.st_newpin2 = "";
    render(); return;
  }
  const v = await sb.auth.verifyOtp({ token_hash: out.data.tokenHash, type: "email" });
  S.busy = false;
  if (v.error){ S.authErr = "ログインできませんでした。もう一度お試しください。"; render(); return; }
  // onAuthStateChange の発火を待たずに自分で入れておく。順番に依存すると、
  // 認証は通っているのに入り口の画面に戻ってしまうことがある。
  if (v.data && v.data.user) S.user = v.data.user;
  S.form = {};
  await refresh();
}
function viewSiteGate(){
  const g = S.gate;
  if (!g){
    return '<div class="gate"><div class="gate-card">' +
      '<div class="brand" style="display:flex"><span class="mark">' + h(BRAND) + '</span><span class="sub">スタッフ</span></div>' +
      "<h1>入り口が見つかりません</h1>" +
      '<p class="lead">URL が違うか、この入り口はいま停止中です。<br>本部に確認してください。</p>' +
      "</div></div>";
  }
  const list = g.staff || [];
  const up = S.gateMode === "up";
  const canSignUp = g.signup !== false;
  // 名簿が空のうちは、いきなり登録の画面から始める。
  const showUp = canSignUp && (up || !list.length);
  return '<div class="gate"><div class="gate-card">' +
    '<div class="brand" style="display:flex"><span class="mark">' + h(BRAND) + '</span><span class="sub">' + h(g.name) + "</span></div>" +
    "<h1>" + h(g.name) + " スタッフ</h1>" +
    (showUp
      ? '<p class="lead">名前と、自分で決めた暗証番号（4桁）を登録してください。<br>' +
          "次からはその2つで入れます。</p>" +
        '<div class="fields">' +
          '<label class="f">名前<input type="text" id="st_name" maxlength="30" autocomplete="off" ' +
            'placeholder="みんなが分かる呼び名" value="' + h(S.form.st_name || "") + '"></label>' +
          '<div class="fields two">' +
            '<label class="f">暗証番号（4桁）<input type="password" id="st_newpin" inputmode="numeric" autocomplete="off" ' +
              'maxlength="4" pattern="[0-9]*" value="' + h(S.form.st_newpin || "") + '"></label>' +
            '<label class="f">確認<input type="password" id="st_newpin2" inputmode="numeric" autocomplete="off" ' +
              'maxlength="4" pattern="[0-9]*" value="' + h(S.form.st_newpin2 || "") + '"></label></div>' +
        "</div>" +
        (S.authErr ? '<p class="err">' + h(S.authErr) + "</p>" : "") +
        '<button class="btn primary" style="width:100%" data-act="staff-signup"' + (S.busy ? " disabled" : "") + ">" +
          (S.busy ? "登録中…" : "登録して入る") + "</button>" +
        '<p style="font-size:11.5px;color:var(--muted);line-height:1.7;margin-top:10px">' +
          "暗証番号は本部が確認できます。他のサービスで使っているものは避けてください。</p>" +
        privacyLink() +
        (list.length
          ? '<p class="swap">登録済みの方は <button data-act="gate-mode" data-v="in">ログイン</button></p>'
          : "")
      : '<p class="lead">名前を選んで、自分で決めた暗証番号（4桁）を入れてください。</p>' +
        '<div class="fields">' +
          '<label class="f">名前<select id="st_who">' +
            '<option value="">— 選んでください —</option>' +
            list.map(function(s){
              return '<option value="' + h(s.id) + '"' + (S.form.st_who === s.id ? " selected" : "") + (s.hasPin ? "" : " disabled") + ">" +
                h(s.name) + (s.hasPin ? "" : "（暗証番号 未設定）") + "</option>"; }).join("") +
            "</select></label>" +
          '<label class="f">暗証番号<input type="password" id="st_pin" inputmode="numeric" autocomplete="off" ' +
            'maxlength="4" pattern="[0-9]*" placeholder="4桁" value="' + h(S.form.st_pin || "") + '"></label>' +
        "</div>" +
        (S.authErr ? '<p class="err">' + h(S.authErr) + "</p>" : "") +
        '<button class="btn primary" style="width:100%" data-act="staff-signin"' + (S.busy ? " disabled" : "") + ">" +
          (S.busy ? "確認中…" : "入る") + "</button>" +
        (canSignUp
          ? '<p class="swap">はじめての方は <button data-act="gate-mode" data-v="up">名前を登録</button></p>'
          : '<p class="swap" style="color:var(--muted)">新規の登録はいま止まっています。本部に連絡してください。</p>')) +
    "</div></div>";
}

/* ---------------------------- 勤怠 ---------------------------- */
function viewAtt(){
  const day = S.siteDay;
  const rows = shiftsOnDay(day);
  const seen = {}; rows.forEach(function(r){ seen[r.staffId] = 1; });
  const blanks = canManageSite()
    ? siteStaff().filter(s => s.active && !seen[s.id]).map(s => ({ staffId: s.id, inRec: null, outRec: null, day: day }))
    : [];
  const on = onDutyNow();
  const mine = myOnDuty();
  const cell = (rec, empty) => rec
    ? '<span class="chip ok num" data-act="' + (canManageSite() ? "fix-punch" : "") + '" data-id="' + h(rec.id) + '">' + h(jstHM(rec.punchedAt)) + "</span>"
    : '<span class="chip">' + h(empty) + "</span>";

  return '<section class="sec">' +
    (staffMeId()
      ? '<div class="panel punch-card">' +
          '<div class="punch-now">' + (mine
            ? '<b>勤務中</b><span>' + h(jstHM(mine.inRec.punchedAt)) + " から</span>"
            : "<b>未出勤</b><span>まだ今日の打刻がありません</span>") + "</div>" +
          '<button class="btn primary punch-btn" data-act="punch" data-v="' + (mine ? "out" : "in") + '">' +
            (mine ? "退勤する" : "出勤する") + "</button></div>"
      : "") +
    '<div class="sec-head"><h2>勤務中</h2><span class="chip brass num">' + on.length + "人</span></div>" +
    '<div class="panel" style="margin-bottom:16px">' +
      (on.length
        ? '<div class="rows">' + on.map(function(p){
            return '<div class="row" style="align-items:center;gap:10px">' +
              '<span style="flex:1;font-size:14px">' + h(staffName(p.staffId)) + "</span>" +
              '<span class="chip ok num">' + h(jstHM(p.inRec.punchedAt)) + " 〜</span></div>"; }).join("") + "</div>"
        : '<div class="empty">いま勤務中の人はいません</div>') + "</div>" +

    '<div class="sec-head"><h2>' + h(day.slice(5).replace("-", "/")) + " の記録</h2>" +
      '<div class="btn-row">' +
        '<button class="btn sm" data-act="site-day" data-delta="-1">← 前日</button>' +
        '<button class="btn sm" data-act="site-day" data-delta="0">今日</button>' +
        '<button class="btn sm" data-act="site-day" data-delta="1">翌日 →</button></div></div>' +
    '<div class="panel tbl-scroll"><table class="data"><thead><tr>' +
      "<th>スタッフ</th><th>出勤</th><th>退勤</th><th>勤務</th>" + (canManageSite() ? "<th></th>" : "") + "</tr></thead><tbody>" +
    ((rows.length || blanks.length)
      ? rows.concat(blanks).map(function(p){
          const dur = p.inRec && p.outRec
            ? Math.round((Date.parse(p.outRec.punchedAt) - Date.parse(p.inRec.punchedAt)) / 60000)
            : null;
          return "<tr>" +
            '<td data-label="スタッフ"><span>' + h(staffName(p.staffId)) + "</span></td>" +
            '<td data-label="出勤"><span>' + cell(p.inRec, "—") + "</span></td>" +
            '<td data-label="退勤"><span>' + cell(p.outRec, p.inRec ? "勤務中" : "—") + "</span></td>" +
            '<td data-label="勤務" class="num"><span>' +
              (dur === null ? "—" : Math.floor(dur / 60) + "時間" + pad(dur % 60) + "分") + "</span></td>" +
            (canManageSite()
              ? '<td class="acts"><button class="btn sm ghost" data-act="add-punch" data-id="' + h(p.staffId) +
                '" data-date="' + h(day) + '">打刻を追加</button></td>'
              : "") + "</tr>"; }).join("")
      : '<tr><td colspan="5" style="text-align:center;padding:22px;color:var(--muted)">この日の記録はありません</td></tr>') +
    "</tbody></table></div></section>";
}

/* ---------------------------- 鍵 ---------------------------- */
function viewKey(){
  const day = S.siteDay;
  const duty = S.keyDuty[day] || {};
  const holders = siteStaff().filter(s => s.active && s.keyHolder);
  const last = kind => S.keyEvents.filter(e => e.kind === kind)[0] || null;
  const lastOpen = last("open"), lastClose = last("close");
  const stateLine = (ev, word) => ev
    ? h(staffName(ev.staffId) + " が " + jstDay(ev.happenedAt).slice(5).replace("-", "/") + " " + jstHM(ev.happenedAt) + " に" + word)
    : "まだ記録がありません";

  return '<section class="sec">' +
    '<div class="panel punch-card" style="margin-bottom:16px">' +
      '<div class="punch-now"><b>いまの状態</b><span>' +
        (lastOpen && (!lastClose || lastOpen.happenedAt > lastClose.happenedAt)
          ? "あいています — " + stateLine(lastOpen, "開けました")
          : lastClose ? "閉まっています — " + stateLine(lastClose, "閉めました")
          : "まだ記録がありません") + "</span></div>" +
      '<div class="btn-row" style="margin-left:0">' +
        '<button class="btn primary" data-act="key-report" data-v="open">開けた</button>' +
        '<button class="btn" data-act="key-report" data-v="close">閉めた</button></div></div>' +

    '<div class="sec-head"><h2>' + h(day.slice(5).replace("-", "/")) + " の担当</h2>" +
      '<div class="btn-row">' +
        '<button class="btn sm" data-act="site-day" data-delta="-1">← 前日</button>' +
        '<button class="btn sm" data-act="site-day" data-delta="0">今日</button>' +
        '<button class="btn sm" data-act="site-day" data-delta="1">翌日 →</button></div></div>' +
    '<div class="panel" style="margin-bottom:16px"><div class="rows">' +
      '<div class="row" style="align-items:center;gap:10px"><span style="width:64px;font-size:13px;color:var(--muted)">開ける</span>' +
        '<span style="flex:1;font-size:14px">' + (duty.open_staff ? h(staffName(duty.open_staff)) : "未定") + "</span>" +
        '<button class="btn sm ghost" data-act="edit-duty" data-date="' + h(day) + '">変更</button></div>' +
      '<div class="row" style="align-items:center;gap:10px"><span style="width:64px;font-size:13px;color:var(--muted)">閉める</span>' +
        '<span style="flex:1;font-size:14px">' + (duty.close_staff ? h(staffName(duty.close_staff)) : "未定") + "</span>" +
        '<button class="btn sm ghost" data-act="edit-duty" data-date="' + h(day) + '">変更</button></div>' +
      (duty.note ? '<div class="row"><span style="font-size:13px;color:var(--ink-2)">' + h(duty.note) + "</span></div>" : "") +
    "</div></div>" +

    // 誰が鍵を持っているかは、その拠点で働いている人がいちばん分かっている。
    // 店長役がいない拠点だと誰も登録できなくなるので、スタッフ全員が触れる。
    '<div class="sec-head"><h2>鍵を持っている人</h2>' +
      '<div class="btn-row"><button class="btn sm" data-act="edit-holders">登録する</button></div></div>' +
    '<div class="panel" style="margin-bottom:16px">' +
      (holders.length
        ? '<div class="rows">' + holders.map(function(s){
            return '<div class="row" style="align-items:center;gap:10px">' +
              '<span style="flex:1;font-size:14px">' + h(s.name) + "</span>" +
              (s.keyNote ? '<span style="font-size:12px;color:var(--muted)">' + h(s.keyNote) + "</span>" : "") + "</div>"; }).join("") + "</div>"
        : '<div class="empty">まだ登録がありません</div>') + "</div>" +

    '<div class="sec-head"><h2>開け閉めの記録</h2></div>' +
    '<div class="panel">' +
      (S.keyEvents.length
        ? '<div class="rows">' + S.keyEvents.slice(0, 30).map(function(e){
            return '<div class="row" style="align-items:center;gap:10px">' +
              '<span class="chip ' + (e.kind === "open" ? "ok" : "") + '">' + (e.kind === "open" ? "開けた" : "閉めた") + "</span>" +
              '<span style="flex:1;font-size:14px">' + h(staffName(e.staffId)) +
                (e.note ? '<div style="font-size:11.5px;color:var(--muted)">' + h(e.note) + "</div>" : "") + "</span>" +
              '<span class="num" style="font-size:12.5px;color:var(--muted)">' +
                h(jstDay(e.happenedAt).slice(5).replace("-", "/") + " " + jstHM(e.happenedAt)) + "</span></div>"; }).join("") + "</div>"
        : '<div class="empty">まだ記録がありません</div>') + "</div></section>";
}

/* ---------------------------- TODO ---------------------------- */
function staffOptions(sel, blank){
  return '<option value="">' + h(blank) + "</option>" +
    siteStaff().filter(s => s.active).map(function(s){
      return '<option value="' + h(s.id) + '"' + (sel === s.id ? " selected" : "") + ">" + h(s.name) + "</option>"; }).join("");
}

/* ---------------------------- シフト ---------------------------- */
function viewShift(){
  const m = S.siteMonth, n = daysInMonth(m);
  const people = siteStaff().filter(s => s.active);
  const mine = staffMeId();
  const head = '<tr><th class="name">スタッフ</th>' +
    Array.from({ length: n }, function(_, i){
      const d = i + 1, w = dow(m, d);
      return '<th class="' + (w === 0 ? "sun" : w === 6 ? "sat" : "") + '"><span>' + d + "</span><small>" + DOW[w] + "</small></th>";
    }).join("") + "</tr>";
  const body = people.map(function(s){
    const own = isHq() || canManageSite() || s.id === mine;
    return '<tr><td class="name"><span class="who">' + h(s.name) +
      (s.id === mine ? '<span class="mine">あなた</span>' : "") + "</span></td>" +
      Array.from({ length: n }, function(_, i){
        const date = m + "-" + pad(i + 1);
        const r = S.sshifts[s.id + "|" + date];
        const k = shiftKind(r ? r.kind : "undecided");
        const time = r && r.from ? r.from : "";
        const label = r && r.kind !== "undecided" ? (r.kind === "off" ? "休" : (time || "出")) : "";
        return '<td class="day ' + (r ? "s-" + r.kind : "") + (date === today() ? " today-col" : "") + '">' +
          (own
            ? '<button class="cell" data-act="edit-shift" data-id="' + h(s.id) + '" data-date="' + date +
              '" title="' + h(s.name + " " + date) + '"><span class="k">' + h(label) + "</span></button>"
            : '<span class="cell"><span class="k">' + h(label) + "</span></span>") + "</td>";
      }).join("") + "</tr>";
  }).join("");
  return '<section class="sec"><div class="sec-head"><h2>' +
      h(m.slice(0, 4) + "年" + Number(m.slice(5, 7)) + "月のシフト") + "</h2>" +
      '<div class="btn-row">' +
        '<button class="btn sm" data-act="site-month" data-delta="-1">← 前月</button>' +
        '<button class="btn sm" data-act="site-month" data-delta="0">今月</button>' +
        '<button class="btn sm" data-act="site-month" data-delta="1">翌月 →</button></div></div>' +
    '<p class="hint" style="font-size:12px;color:var(--muted);margin-bottom:10px">' +
      (isHq() || canManageSite() ? "マスを押すと登録できます。" : "自分の行のマスを押すと登録できます。") + "</p>" +
    (people.length
      ? '<div class="cal-scroll"><table class="cal"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>"
      : '<div class="panel"><div class="empty">まだ名簿にスタッフがいません</div></div>') + "</section>";
}
// 月の頭ではなく今日のあたりが見えている方が、開いてすぐ使える。
function scrollShiftToToday(){
  const box = $(".cal-scroll"), cell = $(".cal-scroll td.today-col");
  if (!box || !cell) return;
  box.scrollLeft = Math.max(0, cell.offsetLeft - box.clientWidth / 2);
}
function modalShift(staffId, date){
  const r = S.sshifts[staffId + "|" + date] || {};
  showModal(staffName(staffId) + "・" + Number(date.slice(5, 7)) + "/" + Number(date.slice(8, 10)),
    '<div class="fields">' +
    '<label class="f">区分<select id="sh_kind">' + SHIFT_KINDS.map(function(k){
      return '<option value="' + k[0] + '"' + ((r.kind || "undecided") === k[0] ? " selected" : "") + ">" + k[1] + "</option>"; }).join("") + "</select></label>" +
    '<div class="fields two">' +
      '<label class="f">開始<input type="time" id="sh_from" value="' + h(r.from || "") + '"></label>' +
      '<label class="f">終了<input type="time" id="sh_to" value="' + h(r.to || "") + '"></label></div>' +
    '<label class="f">メモ<input type="text" id="sh_note" maxlength="60" value="' + h(r.note || "") + '" placeholder="遅れる、早上がりなど"></label></div>',
    '<button class="btn danger left" data-act="clear-shift" data-id="' + h(staffId) + '" data-date="' + date + '">空にする</button>' +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-shift" data-id="' + h(staffId) + '" data-date="' + date + '">保存</button>');
}

/* ---------------------------- 本部から見る拠点タブ ---------------------------- */
function viewSites(){
  if (!S.sites.length){
    return '<section class="sec"><div class="sec-head"><h2>スタッフ拠点</h2>' +
      '<div class="btn-row"><button class="btn primary" data-act="new-site">＋ 拠点を追加</button></div></div>' +
      '<div class="panel"><div class="empty">まだ拠点がありません</div></div></section>';
  }
  const sub = S.siteTab;
  const tabs = siteTabs();
  return '<section class="sec"><div class="sec-head"><h2>スタッフ拠点</h2>' +
      '<div class="btn-row"><button class="btn" data-act="new-site">＋ 拠点</button></div></div>' +
    '<div class="site-switch">' + S.sites.map(function(t){
      return '<button class="btn sm' + (t.id === S.siteId ? " primary" : "") + '" data-act="pick-site" data-id="' + h(t.id) + '">' +
        h(t.name) + (t.open ? "" : " <span style=\"opacity:.7\">停止中</span>") + "</button>"; }).join("") + "</div>" +
    '<div class="site-switch sub">' +
      tabs.map(function(t){
        return '<button class="btn sm' + (sub === t.id ? " primary" : "") + '" data-act="site-tab" data-v="' + t.id + '">' + h(t.label) + "</button>"; }).join("") +
      '<button class="btn sm' + (sub === "admin" ? " primary" : "") + '" data-act="site-tab" data-v="admin">管理</button></div>' +
    (sub === "admin" ? viewSiteAdmin()
      : !tabs.some(t => t.id === sub) ? '<div class="panel"><div class="empty">このタブは本部の設定で非表示になっています</div></div>'
      : sub === "key" ? viewKey()
      : sub === "todo" ? viewTasks()
      : sub === "shift" ? viewShift()
      : viewAtt()) + "</section>";
}
function viewSiteAdmin(){
  const t = curSite();
  if (!t) return "";
  const url = location.origin + location.pathname + "?s=" + t.code;
  const tabs = t.tabs || {};
  return '<div class="sec-head" style="margin-top:4px"><h2 style="font-size:15px">' + h(t.name) + " の設定</h2>" +
      '<div class="btn-row"><button class="btn sm ghost" data-act="edit-site" data-id="' + h(t.id) + '">名前・コード</button></div></div>' +
    '<div class="panel" style="margin-bottom:16px"><div class="rows">' +
      '<div class="row" style="align-items:center;gap:10px">' +
        '<span style="flex:1;font-size:13.5px"><b>入り口を公開する</b>' +
          '<div style="font-size:12px;color:var(--muted)">停止すると、登録済みのスタッフもログインできなくなります</div></span>' +
        '<button class="btn sm' + (t.open ? " primary" : "") + '" data-act="site-open" data-id="' + h(t.id) + '">' +
          (t.open ? "公開中" : "停止中") + "</button></div>" +
      '<div class="row" style="align-items:center;gap:10px">' +
        '<span style="flex:1;font-size:13.5px"><b>スタッフの新規登録を受け付ける</b>' +
          '<div style="font-size:12px;color:var(--muted)">スタッフが自分で名前と暗証番号を登録できます。' +
          "全員そろったら止めてください</div></span>" +
        '<button class="btn sm' + (t.staff_signup !== false ? " primary" : "") + '" data-act="site-signup" data-id="' + h(t.id) + '">' +
          (t.staff_signup !== false ? "受付中" : "停止中") + "</button></div>" +
      '<div class="row" style="align-items:center;gap:10px">' +
        '<span style="flex:1;font-size:13.5px;word-break:break-all">' + h(url) + "</span>" +
        '<button class="btn sm ghost" data-act="copy-site-url" data-id="' + h(t.id) + '">コピー</button></div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
        '<span style="width:100%;font-size:13.5px"><b>見せるタブ</b></span>' +
        STAFF_TABS.map(function(x){
          return '<button class="btn sm' + (tabs[x.id] !== false ? " primary" : "") + '" data-act="site-tabon" data-id="' +
            h(t.id) + '" data-v="' + x.id + '">' + h(x.label) + "</button>"; }).join("") + "</div>" +
    "</div></div>" +

    '<div class="sec-head"><h2 style="font-size:15px">名簿</h2>' +
      '<div class="btn-row"><button class="btn sm primary" data-act="new-staff">＋ スタッフ</button></div></div>' +
    '<div class="panel tbl-scroll"><table class="data"><thead><tr>' +
      "<th>名前</th><th>役割</th><th>鍵</th><th>暗証番号</th><th>最終ログイン</th><th></th></tr></thead><tbody>" +
    (siteStaff().length
      ? siteStaff().map(function(s){
          return '<tr' + (s.active ? "" : ' class="paid"') + ">" +
            '<td data-label="名前"><span>' + h(s.name) + (s.active ? "" : '<span class="chip">停止中</span>') + "</span></td>" +
            '<td data-label="役割"><span>' + (s.role === "manager" ? '<span class="chip brass">店長</span>' : "スタッフ") + "</span></td>" +
            '<td data-label="鍵"><span>' + (s.keyHolder ? '<span class="chip ok">持っている</span>' : "—") + "</span></td>" +
            '<td data-label="暗証番号"><span class="secret">' +
              (s.pinSet
                ? (S.pinShown[s.id]
                    ? '<code class="num">' + h(S.pinShown[s.id]) + "</code>" +
                      '<button class="btn sm ghost" data-act="hide-pin" data-id="' + h(s.id) + '">隠す</button>'
                    : "<code>••••</code>" +
                      '<button class="btn sm ghost" data-act="show-pin" data-id="' + h(s.id) + '">表示</button>')
                : '<span class="chip bad">未設定</span>') + "</span></td>" +
            '<td data-label="最終ログイン"><span style="font-size:12.5px;color:var(--muted)">' +
              (s.lastLoginAt ? h(jstDay(s.lastLoginAt).slice(5).replace("-", "/") + " " + jstHM(s.lastLoginAt)) : "—") + "</span></td>" +
            '<td class="acts">' +
              '<button class="btn sm" data-act="set-pin" data-id="' + h(s.id) + '">暗証番号</button> ' +
              '<button class="btn sm ghost" data-act="edit-staff" data-id="' + h(s.id) + '">編集</button></td></tr>'; }).join("")
      : '<tr><td colspan="6" style="text-align:center;padding:22px;color:var(--muted)">まだスタッフがいません</td></tr>') +
    "</tbody></table></div>";
}
function modalSite(t){
  t = t || {};
  showModal(t.id ? "拠点を編集" : "拠点を追加",
    '<div class="fields">' +
    '<label class="f">拠点名<input type="text" id="si_name" maxlength="30" value="' + h(t.name || "") + '" placeholder="例：ダイア"></label>' +
    '<label class="f">入り口コード<input type="text" id="si_code" maxlength="24" value="' + h(t.code || "") + '" placeholder="例：dia-2331" autocomplete="off"></label>' +
    '<p style="font-size:12px;color:var(--muted);line-height:1.7">半角の英小文字・数字・ハイフンだけ。' +
      "このコードがそのまま入り口 URL になります。推測されにくい文字を混ぜてください。</p>" +
    '<label class="f">メモ<input type="text" id="si_note" maxlength="80" value="' + h(t.note || "") + '"></label></div>',
    (t.id ? '<button class="btn danger left" data-act="del-site" data-id="' + h(t.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-site" data-id="' + h(t.id || "") + '">保存</button>');
}
function modalStaff(s){
  s = s || {};
  showModal(s.id ? "スタッフを編集" : "スタッフを追加",
    '<div class="fields">' +
    '<label class="f">名前<input type="text" id="sf_name" maxlength="30" value="' + h(s.name || "") + '" placeholder="入り口で選ぶ名前"></label>' +
    '<div class="fields two">' +
      '<label class="f">役割<select id="sf_role">' +
        '<option value="staff"' + (s.role === "manager" ? "" : " selected") + ">スタッフ</option>" +
        '<option value="manager"' + (s.role === "manager" ? " selected" : "") + ">店長（打刻の修正・名簿の編集ができる）</option>" +
      "</select></label>" +
      '<label class="f">状態<select id="sf_active">' +
        '<option value="1"' + (s.id && !s.active ? "" : " selected") + ">在籍</option>" +
        '<option value="0"' + (s.id && !s.active ? " selected" : "") + ">停止（ログインできなくなる）</option>" +
      "</select></label></div>" +
    '<label class="f"><span style="display:flex;align-items:center;gap:8px">' +
      '<input type="checkbox" id="sf_key" style="width:auto"' + (s.keyHolder ? " checked" : "") + ">鍵を持っている</span></label>" +
    '<label class="f">鍵のメモ<input type="text" id="sf_keynote" maxlength="60" value="' + h(s.keyNote || "") + '" placeholder="例：スペア1本・裏口も"></label></div>',
    (s.id ? '<button class="btn danger left" data-act="del-staff" data-id="' + h(s.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-staff" data-id="' + h(s.id || "") + '">保存</button>');
}
function modalPin(s, self){
  showModal(self ? "暗証番号を変える" : h(s.name) + " の暗証番号",
    '<div class="fields">' +
    '<label class="f">新しい暗証番号（4桁）<input type="password" id="pn_pin" inputmode="numeric" maxlength="4" ' +
      'pattern="[0-9]*" autocomplete="off"></label>' +
    '<label class="f">確認<input type="password" id="pn_pin2" inputmode="numeric" maxlength="4" ' +
      'pattern="[0-9]*" autocomplete="off"></label>' +
    '<p style="font-size:12px;color:var(--muted);line-height:1.7">' +
      (self
        ? "保存すると、いまの暗証番号は使えなくなります。本部はこの番号を確認できるので、他のサービスで使っているものは避けてください。"
        : "保存すると、いまの暗証番号は使えなくなります。決めた番号は本人に伝えてください。") + "</p></div>",
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-pin" data-id="' + h(s.id) + '">保存</button>');
}
function modalDuty(date){
  const d = S.keyDuty[date] || {};
  showModal(Number(date.slice(5, 7)) + "/" + Number(date.slice(8, 10)) + " の鍵の担当",
    '<div class="fields"><div class="fields two">' +
      '<label class="f">開ける人<select id="ky_open">' + staffOptions(d.open_staff, "— 未定 —") + "</select></label>" +
      '<label class="f">閉める人<select id="ky_close">' + staffOptions(d.close_staff, "— 未定 —") + "</select></label></div>" +
    '<label class="f">メモ<input type="text" id="ky_note" maxlength="60" value="' + h(d.note || "") + '"></label></div>',
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-duty" data-date="' + date + '">保存</button>');
}
function modalHolders(){
  showModal("鍵を持っている人",
    '<div class="fields">' + siteStaff().filter(s => s.active).map(function(s){
      return '<label class="f" style="flex-direction:row;align-items:center;gap:10px">' +
        '<input type="checkbox" data-holder="' + h(s.id) + '" style="width:auto"' + (s.keyHolder ? " checked" : "") + ">" +
        '<span style="flex:1">' + h(s.name) + "</span>" +
        '<input type="text" data-holdernote="' + h(s.id) + '" maxlength="60" placeholder="メモ" value="' +
          h(s.keyNote || "") + '" style="flex:1 1 120px"></label>'; }).join("") +
      (siteStaff().filter(s => s.active).length ? "" : '<p class="empty" style="border:0">名簿にスタッフがいません</p>') +
      '<p style="font-size:12px;color:var(--muted);line-height:1.7">鍵を渡した人にチェックを入れてください。' +
      "メモにはスペアの本数や、どこの鍵かを書いておけます。この拠点の人なら誰でも直せます。</p></div>",
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-holders">保存</button>');
}
function modalPunch(staffId, date, rec){
  const at = rec ? isoToJstInput(rec.punchedAt) : date + "T" + jstHM(new Date().toISOString());
  showModal(rec ? "打刻を直す" : staffName(staffId) + " の打刻を追加",
    '<div class="fields"><div class="fields two">' +
      '<label class="f">区分<select id="pu_kind">' +
        '<option value="in"' + (rec && rec.kind === "out" ? "" : " selected") + ">出勤</option>" +
        '<option value="out"' + (rec && rec.kind === "out" ? " selected" : "") + ">退勤</option></select></label>" +
      '<label class="f">日時<input type="datetime-local" id="pu_at" value="' + h(at) + '"></label></div>' +
    '<label class="f">メモ<input type="text" id="pu_note" maxlength="60" value="' + h((rec || {}).note || "") + '" placeholder="打刻し忘れ など"></label></div>',
    (rec ? '<button class="btn danger left" data-act="del-punch" data-id="' + h(rec.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-punch" data-id="' + h(rec ? rec.id : "") + '" data-who="' + h(staffId) + '">保存</button>');
}

/* ============================ view: 店舗 ============================ */
// Staff paste this straight into replies to applicants, so keep the ■ headings
// exactly as the office already writes them.
function shopText(sp){
  const out = ["■店名", sp.name];
  if (sp.url) out.push("", "■URL", sp.url);
  (sp.sections || []).forEach(function(sec){
    const label = (sec.label || "").trim(), value = (sec.value || "").trim();
    if (!label && !value) return;
    out.push("");
    if (label) out.push("■" + label);
    if (value) out.push(value);
  });
  return out.join("\n");
}

// Splits an ■ block into ordered {label, value} pairs, keeping every heading the
// office wrote — including ones with the text on the same line after a colon, and
// ones that are a whole sentence with no value at all.
function parseShopText(text){
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let cur = null, lead = [];
  lines.forEach(function(raw){
    const line = raw.replace(/^\s+/, "");
    if (line.charAt(0) === "\u25a0"){
      const rest = line.slice(1);
      const m = rest.match(/^([^：:]*)[：:]([\s\S]*)$/);
      cur = m ? { label: m[1].trim(), value: [m[2].trim()] } : { label: rest.trim(), value: [] };
      sections.push(cur);
    } else if (cur){
      cur.value.push(raw);
    } else if (raw.trim()){
      lead.push(raw);
    }
  });
  const tidy = sections.map(function(sec){
    return { label: sec.label, value: sec.value.join("\n").replace(/^\n+|\s+$/g, "") };
  });
  if (lead.length) tidy.unshift({ label: "", value: lead.join("\n").trim() });

  let name = "", url = "";
  const kept = [];
  tidy.forEach(function(sec){
    if (sec.label === "店名" && !name){ name = sec.value; return; }
    if (/^URL$/i.test(sec.label) && !url){ url = sec.value; return; }
    kept.push(sec);
  });
  return { name: name, url: url, sections: kept };
}
const SHOP_KINDS = [
  ["shop", "店舗", "＋ 店舗を追加", "応募の問い合わせにそのまま答えられるように、条件をまとめておく場所です。"],
  ["cast", "掲載用プロフィール", "＋ プロフィールを追加", "媒体に載せるプロフィール。そのままコピーして貼れる形で置いておく場所です。"]
];
const shopKind = () => (SHOP_KINDS.some(k => k[0] === S.shopKind) ? S.shopKind : SHOP_KINDS[0][0]);
const shopKindLabel = k => ((SHOP_KINDS.find(x => x[0] === k) || [k, "情報"])[1]);
// 表示は入力どおり、発信は数字だけ。ハイフンや全角が混じっていても掛けられるように。
const telHref = v => String(v || "").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
                                    .replace(/[^0-9+]/g, "");
const kindOf = sp => (sp.kind || "shop");

/* ============================ ボードのカスタマイズ（addons/line の 02） ============================ */
// board_settings に ui 列があるボードだけで効く。無いボード（PRIME）は UI が null のままで、
// 呼び方も色もタブも今までどおり。設定はボード全体で1つ、色だけは端末ごとに上書きできる。
const SEASONS = [["spring","春","#D81B60"],["summer","夏","#0B8A3E"],["autumn","秋","#9C6C1F"],["winter","冬","#1A56DB"]];
const LISTS_TAB = { id:"lists", label:"一覧", short:"一覧" };
const DEFAULT_TABS = TABS.concat([LISTS_TAB]).map(t => ({ id:t.id, label:t.label, short:t.short }));
const DEFAULT_KINDS = {};
KIND_ORDER.forEach(function(k){ DEFAULT_KINDS[k] = { label:KINDS[k].label, cell:KINDS[k].cell, mini:KINDS[k].mini }; });
const DEFAULT_SHOP_KINDS = SHOP_KINDS.map(k => k.slice());
const GENERIC_SHOP_HINT = "まとめておきたい情報を、■ の見出しのまま貼って置いておく場所です。";
// ホームに出すもの。使わないものは外せる。
const HOME_PARTS = [["door","開け閉め（「〇〇 あいてます」）"],["present","在席（入った・出た）"],
                    ["devices","持ち出すもの"],["reminders","リマインダー"],["notes","自分用"]];
let UI = null, PLACE = "事務所", BOARD_SEASON = "";
const customizable = () => !!(S.settings && Object.prototype.hasOwnProperty.call(S.settings, "ui"));
function uiHome(k){ return !UI || !UI.home || UI.home[k] !== false; }
function tabOn(id){
  if (id === "set" || id === "home") return true;
  if (!UI) return id !== "lists";
  return !(UI.tabs && UI.tabs[id] && UI.tabs[id].off === true);
}
function visibleTabs(){ return TABS.filter(function(t){ return tabOn(t.id); }); }
const kindChoices = cur => KIND_ORDER.filter(k => k === "" || k === (cur || "") ||
  !(UI && UI.kinds && UI.kinds[k] && UI.kinds[k].off));
// 端末で選んだ色 → ボードの色 → 秋（今までの色）
function seasonNow(){ return ls("prime.season") || (UI && UI.theme) || BOARD_SEASON || "autumn"; }
function applySeason(){
  const s = seasonNow();
  if (s && s !== "autumn") document.documentElement.setAttribute("data-season", s);
  else document.documentElement.removeAttribute("data-season");
}
// 呼び方を差し替える。何も入っていない欄は元の呼び方に戻す。
function applyUi(ui){
  UI = ui || {};
  if (!TABS.some(t => t.id === "lists")){
    const at = TABS.findIndex(t => t.id === "set");
    TABS.splice(at < 0 ? TABS.length : at, 0, Object.assign({}, LISTS_TAB));
    S.tabBar = loadTabBar();
  }
  TABS.forEach(function(t){
    const d = DEFAULT_TABS.find(x => x.id === t.id) || t, o = (UI.tabs || {})[t.id] || {};
    t.label = (o.label || "").trim() || d.label;
    t.short = (o.short || "").trim() || (o.label || "").trim().slice(0, 4) || d.short;
  });
  Object.keys(DEFAULT_KINDS).forEach(function(k){
    if (!k) return;
    const d = DEFAULT_KINDS[k], lb = (((UI.kinds || {})[k] || {}).label || "").trim();
    KINDS[k].label = lb || d.label;
    KINDS[k].cell = lb ? lb.slice(0, 3) : d.cell;
    const two = lb.split(/[＋+]/);
    KINDS[k].mini = lb ? (two.length > 1 ? two[0].slice(0, 1) + two[1].slice(0, 1) : lb.slice(0, 1)) : d.mini;
  });
  PLACE = (UI.place || "").trim() || "事務所";
  const cats = Array.isArray(UI.shopCats) && UI.shopCats.length ? UI.shopCats : null;
  const next = cats ? cats.map(function(c){
    const d = DEFAULT_SHOP_KINDS.find(x => x[0] === c.id), label = (c.label || "").trim() || (d ? d[1] : "情報");
    return [c.id, label, "＋ " + label + "を追加", d ? d[3] : GENERIC_SHOP_HINT];
  }) : DEFAULT_SHOP_KINDS.map(k => k.slice());
  SHOP_KINDS.splice.apply(SHOP_KINDS, [0, SHOP_KINDS.length].concat(next));
  applySeason();
}

/* ---- 自由な一覧 ---- */
const curList = () => S.lists.find(l => l.id === S.listId) || S.lists[0] || null;
function viewLists(){
  const L = curList();
  const items = L ? S.listItems.filter(x => x.list_id === L.id) : [];
  const open = items.filter(x => !x.done), done = items.filter(x => x.done);
  const row = function(x){
    return '<div class="row" style="align-items:center;gap:10px">' +
      '<input type="checkbox" data-act="list-done" data-id="' + h(x.id) + '"' + (x.done ? " checked" : "") +
        ' style="width:22px;height:22px;flex:none" aria-label="終わった">' +
      '<span style="flex:1;min-width:0' + (x.done ? ";text-decoration:line-through;color:var(--muted)" : "") + '">' +
        h(x.title) + (x.memo ? '<br><span style="font-size:12px;color:var(--muted)">' + h(x.memo) + "</span>" : "") + "</span>" +
      '<button class="btn sm ghost" data-act="list-item-del" data-id="' + h(x.id) + '">消す</button></div>';
  };
  return '<section class="sec"><div class="sec-head"><h2>' + h((TABS.find(t => t.id === "lists") || LISTS_TAB).label) + "</h2>" +
      '<span class="hint">買い物リストや連絡先など、自由に作れる一覧です。</span>' +
      '<div class="btn-row"><button class="btn primary" data-act="list-new">＋ 一覧を作る</button></div></div>' +
    (S.lists.length
      ? '<div class="site-switch">' + S.lists.map(function(l){
          const n = S.listItems.filter(x => x.list_id === l.id && !x.done).length;
          return '<button class="btn sm' + (L && L.id === l.id ? " primary" : "") + '" data-act="list-pick" data-id="' + h(l.id) + '">' +
            h(l.name) + (n ? " " + n : "") + "</button>"; }).join("") + "</div>" +
        '<div class="panel"><div style="padding:12px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<input type="text" id="li_title" maxlength="200" placeholder="「' + h(L.name) + '」に足す" style="flex:1;min-width:160px">' +
          '<button class="btn primary" data-act="list-item-add">追加</button></div>' +
          '<div class="rows">' + (open.length ? open.map(row).join("")
            : '<div class="empty">' + (done.length ? "残っているものはありません" : "まだ何もありません") + "</div>") + "</div>" +
          (done.length ? '<div class="rows">' + done.map(row).join("") + "</div>" : "") +
          '<div style="padding:12px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line)">' +
            (done.length ? '<button class="btn sm" data-act="list-clear-done">終わったものを消す</button>' : "") +
            '<button class="btn sm ghost" data-act="list-rename">一覧の名前を変える</button>' +
            '<button class="btn sm ghost" data-act="list-del">この一覧を消す</button></div>' +
        "</div>"
      : '<div class="panel"><div class="empty">まだ一覧がありません。「＋ 一覧を作る」から作ってください。</div></div>') +
    "</section>";
}

function modalListName(L){
  showModal(L ? "一覧の名前を変える" : "一覧を作る",
    '<div class="fields"><label class="f">名前<input type="text" id="ln_name" maxlength="30" placeholder="例：買い物リスト・取引先" value="' +
      h(L ? L.name : "") + '"></label></div>',
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="list-save" data-id="' + h(L ? L.id : "") + '">' + (L ? "変える" : "作る") + "</button>");
}

/* ---- 設定：カスタマイズ ---- */
function settingsCustomize(){
  const ui = UI || {}, tabs = ui.tabs || {}, kinds = ui.kinds || {}, home = ui.home || {};
  const board = ui.theme || "autumn", mine = ls("prime.season") || "";
  const swatch = function(s, on, act){
    return '<button class="btn' + (on ? " primary" : "") + '" data-act="' + act + '" data-v="' + s[0] + '">' +
      '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + s[2] +
      ';margin-right:6px;vertical-align:-1px;box-shadow:0 0 0 2px #fff"></span>' + s[1] + "</button>";
  };
  const chk = (id, on) => '<input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + ' style="width:20px;height:20px">';
  return '<section class="sec"><div class="sec-head"><h2>色</h2>' +
      '<span class="hint">ボードの色はみんなの画面の初期の色です。この端末だけ別の色にもできます。</span></div>' +
    '<div class="panel"><div style="padding:14px">' +
      '<div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">ボードの色</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + SEASONS.map(s => swatch(s, board === s[0], "season-board")).join("") + "</div>" +
      '<div style="font-size:12.5px;color:var(--muted);margin:14px 0 8px">この端末だけ</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn' + (!mine ? " primary" : "") + '" data-act="season-mine" data-v="">ボードと同じ</button>' +
        SEASONS.map(s => swatch(s, mine === s[0], "season-mine")).join("") + "</div>" +
    "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>タブ</h2>' +
      '<span class="hint">名前と、使うかどうか。外したタブは誰の画面からも消えます（中身は消えません）。</span></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    DEFAULT_TABS.map(function(d){
      const o = tabs[d.id] || {}, fixed = d.id === "home" || d.id === "set";
      return '<div class="row" style="align-items:center;gap:8px;flex-wrap:wrap">' +
        '<label style="display:flex;align-items:center;gap:6px;min-width:64px">' +
          (fixed ? '<input type="checkbox" checked disabled style="width:20px;height:20px" aria-label="いつも出ます">'
                 : chk("ct_on_" + d.id, o.off !== true)) +
          '<span style="font-size:12px;color:var(--muted)">' + h(d.label) +
          (fixed ? '<br><span style="font-size:10.5px">いつも出ます</span>' : "") + "</span></label>" +
        '<input type="text" id="ct_label_' + d.id + '" maxlength="12" placeholder="' + h(d.label) + '" value="' + h(o.label || "") + '" style="flex:2;min-width:120px">' +
        '<input type="text" id="ct_short_' + d.id + '" maxlength="4" placeholder="下の帯：' + h(d.short) + '" value="' + h(o.short || "") + '" style="flex:1;min-width:90px">' +
        "</div>";
    }).join("") + "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>その日の動き</h2>' +
      '<span class="hint">予定で選ぶ「どこで・何をしているか」の名前。使わないものは外せます。</span></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    KIND_ORDER.filter(k => k).map(function(k){
      const o = kinds[k] || {};
      return '<div class="row" style="align-items:center;gap:8px">' +
        chk("ck_on_" + k, o.off !== true) +
        '<input type="text" id="ck_label_' + k + '" maxlength="10" placeholder="' + h(DEFAULT_KINDS[k].label) + '" value="' + h(o.label || "") + '" style="flex:1">' +
        "</div>";
    }).join("") + "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>ホームに出すもの</h2></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    HOME_PARTS.map(function(p){
      return '<label class="row" style="align-items:center;gap:8px">' + chk("ch_" + p[0], home[p[0]] !== false) +
        '<span style="flex:1">' + h(p[1]) + "</span></label>";
    }).join("") +
      '<div class="row" style="align-items:center;gap:8px"><span style="min-width:120px">開け閉めする場所</span>' +
        '<input type="text" id="c_place" maxlength="10" placeholder="事務所" value="' + h(ui.place || "") + '" style="flex:1"></div>' +
    "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>情報タブの分類</h2>' +
      '<span class="hint">例：会社・店舗情報／求人情報／事業者登録情報。名前を空にして保存すると、その分類は消えます（中身は残ります）。</span></div>' +
    '<div class="panel"><div class="rows" style="border-top:0" id="c_cats">' +
    SHOP_KINDS.map(function(k){
      return '<div class="row" style="align-items:center;gap:8px"><input type="text" class="c_cat" data-id="' + h(k[0]) +
        '" maxlength="16" value="' + h(k[1]) + '" style="flex:1"></div>';
    }).join("") + "</div>" +
      '<div style="padding:12px"><input type="text" id="c_cat_new" maxlength="16" placeholder="分類を増やす（例：事業者登録情報）" style="width:100%"></div>' +
    "</div></section>" +

    '<section class="sec"><div style="display:flex;gap:8px">' +
      '<button class="btn primary" data-act="save-ui">この内容で保存</button>' +
      '<span class="hint" style="align-self:center">色の切り替えはすぐに効きます。ほかはここで保存します。</span></div></section>';
}
function collectUi(){
  const ui = JSON.parse(JSON.stringify(UI || {}));
  ui.tabs = {}; DEFAULT_TABS.forEach(function(d){
    const on = el("ct_on_" + d.id);
    ui.tabs[d.id] = { label: valOf("ct_label_" + d.id), short: valOf("ct_short_" + d.id), off: on ? !on.checked : false };
  });
  ui.kinds = {}; KIND_ORDER.filter(k => k).forEach(function(k){
    ui.kinds[k] = { label: valOf("ck_label_" + k), off: !el("ck_on_" + k).checked };
  });
  ui.home = {}; HOME_PARTS.forEach(function(p){ ui.home[p[0]] = el("ch_" + p[0]).checked; });
  ui.place = valOf("c_place");
  const cats = Array.from(document.querySelectorAll(".c_cat"))
    .map(function(x){ return { id: x.dataset.id, label: x.value.trim() }; }).filter(c => c.label);
  const add = valOf("c_cat_new");
  if (add) cats.push({ id: "c" + Date.now().toString(36), label: add });
  if (!cats.length) cats.push({ id: "shop", label: "情報" });
  ui.shopCats = cats;
  return ui;
}
async function saveUi(ui, msg){
  await run(sb.from("board_settings").update({ ui: ui, updated_at: nowIso() }).eq("id", 1), msg || "保存しました");
  applyUi(ui);
}
function viewShops(){
  const kind = shopKind();
  const meta = SHOP_KINDS.find(k => k[0] === kind);
  const list = S.shops.filter(sp => kindOf(sp) === kind);
  return '<section class="sec"><div class="sec-head"><h2>' + h(meta[1]) + "</h2>" +
    '<span class="hint">' + h(meta[3]) + "</span>" +
    '<div class="btn-row"><button class="btn primary" data-act="new-shop">' + h(meta[2]) + "</button></div></div>" +
    '<div class="site-switch">' + SHOP_KINDS.map(function(k){
      const n = S.shops.filter(sp => kindOf(sp) === k[0]).length;
      return '<button class="btn sm' + (kind === k[0] ? " primary" : "") + '" data-act="shop-kind" data-v="' + k[0] + '">' +
        h(k[1]) + (n ? " " + n : "") + "</button>"; }).join("") + "</div>" +
    '<div class="panel">' +
    (list.length ? list.map(function(sp){
      return '<div class="shop">' +
        '<div class="shop-head"><h3>' + h(sp.name) + "</h3>" +
        (sp.url ? '<a href="' + h(sp.url) + '" target="_blank" rel="noopener noreferrer" style="font-size:12.5px">サイト ↗</a>' : "") +
        // 電話は掛けるためのものなので、そのまま発信できるようにしておく。
        (sp.phone ? '<a href="tel:' + h(telHref(sp.phone)) + '" style="font-size:12.5px">☎ ' + h(sp.phone) + "</a>" : "") +
        '<div class="spacer"></div>' +
        '<button class="btn sm" data-act="copy-shop" data-id="' + h(sp.id) + '">まとめてコピー</button> ' +
        '<button class="btn sm ghost" data-act="edit-shop" data-id="' + h(sp.id) + '">編集</button></div>' +
        '<dl class="shop-grid">' +
        ((sp.sections || []).length
          ? sp.sections.map(function(sec){
              const label = (sec.label || "").trim(), value = (sec.value || "").trim();
              return "<dt>" + h(label) + "</dt><dd" + (value ? "" : ' class="blank"') + ">" +
                (value ? h(value) : "—") + "</dd>";
            }).join("")
          : '<dd class="blank" style="grid-column:1 / -1">項目がありません。「編集」から貼り付けてください。</dd>') +
        "</dl></div>";
    }).join("") : '<div class="empty">まだ登録がありません。上のボタンから登録してください。</div>') +
    "</div></section>";
}

/* ============================ view: ID /パス ============================ */
function vaultCell(v, key){
  const raw = (v[key] || "").trim();
  if (key === "url") return raw ? '<a href="' + h(raw) + '" target="_blank" rel="noopener noreferrer">開く ↗</a>' : "—";
  // まとめ方を変えても、媒体の色は同じままにしておく。目で追う手がかりになる。
  if (key === "media") return raw ? colorDot(raw) + h(raw) : "—";
  if (key === "login_id" || key === "password"){
    const shown = S.reveal[v.id];
    return '<span class="secret"><code>' + (shown ? h(raw || "—") : "••••••••") + "</code>" +
      (shown && raw ? '<button class="btn sm ghost" data-act="copy-v" data-id="' + h(v.id) + '" data-k="' + key + '">コピー</button>' : "") +
      "</span>";
  }
  return raw ? h(raw) : "—";
}
function vaultMatches(v, q){
  if (!q) return true;
  // deliberately not the password: nobody should find an entry by guessing it
  return ["media", "shop", "cast_name", "url", "login_id", "note"]
    .some(function(k){ return String(v[k] || "").toLowerCase().indexOf(q) >= 0; });
}
function renderVaultList(){
  const q = S.vaultQ.trim().toLowerCase();
  const rows = S.vault.filter(function(v){ return vaultMatches(v, q); });
  if (!rows.length){
    return '<div class="panel"><div class="empty">' +
      (S.vault.length ? "見つかりませんでした。" : "まだ登録がありません。") + "</div></div>";
  }
  const groupKey = S.vaultGroup;
  const cols = VAULT_COLS.filter(function(c){ return c[0] !== groupKey; });
  mediaColors = assignColors(uniqNames("media"));
  // まとめ方が媒体なら媒体の色をそのまま使い、店舗・キャストならその軸で色を決める。
  const groupColors = !groupKey ? {}
    : groupKey === "media" ? mediaColors : assignColors(uniqNames(groupKey));

  const buckets = [];
  const index = {};
  rows.forEach(function(v){
    const name = groupKey ? String(v[groupKey] || "").trim() : "";
    const key = name || "\u0000";
    if (!index[key]){ index[key] = { name: name, items: [] }; buckets.push(index[key]); }
    index[key].items.push(v);
  });
  buckets.sort(function(x, y){
    if (!x.name) return 1;
    if (!y.name) return -1;
    return x.name.localeCompare(y.name, "ja");
  });
  const blank = { media: "媒体なし", shop: "店舗なし", cast_name: "キャストなし" }[groupKey] || "";

  return buckets.map(function(g){
    g.items.sort(function(x, y){
      return String(x.media || "").localeCompare(String(y.media || ""), "ja") ||
             String(x.cast_name || "").localeCompare(String(y.cast_name || ""), "ja");
    });
    const gc = groupKey ? (groupColors[String(g.name || "").trim()] || 0) : 0;
    const gcls = gc ? " gc g" + gc : "";
    return (groupKey
      ? '<div class="grp-head' + gcls + '">' + (gc ? '<span class="g-dot g' + gc + '"></span>' : "") +
        '<span class="grp-name">' + h(g.name || blank) + "</span>" +
        '<span class="chip">' + g.items.length + "件</span></div>"
      : "") +
      '<div class="panel tbl-scroll' + (gc ? " gp g" + gc : "") + '" style="margin-bottom:14px"><table class="data data-wide"><thead><tr>' +
      cols.map(function(c){ return "<th>" + h(c[1]) + "</th>"; }).join("") + "<th></th></tr></thead><tbody>" +
      g.items.map(function(v){
        return "<tr>" + cols.map(function(c){
          return '<td data-label="' + h(c[1]) + '"><span>' + vaultCell(v, c[0]) + "</span></td>";
        }).join("") +
        '<td class="acts" style="white-space:nowrap;text-align:right">' + shareChip(v) + " " +
          '<button class="btn sm" data-act="reveal" data-id="' + h(v.id) + '">' +
            (S.reveal[v.id] ? "隠す" : "表示") + "</button> " +
          '<button class="btn sm ghost" data-act="edit-vault" data-id="' + h(v.id) + '">編集</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }).join("");
}
function viewVault(){
  return '<section class="sec"><div class="sec-head"><h2>ID /パス</h2>' +
    '<span class="hint">各媒体のURL・ID・パスワードをまとめておく場所です。</span>' +
    '<div class="spacer"></div><button class="btn primary" data-act="new-vault">＋ 追加</button></div>' +
    '<div class="vault-bar">' +
      '<input type="text" id="v_q" class="vault-search" placeholder="媒体・店舗・キャスト・メモで検索" value="' + h(S.vaultQ) + '">' +
      '<label class="vault-group"><span>まとめ方</span><select id="v_group">' +
        VAULT_GROUPS.map(function(g){
          return '<option value="' + g[0] + '"' + (S.vaultGroup === g[0] ? " selected" : "") + ">" + g[1] + "</option>";
        }).join("") + "</select></label>" +
    "</div>" +
    '<div id="vaultList">' + renderVaultList() + "</div>" +
    '<p style="font-size:12px;color:var(--muted);margin-top:10px">ログインできるスタッフは全員このページを見られます。銀行やクレジットカードの認証情報は登録しないでください。</p></section>';
}

/* ============================ view: 設定 ============================ */
// LINE で受け取る通知の種類。無料枠（月200通）を家族で分け合うので、要らないものは止められる。
const LINE_KINDS = [["updates","お知らせ・予定の更新、やることの担当"],["morning","朝8時のまとめ（期限・支払い）"],
                    ["before","予定・会議の30分前"],["remind","リマインダー"]];
function settingsLine(){
  const n = Object.assign({ updates: true, morning: true, before: true, remind: true },
    (S.lineLink && S.lineLink.notify) || {});
  return '<section class="sec"><div class="sec-head"><h2>LINE の通知</h2>' +
    '<span class="hint">自分に届くものだけが変わります。公式アカウントを友だちにしていないと届きません。</span></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (S.lineLink
      ? LINE_KINDS.map(function(k){
          return '<div class="row" style="align-items:center;gap:10px"><span style="flex:1">' + h(k[1]) + "</span>" +
            '<button class="btn sm' + (n[k[0]] ? " primary" : "") + '" data-act="line-notify" data-v="' + k[0] + '">' +
            (n[k[0]] ? "受け取る" : "止めている") + "</button></div>";
        }).join("")
      : '<div class="empty">LINE とつながっていません。一度ログアウトして、LINE でログインし直してください。</div>') +
    (LINE_OA
      ? '<div class="row" style="align-items:center;gap:10px"><span style="flex:1">通知が来ないとき</span>' +
          '<a class="btn sm" href="https://line.me/R/ti/p/' + encodeURIComponent(LINE_OA) + '" target="_blank" rel="noopener">公式アカウントを友だち追加</a></div>'
      : "") +
    "</div></div></section>";
}
// 公式アカウントのトークに送られた要望・感想。読んだら「対応した」で下に回す。
function settingsFeedback(){
  const open = S.feedback.filter(f => !f.done), done = S.feedback.filter(f => f.done).slice(0, 10);
  const row = function(f){
    const who = (f.member_id && member(f.member_id)) ? member(f.member_id).name : (f.sender_name || "ボード未登録の人");
    return '<div class="row" style="align-items:flex-start;gap:10px">' +
      '<span style="flex:1;min-width:0' + (f.done ? ";color:var(--muted)" : "") + '">' +
        '<span style="white-space:pre-wrap">' + h(f.body) + "</span><br>" +
        '<span style="font-size:12px;color:var(--muted)">' + h(who) + "・" + h(stamp(f.created_at)) + "</span></span>" +
      '<button class="btn sm' + (f.done ? " ghost" : "") + '" data-act="fb-done" data-id="' + h(f.id) + '">' +
        (f.done ? "戻す" : "対応した") + "</button>" +
      '<button class="btn sm ghost" data-act="fb-del" data-id="' + h(f.id) + '">消す</button></div>';
  };
  return '<section class="sec"><div class="sec-head"><h2>要望・感想</h2>' +
      '<span class="hint">公式アカウント' + (LINE_OA ? "（" + h(LINE_OA) + "）" : "") +
      'のトークに送られたものがここに届きます。家族にも「ここに送ってね」と伝えてください。</span></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
      (open.length ? open.map(row).join("") : '<div class="empty">新しい要望・感想はありません</div>') +
      (done.length ? done.map(row).join("") : "") +
    "</div></div></section>";
}
function settingsBrand(){
  const st = S.settings || {};
  return '<section class="sec"><div class="sec-head"><h2>ボードの名前</h2>' +
    '<span class="hint">画面の上とログイン画面に出ます。みんなの画面が変わります。</span></div>' +
    '<div class="panel"><div style="padding:14px">' +
      '<div class="fields two">' +
        '<label class="f">名前<input type="text" id="set_brand" maxlength="20" placeholder="例：藤澤家" value="' + h(st.brand || "") + '"></label>' +
        '<label class="f">小さく添える言葉<input type="text" id="set_brand_sub" maxlength="20" placeholder="例：みんなのボード" value="' + h(st.brand_sub || "") + '"></label>' +
      "</div>" +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-act="save-brand">保存</button></div>' +
    "</div></div></section>";
}
function viewSettings(){
  return (EDITABLE_BRAND ? settingsBrand() : "") + (customizable() ? settingsCustomize() : "") +
    (LINE_LOGIN ? settingsFeedback() + settingsLine() : "") +
    '<section class="sec"><div class="sec-head"><h2>スタッフ</h2></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (S.members.length ? S.members.map(m =>
      '<div class="row" style="align-items:center;gap:10px">' +
      '<span class="who" style="flex:1"><span class="pip" style="background:' + h(m.color) + '"></span>' + h(m.name) +
      (S.me && m.id === S.me.id ? ' <span class="chip">あなた</span>' : "") + "</span>" +
      '<span class="chip ' + (m.present ? "ok" : "") + '">' + (m.present ? "在席" : "不在") + "</span>" +
      '<button class="btn sm ghost" data-act="edit-member" data-id="' + h(m.id) + '">編集</button></div>').join("")
      : '<div class="empty">—</div>') + "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>文字の大きさ</h2>' +
      '<span class="hint">この端末でだけ変わります。ほかの人の見え方はそのままです。</span></div>' +
    '<div class="panel"><div style="padding:14px;display:flex;gap:8px;flex-wrap:wrap">' +
    FONT_SIZES.map(function(f){
      return '<button class="btn' + (S.fontSize === f[0] ? " primary" : "") +
        '" data-act="font-size" data-v="' + f[0] + '">' + f[1] + "</button>";
    }).join("") + "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>下のメニュー</h2>' +
      '<span class="hint">スマホの下に出すタブを' + TAB_MAX + 'つまで選べます。この端末でだけ変わります。' +
      '外したものは「その他」から開けます。</span>' +
      '<div class="btn-row" style="margin-left:auto"><button class="btn sm ghost" data-act="tab-reset">初期に戻す</button></div></div>' +
    '<div class="panel" style="margin-bottom:12px"><div style="padding:14px">' +
      '<div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">帯の高さ（スマホ）</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      BAR_SIZES.map(function(x){
        return '<button class="btn' + (S.barSize === x[0] ? " primary" : "") +
          '" data-act="bar-size" data-v="' + x[0] + '">' + x[1] + "</button>";
      }).join("") + "</div></div></div>" +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    S.tabBar.map(function(id, i){
      const t = TABS.find(function(x){ return x.id === id; });
      if (!t) return "";
      return '<div class="row" style="align-items:center;gap:8px">' +
        '<span class="num" style="width:22px;color:var(--muted)">' + (i + 1) + "</span>" +
        '<span style="flex:1;font-weight:500">' + h(t.label) + "</span>" +
        '<button class="btn sm ghost" data-act="tab-up" data-id="' + h(id) + '" aria-label="上へ"' +
          (i === 0 ? " disabled" : "") + ">▲</button>" +
        '<button class="btn sm ghost" data-act="tab-down" data-id="' + h(id) + '" aria-label="下へ"' +
          (i === S.tabBar.length - 1 ? " disabled" : "") + ">▼</button>" +
        '<button class="btn sm" data-act="tab-off" data-id="' + h(id) + '">外す</button></div>';
    }).join("") + "</div></div>" +
    (function(){
      const rest = visibleTabs().filter(function(t){ return S.tabBar.indexOf(t.id) < 0; });
      if (!rest.length) return "";
      return '<div class="sec-head" style="margin:14px 0 8px"><h2 style="font-size:14px">「その他」に入っているもの</h2></div>' +
        '<div class="panel"><div class="rows" style="border-top:0">' +
        rest.map(function(t){
          return '<div class="row" style="align-items:center;gap:8px">' +
            '<span style="flex:1;color:var(--muted)">' + h(t.label) + "</span>" +
            '<button class="btn sm" data-act="tab-on" data-id="' + h(t.id) + '">下に出す</button></div>';
        }).join("") + "</div></div>";
    })() + "</section>" +

    '<section class="sec"><div class="sec-head"><h2>スマホの通知</h2>' +
      '<span class="hint">会議やお知らせが登録されたとき、決まったことが書かれたとき、' +
      "そして毎朝8時に「今日のこと」が届きます。端末ごとに設定します。</span></div>" +
    '<div class="panel"><div style="padding:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<span class="chip ' + (S.push.on ? "ok" : "") + '">' + (S.push.on ? "この端末は受け取ります" : "この端末は受け取りません") + "</span>" +
      (S.push.on
        ? '<button class="btn" data-act="push-off">止める</button>'
        : '<button class="btn primary" data-act="push-on">通知を受け取る</button>') +
      (S.push.why ? '<div style="flex:1 1 100%;font-size:12.5px;color:var(--muted);line-height:1.7">' +
        h(S.push.why) + "</div>" : "") +
    "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>' + h(PLACE) + "から持ち出すもの</h2>" +
      '<span class="hint">持ち出し・返却はホームから。ここでは増やしたり外したりできます。</span>' +
      '<div class="btn-row"><button class="btn sm primary" data-act="new-device">＋ 追加</button></div></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (S.devices.filter(d => d.active).length
      ? S.devices.filter(d => d.active).map(function(d){
          return '<div class="row" style="align-items:center;gap:10px">' +
            '<span style="flex:1;font-size:13.5px">' + h(d.name) + "</span>" +
            '<button class="btn sm ghost" data-act="del-device" data-id="' + h(d.id) + '">外す</button></div>';
        }).join("")
      : '<div class="empty">まだありません</div>') + "</div></div></section>" +

    // 緊急連絡先は探している時がいちばん急いでいる。一覧で並べておく。
    '<section class="sec"><div class="sec-head"><h2>連絡先・緊急連絡先</h2>' +
      '<span class="hint">本部のメンバーだけが見られます。拠点のスタッフには出ません。編集は上の「編集」から。</span></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (S.members.length ? S.members.map(function(m){
      const tel = (m.phone || "").trim();
      return '<div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">' +
        '<span class="who" style="flex:1 1 100px"><span class="pip" style="background:' + h(m.color) + '"></span>' +
        h(m.name) + "</span>" +
        (tel ? '<a href="tel:' + h(telHref(tel)) + '" style="font-size:13px">☎ ' + h(tel) + "</a>"
             : '<span style="font-size:12.5px;color:var(--muted)">電話番号 未登録</span>') +
        '<span style="flex:1 1 160px;font-size:12.5px;color:var(--ink-2)">' +
          (m.emergency ? h(m.emergency) : '<span style="color:var(--muted)">緊急連絡先 未登録</span>') + "</span></div>";
    }).join("") : '<div class="empty">—</div>') + "</div></div></section>" +

    viewSignupGate() +

    '<section class="sec"><div class="sec-head"><h2>求人パイプのURL</h2>' +
    '<span class="hint">スケジュールの「関連リンク」からワンタップで入れられます。</span></div>' +
    '<div class="panel"><div style="padding:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<input type="url" id="set_recruit" style="flex:1 1 220px" value="' + h(recruitUrl()) + '" placeholder="https://">' +
      '<button class="btn primary" data-act="save-recruit">保存</button>' +
      (recruitUrl() ? '<a href="' + h(recruitUrl()) + '" target="_blank" rel="noopener noreferrer" style="font-size:12.5px">開く ↗</a>' : "") +
    "</div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>このアカウント</h2></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
      '<div class="row" style="align-items:center"><span style="flex:1">表示名</span><b>' + h(meName()) + "</b>" +
      '<button class="btn sm" data-act="edit-member" data-id="' + h(S.me ? S.me.id : "") + '">変更</button></div>' +
      '<div class="row" style="align-items:center"><span style="flex:1">メールアドレス</span>' +
      '<span class="num" style="font-size:12.5px;color:var(--muted)">' + h(S.user ? S.user.email : "") + "</span></div>" +
      '<div class="row" style="align-items:center"><span style="flex:1">ログアウト</span>' +
      '<button class="btn sm" data-act="signout">ログアウト</button></div>' +
    "</div></div></section>" +

    (SUPPORT
      ? '<section class="sec"><div class="sec-head"><h2>困ったとき</h2>' +
          '<span class="hint">直らない不具合や、消してしまったものがあるときの連絡先です。</span></div>' +
        '<div class="panel"><div style="padding:14px;font-size:13px;line-height:1.8;white-space:pre-wrap">' +
          linkify(SUPPORT) + "</div></div></section>"
      : "") +

    '<section class="sec"><div class="sec-head"><h2>個人情報の取り扱い</h2>' +
      '<span class="hint">ここに文章を入れると、登録する前の画面からスタッフが読めます。' +
      '氏名・電話番号・緊急連絡先・暗証番号を預かるので、渡す前に入れてください。</span></div>' +
    '<div class="panel"><div style="padding:14px">' +
      (privacyText()
        ? '<p style="font-size:12.5px;color:var(--muted);margin:0 0 10px">' +
            "いまの文章はスタッフも読めます。" +
            '<button class="btn sm ghost" data-act="privacy">読む</button></p>'
        : '<p class="err" style="margin:0 0 10px">まだ入っていません。' +
            "いまはスタッフに何も見えていません。</p>") +
      '<textarea id="set_privacy" rows="8" style="width:100%;font-size:13px;line-height:1.7" ' +
        'placeholder="PRIVACY.md のひな形を貼って、〈 〉を自分の会社のものに書き換えてください。">' +
        h(privacyText()) + "</textarea>" +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
        '<button class="btn primary" data-act="save-privacy">保存</button>' +
      "</div></div></div></section>" +

    '<section class="sec"><div class="sec-head"><h2>データの扱い</h2></div>' +
    '<div class="note">予定・タスク・支払い・店舗・ID /パスは、ログインしたスタッフ全員が読み書きできます。<br>' +
    '媒体のID・パスワードもそのまま保存されるので、ログインできる人には見えます。<br>' +
    '「スタッフの登録方法」を「誰でも」にしている間は、URL を知った人が登録して中身を見られます。<br>' +
    '銀行やクレジットカードの認証情報など、漏れると被害が大きいものはここに置かないでください。</div></section>';
}

function viewSignupGate(){
  const st = S.settings || { signup_mode: "code", invite_code: "" };
  const mode = st.signup_mode;
  const modes = [
    ["code", "招待コード", "コードを知っている人だけが登録できます。おすすめ。"],
    ["allowlist", "メールアドレス", "下のリストに載せたアドレスの人だけが登録できます。"],
    ["open", "誰でも", "URL を知っていれば誰でも登録できます。外部の人にも中身が見えます。"]
  ];
  return '<section class="sec"><div class="sec-head"><h2>スタッフの登録方法</h2>' +
    '<span class="hint">新しいスタッフがアカウントを作るときの条件です。</span></div>' +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    modes.map(m =>
      '<button class="row" style="width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);background:' +
        (mode === m[0] ? "var(--surface-2)" : "none") + ';align-items:flex-start;gap:11px" data-act="signup-mode" data-v="' + m[0] + '">' +
      '<span class="tick' + (mode === m[0] ? " on" : "") + '" style="pointer-events:none">' + (mode === m[0] ? "✓" : "") + "</span>" +
      '<span style="flex:1"><span style="font-weight:700;font-size:14px">' + h(m[1]) + "</span>" +
      '<span style="display:block;font-size:12.5px;color:var(--muted);margin-top:2px">' + h(m[2]) + "</span></span></button>").join("") +
    "</div>" +
    (mode === "code"
      ? '<div style="padding:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '<span style="font-size:12px;color:var(--muted);font-weight:700">いまの招待コード</span>' +
        '<code style="font-family:var(--mono);font-size:17px;font-weight:600;letter-spacing:.08em;background:var(--surface-2);border:1px solid var(--line);padding:5px 12px;border-radius:4px">' +
          h(st.invite_code || "—") + "</code>" +
        '<button class="btn sm" data-act="copy-code">コピー</button>' +
        '<button class="btn sm ghost" data-act="new-code">作り直す</button>' +
        '<p style="flex:1 1 100%;font-size:12px;color:var(--muted);margin-top:4px">' +
        'このコードをスタッフに口頭や LINE で伝えてください。作り直すと、それ以前のコードは使えなくなります。</p></div>'
      : mode === "open"
      ? '<div style="padding:14px"><p class="note" style="margin:0">URL を知っている人は誰でも登録でき、シフト・支払い・事務所の状況が見えます。' +
        '外部に URL が漏れたときに気づけないので、登録が済んだら「招待コード」に戻すことをおすすめします。</p></div>'
      : "") +
    "</div></section>" +
    (mode === "allowlist"
      ? '<section class="sec"><div class="sec-head"><h2>ログインを許可するメールアドレス</h2>' +
        '<div class="spacer"></div><button class="btn primary" data-act="new-allowed">＋ 追加</button></div>' +
        '<div class="panel"><div class="rows" style="border-top:0">' +
        (S.allowed.length ? S.allowed.map(a =>
          '<div class="row" style="align-items:center;gap:10px"><span class="num" style="flex:1;font-size:13px">' + h(a.email) + "</span>" +
          (a.note ? '<span class="chip">' + h(a.note) + "</span>" : "") +
          '<button class="btn sm danger" data-act="del-allowed" data-id="' + h(a.email) + '">削除</button></div>').join("")
          : '<div class="empty">まだ登録がありません。</div>') + "</div></div></section>"
      : "");
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
// カレンダーの日を押したとき。まずその日の全員を読ませ、直すのはそこから本人へ。
// マスに全部は入らないので、読む場所と書く場所をここで分ける。
function modalDayAll(date){
  const ym = date.slice(0, 7), w = DOW[dow(ym, Number(date.slice(8, 10)))];
  const nt = noticesOn(date);
  const rows = S.members.map(function(m){
    const d = dayOf(m.id, date) || {};
    const K = KINDS[d.kind || ""];
    const bits = [];
    if (d.from || d.to) bits.push((UI ? "時間 " : "事務所・現場 ") + h((d.from || "--:--") + "〜" + (d.to || "--:--")));
    if (d.ngFrom || d.ngTo) bits.push("連絡不可 " + h((d.ngFrom || "--:--") + "〜" + (d.ngTo || "--:--")));
    return '<div class="row" style="align-items:flex-start;gap:10px">' +
      '<span style="flex:1;min-width:0">' +
        '<span class="who"><span class="pip" style="background:' + h(m.color) + '"></span>' + h(m.name) + "</span> " +
        '<span class="chip ' + (K.chip || "") + '">' + h(K.label) + "</span>" +
        (bits.length ? '<div style="margin-top:4px;font-size:12.5px;color:var(--muted)">' + bits.join(" ・ ") + "</div>" : "") +
        (d.plan ? '<div class="today-plan" style="margin-top:4px">' + h(d.plan) + "</div>" : "") +
        (d.done ? '<div class="done-body" style="margin-top:4px">✓ ' + h(d.done) + "</div>" : "") +
        (d.note ? '<div style="margin-top:3px;font-size:12px;color:var(--muted)">' + h(d.note) + "</div>" : "") +
        (d.url ? '<div class="note-link" style="margin-top:3px">' + linkify(d.url) + "</div>" : "") +
      "</span>" +
      '<button class="btn sm" data-act="edit-day" data-id="' + h(m.id) + '" data-date="' + date + '">編集</button></div>';
  }).join("");
  showModal(date.replace(/-/g, "/") + "（" + w + "）",
    (nt.length ? '<div class="panel" style="margin-bottom:12px"><div class="rows" style="border-top:0">' +
      nt.map(function(x){ return noticeRow(x); }).join("") + "</div></div>" : "") +
    '<div class="panel"><div class="rows" style="border-top:0">' +
    (S.members.length ? rows : '<div class="empty">メンバーがいません</div>') + "</div></div>",
    '<button class="btn" data-act="close-modal">閉じる</button>');
}
function modalDay(memberId, date){
  const m = member(memberId) || {}, d = dayOf(memberId, date) || {};
  const w = DOW[dow(date.slice(0, 7), Number(date.slice(8, 10)))];
  showModal(m.name + " ・ " + date.replace(/-/g, "/") + "（" + w + "）",
    '<div class="fields">' +
    '<label class="f">その日の動き方<select id="d_kind">' +
      kindChoices(d.kind).map(k => '<option value="' + k + '"' + ((d.kind || "") === k ? " selected" : "") + ">" +
        KINDS[k].label + "</option>").join("") + "</select></label>" +
    '<div class="fields two">' +
      '<label class="f">' + (UI ? "その場所にいる時間" : "事務所・現場にいる時間") + '（開始）<input type="time" id="d_from" value="' + h(d.from || "") + '"></label>' +
      '<label class="f">同（終了）<input type="time" id="d_to" value="' + h(d.to || "") + '"></label></div>' +
    '<label class="f">関連リンク（面接・撮影の詳細など）' +
      '<input type="url" id="d_url" value="' + h(d.url || "") + '" placeholder="' + h(recruitUrl() || "https://") + '"></label>' +
    (recruitUrl() ? '<button type="button" class="btn sm" data-act="use-recruit">求人パイプのURLを入れる</button>' : "") +
    '<label class="f">今日1日の動き（これからの予定）<textarea id="d_plan" placeholder="例：13時まで在宅で写真の差し替え、15時から事務所、夕方に面接1件">' + h(d.plan || "") + "</textarea></label>" +
    '<label class="f">やったこと（終わってから記録）<textarea id="d_done" placeholder="例：ヘブンの写真2名分差し替え完了、面接1件（体験入店へ）、備品発注">' + h(d.done || "") + "</textarea></label>" +
    '<div class="fields two">' +
      '<label class="f">連絡がつかない時間帯（開始）<input type="time" id="d_ngf" value="' + h(d.ngFrom || "") + '"></label>' +
      '<label class="f">同（終了）<input type="time" id="d_ngt" value="' + h(d.ngTo || "") + '"></label></div>' +
    '<label class="f">補足（理由・行き先など）<input type="text" id="d_note" maxlength="60" value="' + h(d.note || "") + '"></label></div>',
    '<button class="btn ghost left" data-act="clear-day" data-id="' + h(memberId) + '" data-date="' + date + '">この日を空にする</button>' +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-day" data-id="' + h(memberId) + '" data-date="' + date + '">保存</button>');
}
// 担当は「本部メンバー」と「拠点スタッフ」の2系統あるので、1つの選択肢にまとめて
// 値の頭で見分ける（m: 本部 / s: スタッフ）。
function taskAssigneeOptions(t){
  const cur = t.assignee ? "m:" + t.assignee : t.staffAssignee ? "s:" + t.staffAssignee : "";
  let out = '<option value=""' + (cur ? "" : " selected") + ">— 募集中（誰か手が空いた人）—</option>";
  if (isHq() && S.members.length){
    out += '<optgroup label="本部">' + S.members.map(function(m){
      return '<option value="m:' + h(m.id) + '"' + (cur === "m:" + m.id ? " selected" : "") + ">" + h(m.name) + "</option>";
    }).join("") + "</optgroup>";
  }
  S.sites.forEach(function(t2){
    const people = S.staff.filter(x => x.siteId === t2.id && x.active);
    if (!people.length) return;
    out += '<optgroup label="' + h(t2.name) + '">' + people.map(function(x){
      return '<option value="s:' + h(x.id) + '"' + (cur === "s:" + x.id ? " selected" : "") + ">" + h(x.name) + "</option>";
    }).join("") + "</optgroup>";
  });
  return out;
}
function modalTask(t){
  t = t || {};
  const isNew = !t.id;
  // 新規のとき、スタッフ側は自分の拠点で固定。本部は置き場所を選ぶ。
  const scope = t.siteId || (isHq() ? "" : S.siteId);
  showModal(t.id ? "編集" : "やることを登録",
    '<div class="fields">' +
    '<label class="f">やること<input type="text" id="t_title" maxlength="80" value="' + h(t.title || "") + '" placeholder="例：新人プロフィールの写真を差し替える"></label>' +
    '<label class="f">詳細・手順<textarea id="t_detail" placeholder="任せる相手が迷わないように書いておくと引き受けてもらいやすいです">' + h(t.detail || "") + "</textarea></label>" +
    (isHq()
      ? '<label class="f">置き場所<select id="t_site">' +
          '<option value=""' + (scope ? "" : " selected") + ">本部</option>" +
          S.sites.map(function(x){
            return '<option value="' + h(x.id) + '"' + (scope === x.id ? " selected" : "") + ">" + h(x.name) + "</option>";
          }).join("") + "</select></label>"
      : "") +
    '<div class="fields two">' +
      '<label class="f">担当<select id="t_assignee">' + taskAssigneeOptions(t) + "</select></label>" +
      '<label class="f">いつまでに<input type="date" id="t_due" value="' + h(t.due || "") + '"></label></div>' +
    '<label class="f">終わったときのメモ（共有）<textarea id="t_memo" placeholder="やってみて気づいたこと、次の人に伝えたいこと">' +
      h(t.doneMemo || "") + "</textarea></label>" +
    '<p style="font-size:12px;color:var(--muted);line-height:1.7">終わった人がここに書いておくと、' +
      "次に同じことをする人がそのまま読めます。「完了」にしたあとでも書けます。</p>" +
    (isHq() ? shareFields(t) : "") + "</div>",
    (t.id ? '<button class="btn danger left" data-act="del-task" data-id="' + h(t.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-task" data-id="' + h(t.id || "") + '">保存</button>');
}
/* ---- 1件ごとの公開範囲 ----
   拠点に見せるか（open_sites）と、本部の中で誰に見せるか（share / shared_with）は
   別の問いなので、欄も別にする。既定はこれまでどおり「本部の全員・拠点には出さない」。 */
function shareFields(row){
  const share = row.share || "all", picked = row.sharedWith || [], sites = row.openSites || [];
  const others = S.members.filter(m => !S.me || m.id !== S.me.id);
  return '<div class="f" style="gap:8px">公開範囲' +
    '<label class="f" style="margin:0">本部の中で<select id="x_share">' +
      '<option value="all"' + (share === "all" ? " selected" : "") + ">本部の全員</option>" +
      '<option value="some"' + (share === "some" ? " selected" : "") + ">選んだ人だけ</option></select></label>" +
    '<div class="f" id="x_who" style="margin:0"' + (share === "some" ? "" : " hidden") + ">見せる人" +
      '<div class="pick-list">' + (others.length
        ? others.map(m => '<label class="pick"><input type="checkbox" data-xwho="' + h(m.id) + '"' +
            (picked.indexOf(m.id) >= 0 ? " checked" : "") + '><span class="pip" style="background:' +
            h(m.color) + '"></span>' + h(m.name) + "</label>").join("")
        : '<span style="font-size:12px;color:var(--muted)">ほかにメンバーがいません</span>') + "</div></div>" +
    (S.sites.length
      ? '<div class="f" style="margin:0">拠点にも見せる' +
        '<div class="pick-list">' + S.sites.map(t =>
          '<label class="pick"><input type="checkbox" data-xsite="' + h(t.id) + '"' +
          (sites.indexOf(t.id) >= 0 ? " checked" : "") + ">" + h(t.name) + "</label>").join("") +
        "</div></div>"
      : "") +
    '<p style="font-size:12px;color:var(--muted);line-height:1.7">既定は「本部の全員・拠点には出さない」です。' +
    "拠点に見せたものは、その拠点のスタッフは読めますが、書き換えはできません。</p></div>";
}
function shareValues(){
  const share = valOf("x_share") || "all";
  const pick = sel => Array.prototype.slice.call(document.querySelectorAll(sel))
    .filter(c => c.checked).map(c => c.dataset.xwho || c.dataset.xsite);
  return { share: share, shared_with: share === "some" ? pick("[data-xwho]") : [],
           open_sites: pick("[data-xsite]") };
}
// 範囲を狭めた行は、一覧でもそれと分かるようにする。
function shareChip(row){
  const bits = [];
  if ((row.share || "all") === "some"){
    const names = (row.sharedWith || []).map(id => (member(id) || {}).name).filter(Boolean);
    bits.push(names.length ? names.join("・") + " だけ" : "公開先が未選択");
  }
  (row.openSites || []).forEach(function(id){
    const t = site(id); if (t) bits.push(t.name + " にも");
  });
  return bits.length ? '<span class="chip cool">' + h(bits.join(" / ")) + "</span>" : "";
}

function modalNote(x){
  x = x || {};
  const kind = x.kind || "task", share = x.share || "private", picked = x.sharedWith || [];
  const others = S.members.filter(m => !S.me || m.id !== S.me.id);
  showModal(x.id ? "自分用を編集" : "自分用に追加",
    '<div class="fields"><div class="fields two">' +
      '<label class="f">種類<select id="n_kind">' +
        '<option value="task"' + (kind === "task" ? " selected" : "") + ">やること（チェックできる）</option>" +
        '<option value="memo"' + (kind === "memo" ? " selected" : "") + ">メモ</option></select></label>" +
      '<label class="f">いつまでに<input type="date" id="n_due" value="' + h(x.due || "") + '"></label></div>' +
    '<label class="f">見出し<input type="text" id="n_title" maxlength="80" value="' + h(x.title || "") +
      '" placeholder="例：領収書をまとめる"></label>' +
    '<label class="f">中身<textarea id="n_body" placeholder="自分用の覚書。あとから見せる相手を変えられます。">' +
      h(x.body || "") + "</textarea></label>" +
    '<label class="f">見せる相手<select id="n_share">' +
      SHARE_KEYS.map(k => '<option value="' + k + '"' + (share === k ? " selected" : "") + ">" +
        SHARE_LABEL[k] + "</option>").join("") + "</select></label>" +
    '<div class="f" id="n_who"' + (share === "some" ? "" : " hidden") + ">見せる人を選ぶ" +
      '<div class="pick-list">' + (others.length
        ? others.map(m => '<label class="pick"><input type="checkbox" data-who="' + h(m.id) + '"' +
            (picked.indexOf(m.id) >= 0 ? " checked" : "") + '><span class="pip" style="background:' +
            h(m.color) + '"></span>' + h(m.name) + "</label>").join("")
        : '<span style="font-size:12px;color:var(--muted)">ほかにメンバーがいません</span>') + "</div></div>" +
    '<p style="font-size:12px;color:var(--muted);line-height:1.7">' +
      "はじめは自分だけに見えます。見せる相手を選んでも、相手は読めるだけで、" +
      "書き換えたり消したりはできません。あとから「自分だけ」に戻せます。</p></div>",
    (x.id ? '<button class="btn danger left" data-act="del-note" data-id="' + h(x.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-note" data-id="' + h(x.id || "") + '">保存</button>');
}
function modalPay(p, asExpense){
  p = p || {};
  const paid = asExpense || p.status === "paid";
  showModal(p.id ? (paid ? "経費メモを編集" : "支払いを編集") : (paid ? "経費を記録" : "支払いを登録"),
    '<div class="fields"><div class="fields two">' +
      '<label class="f">名目<input type="text" id="p_title" maxlength="60" value="' + h(p.title || "") + '" placeholder="例：事務所家賃"></label>' +
      '<label class="f">支払先<input type="text" id="p_payee" maxlength="40" value="' + h(p.payee || "") + '" placeholder="例：◯◯不動産"></label></div>' +
    '<div class="fields two">' +
      '<label class="f">金額（円）<input type="number" id="p_amount" min="0" step="1" inputmode="numeric" value="' + h(p.amount != null ? p.amount : "") + '"></label>' +
      '<label class="f">' + (paid ? "支払った日" : "期日") +
        (paid ? '<input type="date" id="p_paidon" value="' + h(p.paidOn || today()) + '">'
              : '<input type="date" id="p_due" value="' + h(p.due || "") + '">') + "</label></div>" +
    '<div class="fields two">' +
      '<label class="f">支払方法<input type="text" id="p_method" maxlength="30" value="' + h(p.method || "") + '" placeholder="例：口座振替 / カード / 現金"></label>' +
      '<label class="f">' + (paid ? "立て替えた人" : "担当") + '<select id="p_assignee">' + memberOptions(p.assignee, "— 未定 —") + "</select></label></div>" +
    '<label class="f">経費の区分<input type="text" id="p_category" list="dl_cat" maxlength="30" value="' + h(p.category || "") + '" placeholder="例：備品・消耗品"></label>' +
    '<datalist id="dl_cat">' + EXPENSE_CATEGORIES.map(function(c){ return '<option value="' + h(c) + '"></option>'; }).join("") + "</datalist>" +
    '<div class="presets">' + EXPENSE_CATEGORIES.map(function(c){
      return '<button type="button" class="preset" data-act="pay-cat" data-v="' + h(c) + '">' + h(c) + "</button>"; }).join("") + "</div>" +
    '<label class="f">メモ<input type="text" id="p_note" maxlength="80" value="' + h(p.note || "") + '" placeholder="' +
      (paid ? "レシートの有無、何に使ったかなど" : "") + '"></label></div>',
    (p.id ? '<button class="btn danger left" data-act="del-pay" data-id="' + h(p.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-pay" data-id="' + h(p.id || "") + '" data-paid="' + (paid ? "1" : "") + '">保存</button>');
}
function vaultSuggest(key, extra){
  const seen = {};
  return (extra || []).concat(S.vault.map(function(v){ return v[key]; }))
    .map(function(x){ return String(x || "").trim(); })
    .filter(function(x){ if (!x || seen[x]) return false; seen[x] = 1; return true; })
    .map(function(x){ return '<option value="' + h(x) + '"></option>'; }).join("");
}
function modalVault(v){
  v = v || {};
  showModal(v.id ? "ID /パスを編集" : "ID /パスを追加",
    '<div class="fields">' +
    '<label class="f">媒体名<input type="text" id="v_media" maxlength="40" value="' + h(v.media || "") + '" placeholder="例：シティヘブンネット"></label>' +
    '<div class="presets">' + MEDIA_PRESETS.map(x => '<button type="button" class="preset" data-act="preset" data-v="' + h(x) + '">' + h(x) + "</button>").join("") + "</div>" +
    '<div class="fields two">' +
      '<label class="f">店舗<input type="text" id="v_shop" list="dl_shop" maxlength="40" value="' + h(v.shop || "") + '" placeholder="例：本店　2号店"></label>' +
      '<label class="f">キャスト<input type="text" id="v_cast" list="dl_cast" maxlength="40" value="' + h(v.cast_name || "") + '" placeholder="個人のアカウントなら名前"></label></div>' +
    '<datalist id="dl_shop">' + vaultSuggest("shop", S.shops.map(function(x){ return x.name; })) + "</datalist>" +
    '<datalist id="dl_cast">' + vaultSuggest("cast_name", []) + "</datalist>" +
    '<label class="f">管理画面のURL<input type="url" id="v_url" value="' + h(v.url || "") + '" placeholder="https://"></label>' +
    '<div class="fields two">' +
      '<label class="f">ID<input type="text" id="v_id" value="' + h(v.login_id || "") + '" autocomplete="off"></label>' +
      '<label class="f">パスワード<input type="text" id="v_pw" value="' + h(v.password || "") + '" autocomplete="off"></label></div>' +
    '<label class="f">メモ<input type="text" id="v_note" maxlength="60" value="' + h(v.note || "") + '"></label>' +
    shareFields(v) + "</div>",
    (v.id ? '<button class="btn danger left" data-act="del-vault" data-id="' + h(v.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-vault" data-id="' + h(v.id || "") + '">保存</button>');
}
const SHOP_PLACEHOLDER = "\u25a0店名：\n\u25a0営業時間：15:00〜3:00\n\u25a0最寄り駅：\n日本橋\n\u25a0女子給\n70分6,000〜\n90分8,000〜";
const GENERIC_PLACEHOLDER = "\u25a0店名：株式会社〇〇\n\u25a0住所\n大阪市〇〇区…\n\u25a0電話\n06-0000-0000\n\u25a0メモ\n";
const CAST_PLACEHOLDER = "\u25a0店名：はるか\n\u25a0キャッチコピー\nモデル級の美しさ\n\u25a0年齢\n25歳\n\u25a0身長\n170cm\n\u25a0サイズ\nB:93 W:56 H:88";
function modalShop(sp){
  sp = sp || {};
  // 新規は、いま開いている種別で作る。編集は元の種別を保つ。
  const kind = sp.id ? (sp.kind || "shop") : shopKind();
  const isCast = kind === "cast";
  // 分類の名前を変えたボードでは、元の店舗・プロフィールの例は当てはまらない。
  const asIs = shopKindLabel(kind) === (isCast ? "掲載用プロフィール" : "店舗");
  showModal((sp.id ? "編集" : "追加") + "：" + shopKindLabel(kind),
    '<div class="fields">' +
    '<label class="f">貼り付け（■ の形式そのまま）' +
      '<textarea id="s_paste" rows="16" style="min-height:280px;font-size:13px;line-height:1.7" placeholder="' +
      h(!asIs ? GENERIC_PLACEHOLDER : isCast ? CAST_PLACEHOLDER : SHOP_PLACEHOLDER) + '">' + h(sp.id ? shopText(sp) : "") + "</textarea></label>" +
    '<input type="hidden" id="s_kind" value="' + h(kind) + '">' +
    '<p style="font-size:12px;color:var(--muted);line-height:1.7">' +
      (!asIs ? "まとめてある文章をそのまま貼ってください。" : isCast ? "プロフィールをそのまま貼ってください。" : "求人票をそのまま貼ってください。") +
      '<strong>■</strong> で始まる行が見出しになります。' +
      '「■店名：〇〇」のように同じ行に書いても、次の行に書いても大丈夫です。<br>' +
      (!asIs
        ? "1行目の <strong>■店名</strong> には、その情報の名前（会社名など）を入れてください。見出しの数や順番は自由です。</p>"
        : isCast
        ? "1行目の <strong>■店名</strong> にはその子の名前を入れてください。見出しの数や順番は自由です。</p>"
        : "見出しの数や順番は店舗ごとに自由です。</p>") +
    (isCast ? "" :
      '<label class="f">電話番号<input type="tel" id="s_phone" inputmode="tel" placeholder="例：06-1234-5678" value="' +
      h(sp.phone || "") + '"></label>') +
    '<label class="f">並び順<input type="number" id="s_sort" value="' +
      h(sp.sort_order != null ? sp.sort_order : (S.shops.filter(x => (x.kind || "shop") === kind).length + 1)) + '"></label>' +
    "</div>",
    (sp.id ? '<button class="btn danger left" data-act="del-shop" data-id="' + h(sp.id) + '">削除</button>' : "") +
    '<button class="btn" data-act="close-modal">やめる</button>' +
    '<button class="btn primary" data-act="save-shop" data-id="' + h(sp.id || "") + '">保存</button>');
}
function modalMember(m){
  m = m || {};
  showModal("スタッフを編集",
    '<div class="fields">' +
    '<label class="f">名前<input type="text" id="m_name" maxlength="12" value="' + h(m.name || "") + '"></label>' +
    '<label class="f">電話番号<input type="tel" id="m_phone" inputmode="tel" maxlength="20" value="' +
      h(m.phone || "") + '" placeholder="090-0000-0000"></label>' +
    '<label class="f">緊急連絡先<input type="text" id="m_emg" maxlength="80" value="' +
      h(m.emergency || "") + '" placeholder="例：母 090-0000-0000"></label>' +
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
    member_id: memberId, date: date, kind: day.kind || "", plan: day.plan || "", done: day.done || "",
    ng_from: day.ngFrom || "", ng_to: day.ngTo || "", note: day.note || "",
    from_time: day.from || "", to_time: day.to || "", link_url: day.url || "",
    updated_by: S.me.id, updated_at: nowIso()
  }, { onConflict: "member_id,date" }));
}
// 担当の選択肢は "m:<id>"（本部）か "s:<id>"（拠点スタッフ）。
function splitAssignee(v){
  const raw = String(v || "");
  if (raw.slice(0, 2) === "m:") return { assignee: raw.slice(2), staff_assignee: null };
  if (raw.slice(0, 2) === "s:") return { assignee: null, staff_assignee: raw.slice(2) };
  return { assignee: null, staff_assignee: null };
}
async function saveTaskFromModal(id){
  const title = valOf("t_title");
  if (!title){ toast("やることを入力してください"); return; }
  const who = splitAssignee(valOf("t_assignee"));
  const siteBox = el("t_site");
  const body = { title: title, detail: valOf("t_detail"), due: valOf("t_due") || null,
    done_memo: valOf("t_memo"), assignee: who.assignee, staff_assignee: who.staff_assignee };
  if (siteBox) body.site_id = siteBox.value || null;
  else if (!isHq()) body.site_id = S.siteId;
  // 拠点スタッフの画面には公開範囲の欄を出していないので、そのときは触らない。
  if (el("x_share")) Object.assign(body, shareValues());
  if (id){
    const cur = S.tasks.find(t => t.id === id) || {};
    const owner = who.assignee || who.staff_assignee;
    if (owner && owner !== (cur.assignee || cur.staffAssignee)) body.taken_at = nowIso();
    await run(sb.from("tasks").update(body).eq("id", id), "保存しました");
  } else {
    body.status = "open";
    if (isHq()) body.created_by = S.me.id; else body.staff_created_by = staffMeId();
    if (who.assignee || who.staff_assignee) body.taken_at = nowIso();
    await run(sb.from("tasks").insert(body), "登録しました");
  }
  closeModal();
}
async function savePayFromModal(id, paid){
  const title = valOf("p_title");
  if (!title){ toast("名目を入力してください"); return; }
  const body = { title: title, payee: valOf("p_payee"), amount: Number(valOf("p_amount") || 0),
    method: valOf("p_method"), assignee: valOf("p_assignee") || null,
    category: valOf("p_category"), note: valOf("p_note") };
  if (paid){
    body.status = "paid";
    body.paid_on = valOf("p_paidon") || today();
    body.paid_at = new Date(body.paid_on + "T12:00:00").toISOString();
    body.paid_by = S.me.id;
    body.due = null;
  } else {
    body.due = valOf("p_due") || null;
  }
  if (id) await run(sb.from("payments").update(body).eq("id", id), "保存しました");
  else {
    if (!paid) body.status = "unpaid";
    await run(sb.from("payments").insert(body), paid ? "経費を記録しました" : "登録しました");
  }
  closeModal();
}
async function saveVaultFromModal(id){
  const media = valOf("v_media");
  if (!media){ toast("媒体名を入力してください"); return; }
  const body = { media: media, url: valOf("v_url"), note: valOf("v_note"),
    shop: valOf("v_shop"), cast_name: valOf("v_cast"),
    login_id: valOf("v_id"), password: valOf("v_pw"), updated_by: S.me.id, updated_at: nowIso() };
  Object.assign(body, shareValues());
  if (id){ await run(sb.from("vault").update(body).eq("id", id), "保存しました"); delete S.reveal[id]; }
  else await run(sb.from("vault").insert(body), "保存しました");
  closeModal();
}
function revealOne(id){
  if (S.reveal[id]) delete S.reveal[id];
  else if (S.vault.some(x => x.id === id)) S.reveal[id] = true;
  render();
}

async function saveNoteFromModal(id){
  const title = valOf("n_title");
  if (!title){ toast("見出しを入れてください"); return; }
  const share = valOf("n_share") || "private";
  // 「選んだ人だけ」以外に切り替えたときは、選択を残さず空に戻す。
  const who = share === "some"
    ? Array.prototype.slice.call(document.querySelectorAll("#n_who input[data-who]"))
        .filter(c => c.checked).map(c => c.dataset.who)
    : [];
  const body = { kind: valOf("n_kind") || "task", title: title, body: valOf("n_body"),
    due: valOf("n_due") || null, share: share, shared_with: who };
  if (id) await run(sb.from("notes").update(body).eq("id", id), "保存しました");
  else await run(sb.from("notes").insert(Object.assign({ owner: S.me.id }, body)), "登録しました");
  closeModal();
}
async function saveShopFromModal(id){
  const parsed = parseShopText(valOf("s_paste"));
  if (!parsed.name){ toast("「■店名」の行を入れてください"); return; }
  const body = { name: parsed.name, url: parsed.url, sections: parsed.sections,
    kind: valOf("s_kind") || "shop",
    sort_order: Number(valOf("s_sort") || 0), updated_by: S.me.id, updated_at: nowIso() };
  // 掲載用プロフィールの編集では欄そのものが無い。触っていない番号を消さないよう、あるときだけ入れる。
  if (el("s_phone")) body.phone = valOf("s_phone");
  if (id) await run(sb.from("shops").update(body).eq("id", id), "保存しました");
  else await run(sb.from("shops").insert(body), "登録しました");
  closeModal();
}

/* ============================ events ============================ */
document.addEventListener("click", async function(ev){
  const tabBtn = ev.target.closest("[data-tab]");
  if (tabBtn){ S.tab = tabBtn.dataset.tab; ls("prime.tab", S.tab); closeModal(); render(); return; }
  const sTabBtn = ev.target.closest("[data-stab]");
  if (sTabBtn){ S.siteTab = sTabBtn.dataset.stab; ls("prime.siteTab", S.siteTab); render(); return; }
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
      case "line-login": startLineLogin(); break;
      case "fb-done": {
        const f = S.feedback.find(x => x.id === id); if (!f) return;
        await run(sb.from("feedback").update({ done: !f.done }).eq("id", id)); break;
      }
      case "fb-del":
        if (!confirm("この要望・感想を消しますか？")) return;
        await run(sb.from("feedback").delete().eq("id", id), "消しました"); break;
      case "season-mine":
        ls("prime.season", btn.dataset.v || "");
        if (!btn.dataset.v){ try { localStorage.removeItem("prime.season"); } catch(e){} }
        applySeason(); render(); return;
      case "season-board": {
        const ui = Object.assign({}, UI || {}, { theme: btn.dataset.v });
        await saveUi(ui, "ボードの色を変えました"); break;
      }
      case "save-ui": await saveUi(collectUi()); S.uiDirty = false; break;
      case "list-pick": S.listId = id; ls("prime.listId", id); render(); return;
      case "list-new": modalListName(null); return;
      case "list-rename": { const L = curList(); if (L) modalListName(L); return; }
      case "list-save": {
        const name = valOf("ln_name");
        if (!name){ toast("名前を入れてください"); return; }
        if (id) await run(sb.from("lists").update({ name: name.slice(0, 30) }).eq("id", id), "変えました");
        else {
          const r = await run(sb.from("lists").insert({ name: name.slice(0, 30), sort_order: S.lists.length + 1 }).select().single(), "作りました");
          if (r && r.data){ S.listId = r.data.id; ls("prime.listId", r.data.id); }
        }
        closeModal(); break;
      }
      case "list-del": {
        const L = curList(); if (!L) return;
        if (!confirm("「" + L.name + "」と、その中身をすべて消しますか？")) return;
        await run(sb.from("lists").delete().eq("id", L.id), "消しました"); S.listId = ""; break;
      }
      case "list-item-add": {
        const L = curList(), title = valOf("li_title");
        if (!L || !title) return;
        await run(sb.from("list_items").insert({ list_id: L.id, title: title.slice(0, 200) })); break;
      }
      case "list-done": {
        const x = S.listItems.find(i => i.id === id); if (!x) return;
        await run(sb.from("list_items").update({ done: !x.done, updated_at: nowIso() }).eq("id", id)); break;
      }
      case "list-item-del": await run(sb.from("list_items").delete().eq("id", id)); break;
      case "list-clear-done": {
        const L = curList(); if (!L) return;
        await run(sb.from("list_items").delete().eq("list_id", L.id).eq("done", true), "消しました"); break;
      }
      case "line-notify": await toggleLineNotify(btn.dataset.v); break;
      case "new-reminder": modalReminder(); break;
      case "save-reminder": await saveReminder(); break;
      case "del-reminder":
        if (!confirm("このリマインダーを消しますか？")) return;
        await run(sb.from("reminders").delete().eq("id", id), "消しました");
        break;
      case "save-brand": {
        S.uiDirty = false;
        const b = valOf("set_brand"), s = valOf("set_brand_sub");
        await run(sb.from("board_settings").update({ brand: b, brand_sub: s, updated_at: nowIso() }).eq("id", 1), "保存しました");
        // 空にしたときは config.js の名前に戻す。
        BRAND = b || CONFIG.brand || "BOARD"; BRAND_SUB = s || CONFIG.brandSub || "事務所ボード";
        applyBrand();
        break;
      }
      case "signout": await signOut(); break;

      case "door":
        // どちらの状態にするかはボタンが持つ。裏返すだけだと、未確認から
        // 「開けた」を押したのに閉まった記録になることがある。
        await run(sb.from("office").update({ door_open: btn.dataset.v === "open",
          updated_by: S.me.id, updated_at: nowIso() }).eq("id", 1));
        break;
      case "present":
        await run(sb.from("members").update({ present: !S.me.present, present_at: nowIso() }).eq("id", S.me.id));
        break;
      case "month":
        if (btn.dataset.delta === "0"){ S.month = today().slice(0, 7); await loadAll(); render(); }
        else shiftMonth(Number(btn.dataset.delta));
        break;

      case "open-day": modalDayAll(btn.dataset.date); break;
      case "edit-day": modalDay(id, btn.dataset.date); break;
      case "save-day":
        await saveDay(id, btn.dataset.date, { kind: valOf("d_kind"), plan: valOf("d_plan"),
          done: valOf("d_done"), ngFrom: valOf("d_ngf"), ngTo: valOf("d_ngt"), note: valOf("d_note"),
          from: valOf("d_from"), to: valOf("d_to"), url: valOf("d_url") });
        toast("保存しました"); closeModal(); break;
      case "clear-day":
        await saveDay(id, btn.dataset.date, { kind:"", plan:"", done:"", ngFrom:"", ngTo:"", note:"", from:"", to:"", url:"" });
        toast("空にしました"); closeModal(); break;

      case "task-filter": S.taskFilter = btn.dataset.f; render(); break;
      case "note-side": S.noteSide = btn.dataset.v; ls("prime.noteSide", S.noteSide); render(); break;
      case "new-note": modalNote(null); break;
      case "edit-note": modalNote(S.notes.find(x => x.id === id)); break;
      case "save-note": await saveNoteFromModal(id); break;
      case "del-note": await run(sb.from("notes").delete().eq("id", id), "削除しました"); closeModal(); break;
      case "toggle-note": {
        const x = S.notes.find(v => v.id === id);
        if (x) await run(sb.from("notes").update({ status: x.status === "done" ? "open" : "done" }).eq("id", id));
        break;
      }
      case "device": {
        const out = btn.dataset.v === "out";
        await run(sb.from("device_log").insert({ device_id: id, kind: btn.dataset.v,
          member_id: S.me.id, happened_at: nowIso() }), out ? "持ち出しにしました" : "返却にしました");
        break;
      }
      case "font-size": setFontSize(btn.dataset.v); break;
      case "bar-size": setBarSize(btn.dataset.v); break;
      case "more-tabs": modalMoreTabs(); break;
      case "tab-up": moveTab(id, -1); break;
      case "tab-down": moveTab(id, 1); break;
      case "tab-on": showTab(id); break;
      case "tab-off": hideTab(id); break;
      case "tab-reset": resetTabBar(); break;
      case "push-on": await pushTurnOn(); break;
      case "push-off": await pushTurnOff(); break;
      case "new-device": {
        const name = prompt("持ち出すものの名前（例：黒スマホ）");
        if (!name || !name.trim()) break;
        await run(sb.from("devices").insert({ name: name.trim(),
          sort_order: S.devices.length + 1 }), "追加しました");
        break;
      }
      case "del-device":
        await run(sb.from("devices").update({ active: false }).eq("id", id), "一覧から外しました");
        break;
      case "reload-all": {
        try {
          if (S.screen === "staff") await loadStaffAll(); else await loadAll();
        } catch(e){ S.stale = true; }
        render();
        toast(S.stale ? "まだ繋がりません。電波の良い場所で試してください。" : "最新の状態にしました");
        break;
      }
      case "time-preset": {
        const box = el("nt_time");
        if (box){ box.value = btn.dataset.v; box.focus(); }
        break;
      }
      case "new-task": modalTask(null); break;
      case "edit-task": modalTask(S.tasks.find(t => t.id === id)); break;
      case "save-task": await saveTaskFromModal(id); break;
      case "task-site": S.taskSite = btn.dataset.v; ls("prime.taskSite", S.taskSite); render(); return;
      case "del-task": await run(sb.from("tasks").delete().eq("id", id), "削除しました"); closeModal(); break;
      case "toggle-task": {
        const t = S.tasks.find(x => x.id === id) || {};
        await run(sb.from("tasks").update(t.status === "done"
          ? { status: taskHasOwner(t) ? "doing" : "open", done_at: null, done_by: null, staff_done_by: null }
          : { status: "done", done_at: nowIso(),
              done_by: isHq() ? S.me.id : null, staff_done_by: isHq() ? null : staffMeId() }).eq("id", id));
        break;
      }
      case "take":
        await run(sb.from("tasks").update({
          assignee: isHq() ? S.me.id : null, staff_assignee: isHq() ? null : staffMeId(),
          taken_at: nowIso(), status: "doing" }).eq("id", id), "引き受けました");
        break;
      case "start": await run(sb.from("tasks").update({ status: "doing" }).eq("id", id)); break;
      case "release":
        await run(sb.from("tasks").update({ assignee: null, staff_assignee: null, status: "open" }).eq("id", id),
          "募集中に戻しました"); break;

      case "pay-filter": S.payFilter = btn.dataset.f; render(); break;
      case "new-pay": modalPay(null); break;
      case "new-expense": modalPay(null, true); break;
      case "pay-cat": { const n = el("p_category"); if (n){ n.value = btn.dataset.v; } break; }
      case "pay-month": S.payMonth = shiftMonthStr(S.payMonth, Number(btn.dataset.delta)); render(); break;
      case "edit-pay": modalPay(S.payments.find(p => p.id === id)); break;
      case "save-pay": await savePayFromModal(id, btn.dataset.paid === "1"); break;
      case "del-pay": await run(sb.from("payments").delete().eq("id", id), "削除しました"); closeModal(); break;
      case "toggle-pay": {
        const p = S.payments.find(x => x.id === id) || {};
        await run(sb.from("payments").update(p.status === "paid"
          ? { status: "unpaid", paid_at: null, paid_on: null, paid_by: null }
          : { status: "paid", paid_at: nowIso(), paid_on: today(), paid_by: S.me.id }).eq("id", id));
        break;
      }

      /* ---- 拠点・スタッフ ---- */
      case "staff-signin": await staffSignIn(); return;
      case "staff-signup": await staffRegister(); return;
      case "gate-mode": S.gateMode = btn.dataset.v; S.authErr = ""; render(); return;
      case "my-pin": modalPin(S.staffMe, true); break;
      case "show-pin": {
        const r = await sb.rpc("staff_pin_of", { p_staff: id });
        if (r.error || !r.data){ toast("暗証番号を取得できませんでした"); break; }
        S.pinShown[id] = r.data; render(); return;
      }
      case "hide-pin": delete S.pinShown[id]; render(); return;
      case "site-signup": {
        const t = site(id) || {};
        const on = t.staff_signup !== false;
        await run(sb.from("sites").update({ staff_signup: !on, updated_at: nowIso() }).eq("id", id),
          on ? "新規登録を止めました" : "新規登録を受け付けます");
        break;
      }
      case "signout": await sb.auth.signOut(); return;
      case "pick-site": {
        S.siteId = id; ls("prime.siteId", id);
        await loadSite(id);
        // 拠点によって見せているタブが違うので、非表示のタブに残らないようにする。
        const open = siteTabs();
        if (S.siteTab !== "admin" && !open.some(t => t.id === S.siteTab)){
          S.siteTab = (open[0] || {}).id || "admin"; ls("prime.siteTab", S.siteTab);
        }
        render(); return;
      }
      case "site-tab": S.siteTab = btn.dataset.v; ls("prime.siteTab", btn.dataset.v); render(); return;
      case "site-day": {
        const d = new Date(S.siteDay + "T00:00:00");
        const delta = Number(btn.dataset.delta);
        S.siteDay = delta ? ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta)) : today();
        // 別の月に移ったら、その月ぶんを読み直す。
        if (S.siteDay.slice(0, 7) !== S.siteMonth){ S.siteMonth = S.siteDay.slice(0, 7); await loadSite(S.siteId); }
        render(); return;
      }
      case "site-month":
        S.siteMonth = shiftMonthStr(S.siteMonth, Number(btn.dataset.delta));
        await loadSite(S.siteId); render(); return;

      case "punch": {
        await run(sb.from("punches").insert({ site_id: S.siteId, staff_id: staffMeId(),
          kind: btn.dataset.v, punched_at: nowIso() }),
          btn.dataset.v === "in" ? "出勤しました" : "お疲れさまでした");
        break;
      }
      case "add-punch": modalPunch(id, btn.dataset.date, null); break;
      case "fix-punch": {
        const rec = S.punches.find(x => x.id === id);
        if (rec) modalPunch(rec.staffId, jstDay(rec.punchedAt), rec);
        break;
      }
      case "save-punch": {
        const at = jstInputToIso(valOf("pu_at"));
        if (!at){ toast("日時を入れてください"); break; }
        const body = { kind: valOf("pu_kind"), punched_at: at, note: valOf("pu_note") };
        if (id) await run(sb.from("punches").update(body).eq("id", id), "直しました");
        else await run(sb.from("punches").insert(Object.assign({ site_id: S.siteId, staff_id: btn.dataset.who }, body)), "追加しました");
        closeModal(); break;
      }
      case "del-punch": await run(sb.from("punches").delete().eq("id", id), "削除しました"); closeModal(); break;

      case "key-report":
        await run(sb.from("key_events").insert({ site_id: S.siteId, staff_id: staffMeId(),
          kind: btn.dataset.v, happened_at: nowIso() }),
          btn.dataset.v === "open" ? "開けたことを記録しました" : "閉めたことを記録しました");
        break;
      case "edit-duty": modalDuty(btn.dataset.date); break;
      case "save-duty": {
        const date = btn.dataset.date;
        await run(sb.from("key_duty").upsert({ site_id: S.siteId, date: date,
          open_staff: valOf("ky_open") || null, close_staff: valOf("ky_close") || null,
          note: valOf("ky_note"), updated_at: nowIso() }, { onConflict: "site_id,date" }), "保存しました");
        closeModal(); break;
      }
      case "edit-holders": modalHolders(); break;
      case "save-holders": {
        const rows = Array.prototype.map.call(document.querySelectorAll("[data-holder]"), function(c){
          return { id: c.dataset.holder, on: c.checked,
                   note: (document.querySelector('[data-holdernote="' + c.dataset.holder + '"]') || {}).value || "" };
        });
        // staff 表には暗証番号も役割もあるので、直接は書かない。
        // 鍵の2列だけを書き換える関数を通す（本部もスタッフも同じ道）。
        let refused = 0;
        for (const r of rows){
          const cur = staffOf(r.id) || {};
          if (cur.keyHolder === r.on && (cur.keyNote || "") === r.note) continue;
          const res = await run(sb.rpc("set_key_holder", { p_staff: r.id, p_on: r.on, p_note: r.note }));
          if (!res || res.data !== true) refused += 1;
        }
        closeModal();
        toast(refused ? "一部を保存できませんでした（" + refused + "件）" : "保存しました");
        break;
      }

      case "edit-shift": modalShift(id, btn.dataset.date); break;
      case "save-shift":
        await run(sb.from("staff_shifts").upsert({ site_id: S.siteId, staff_id: id, date: btn.dataset.date,
          kind: valOf("sh_kind"), from_time: valOf("sh_from"), to_time: valOf("sh_to"),
          note: valOf("sh_note"), updated_at: nowIso() }, { onConflict: "staff_id,date" }), "保存しました");
        closeModal(); break;
      case "clear-shift":
        await run(sb.from("staff_shifts").delete().eq("staff_id", id).eq("date", btn.dataset.date), "空にしました");
        closeModal(); break;

      case "new-site": modalSite(null); break;
      case "edit-site": modalSite(site(id)); break;
      case "save-site": {
        const name = valOf("si_name"), code = valOf("si_code").toLowerCase().trim();
        if (!name){ toast("拠点名を入力してください"); break; }
        if (!/^[a-z0-9-]{2,24}$/.test(code)){ toast("入り口コードは半角の英小文字・数字・ハイフンで2〜24文字です"); break; }
        const body = { name: name, code: code, note: valOf("si_note"), updated_at: nowIso() };
        if (id) await run(sb.from("sites").update(body).eq("id", id), "保存しました");
        else await run(sb.from("sites").insert(Object.assign({ sort_order: S.sites.length + 1 }, body)), "追加しました");
        closeModal(); break;
      }
      case "del-site":
        await run(sb.from("sites").delete().eq("id", id), "拠点を削除しました");
        S.siteId = ""; closeModal(); break;
      case "site-open": {
        const t = site(id) || {};
        await run(sb.from("sites").update({ open: !t.open, updated_at: nowIso() }).eq("id", id),
          t.open ? "入り口を停止しました" : "入り口を公開しました");
        break;
      }
      case "site-tabon": {
        const t = site(id) || {};
        const tabs = Object.assign({}, t.tabs || {});
        tabs[btn.dataset.v] = tabs[btn.dataset.v] === false;
        await run(sb.from("sites").update({ tabs: tabs, updated_at: nowIso() }).eq("id", id));
        break;
      }
      case "copy-site-url": {
        const t = site(id) || {};
        copy(location.origin + location.pathname + "?s=" + t.code, "入り口の URL");
        break;
      }
      case "new-staff": modalStaff(null); break;
      case "edit-staff": modalStaff(staffOf(id)); break;
      case "save-staff": {
        const name = valOf("sf_name");
        if (!name){ toast("名前を入力してください"); break; }
        const keyBox = el("sf_key");
        const body = { name: name, role: valOf("sf_role"), active: valOf("sf_active") === "1",
          key_holder: !!(keyBox && keyBox.checked), key_note: valOf("sf_keynote"), updated_at: nowIso() };
        if (id) await run(sb.from("staff").update(body).eq("id", id), "保存しました");
        else await run(sb.from("staff").insert(Object.assign({ site_id: S.siteId, sort_order: siteStaff().length + 1 }, body)),
          "追加しました。続けて暗証番号を発行してください");
        closeModal(); break;
      }
      case "del-staff": await run(sb.from("staff").delete().eq("id", id), "削除しました"); closeModal(); break;
      case "set-pin": modalPin(staffOf(id)); break;
      case "save-pin": {
        const pin = valOf("pn_pin").trim();
        if (!/^[0-9]{4}$/.test(pin)){ toast("暗証番号は数字4桁です"); break; }
        if (pin !== valOf("pn_pin2").trim()){ toast("確認用の暗証番号が一致しません"); break; }
        await run(sb.rpc("staff_set_pin", { p_staff: id, p_pin: pin }), "暗証番号を変えました");
        delete S.pinShown[id];
        closeModal(); break;
      }

      case "new-vault": modalVault(null); break;
      case "edit-vault": modalVault(S.vault.find(x => x.id === id)); break;
      case "save-vault": await saveVaultFromModal(id); break;
      case "del-vault":
        await run(sb.from("vault").delete().eq("id", id), "削除しました"); delete S.reveal[id]; closeModal(); break;
      case "reveal": {
        revealOne(id);
        const box = el("vaultList");
        if (box && S.tab === "vault") box.innerHTML = renderVaultList();
        break;
      }
      case "copy-v": {
        // 表示中の行の値をそのまま読む。列名は data-k と同じなので取り違えようがない。
        const v = S.vault.find(x => x.id === id);
        if (v) copy(v[btn.dataset.k], btn.dataset.k === "password" ? "パスワード" : "ID");
        break;
      }
      case "use-recruit": { const n = el("d_url"); if (n) n.value = recruitUrl(); break; }
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
        await run(sb.from("members").update({ name: name, color: valOf("m_color"),
          phone: valOf("m_phone"), emergency: valOf("m_emg") }).eq("id", id), "保存しました");
        closeModal(); break;
      }
      case "del-member":
        await run(sb.from("members").delete().eq("id", id), "スタッフを外しました"); closeModal(); break;

      case "theme": cycleTheme(); break;
      case "signup-mode":
        await run(sb.from("board_settings").update({ signup_mode: btn.dataset.v, updated_at: nowIso() }).eq("id", 1), "変更しました");
        S.mode = btn.dataset.v;
        break;
      case "new-code": {
        const code = BRAND + "-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
        await run(sb.from("board_settings").update({ invite_code: code, updated_at: nowIso() }).eq("id", 1), "新しいコードにしました");
        break;
      }
      case "copy-code":
        copy((S.settings || {}).invite_code || "", "招待コード"); break;
      case "save-recruit":
        await run(sb.from("board_settings").update({ recruit_url: valOf("set_recruit"), updated_at: nowIso() }).eq("id", 1), "保存しました");
        break;
      case "privacy": modalPrivacy(); return;
      case "save-privacy": {
        // 空にするのは「スタッフから見えなくする」操作なので、取り消しが効かない旨を出す。
        const txt = valOf("set_privacy").trim();
        if (!txt && !confirm("空にすると、スタッフから読めなくなります。よろしいですか？")) return;
        await run(sb.from("board_settings").update({ privacy_text: txt, updated_at: nowIso() }).eq("id", 1), "保存しました");
        S.privacy = txt;
        break;
      }
      case "new-notice": modalNotice(null); break;
      case "edit-notice": modalNotice(S.notices.find(x => x.id === id)); break;
      case "save-notice": await saveNoticeFromModal(id); break;
      case "del-notice": await run(sb.from("notices").delete().eq("id", id), "削除しました"); closeModal(); break;
      case "shop-kind": S.shopKind = btn.dataset.v; ls("prime.shopKind", S.shopKind); render(); return;
      case "new-shop": modalShop(null); break;
      case "edit-shop": modalShop(S.shops.find(x => x.id === id)); break;
      case "save-shop": await saveShopFromModal(id); break;
      case "del-shop": await run(sb.from("shops").delete().eq("id", id), "削除しました"); closeModal(); break;
      case "copy-shop": {
        const sp = S.shops.find(x => x.id === id);
        if (sp) copy(shopText(sp), "店舗の詳細");
        break;
      }
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
  if (S.screen === "app"){ try { await loadAll(); } catch(e){} render(); }
  else if (S.screen === "staff"){ try { await loadStaffAll(); } catch(e){} render(); }
});
document.addEventListener("input", function(ev){
  const t = ev.target;
  if (!t || !t.id) return;
  if (/^(au_|pf_|st_)/.test(t.id)) S.form[t.id] = t.value;
  // カスタマイズ欄を書きかけの間は、読み直しで描き直さない（保存すると戻る）。
  if (/^(ct_|ck_|ch_|c_|set_brand)/.test(t.id) || t.classList.contains("c_cat")) S.uiDirty = true;
  if (t.id === "v_q"){
    S.vaultQ = t.value;
    const box = el("vaultList");
    if (box) box.innerHTML = renderVaultList();
  }
});
document.addEventListener("change", function(ev){
  const t = ev.target;
  if (t && /^st_/.test(t.id)) S.form[t.id] = t.value;
  if (t && t.id && /^(ct_|ck_|ch_)/.test(t.id)) S.uiDirty = true;
  if (t && t.id === "x_share"){
    const box = el("x_who");
    if (box) box.hidden = t.value !== "some";
  }
  if (t && t.id === "n_share"){
    const box = el("n_who");
    if (box) box.hidden = t.value !== "some";
  }
  if (t && t.id === "v_group"){
    S.vaultGroup = t.value; ls("prime.vaultGroup", t.value);
    const box = el("vaultList");
    if (box) box.innerHTML = renderVaultList();
  }
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
  if (S.uiDirty && S.screen === "app" && S.tab === "set"){ renderDoor(); renderHere(); renderTabs(); return; }
  if (S.tab !== "set") S.uiDirty = false;
  if (f && v && v.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && S.screen === "app"){
    renderDoor(); renderHere(); renderTabs(); return;
  }
  if (f && v && v.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && S.screen === "staff"){
    renderStaffBar(); renderStaffTabs(); return;
  }
  _render();
};

boot();
})();
