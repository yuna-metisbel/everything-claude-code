/* 藤澤家ボードの接続先（Render の build で config.js に差し替える）。
   ここに置くのはブラウザに配られる前提の公開値だけ。秘密は Supabase の中。 */
window.BOARD_CONFIG = {
  supabaseUrl: "https://gsuzsdoinoowiuuxomue.supabase.co",
  supabaseKey: "sb_publishable_imxwJTjlyLhXtE2ebC71NQ_AKE1Db92",
  // 名前は「設定」から変えられる。ここは URL を共有したときの題名と、
  // 設定がまだ読めていない一瞬に出る名前（build-site.sh が index.html に書き込む）。
  brand: "藤澤家",
  brandSub: "住民票バラバラな我が家のオンラインハウス",
  support: "",
  // 追加機能（../prime-office-board-supabase/addons/line）
  lineLogin: "2011881307",
  lineOaId: "@872jywvg",
  editableBrand: true,
  reminders: true
};
