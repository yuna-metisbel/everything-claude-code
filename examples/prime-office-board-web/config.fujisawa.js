/* 藤澤家ボードの接続先（Render の build で config.js に差し替える）。
   ここに置くのはブラウザに配られる前提の公開値だけ。秘密は Supabase の中。 */
window.BOARD_CONFIG = {
  supabaseUrl: "https://gsuzsdoinoowiuuxomue.supabase.co",
  supabaseKey: "sb_publishable_imxwJTjlyLhXtE2ebC71NQ_AKE1Db92",
  // 名前は「設定」から登録者が決める。ここは未設定のときの仮の名前。
  brand: "ボード",
  brandSub: "みんなの予定",
  support: "",
  // 追加機能（../prime-office-board-supabase/addons/line）
  lineLogin: "2011881307",
  lineOaId: "@872jywvg",
  editableBrand: true,
  reminders: true
};
