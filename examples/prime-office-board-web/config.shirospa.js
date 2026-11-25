/* しろspa（ナディア滋賀店）ボードの接続先（Render の build で config.js に差し替える）。
   ここに置くのはブラウザに配られる前提の公開値だけ。秘密は Supabase の中。 */
window.BOARD_CONFIG = {
  supabaseUrl: "https://qnmkzhjkgaaeqqnplubd.supabase.co",
  supabaseKey: "sb_publishable_FrUgK__HEStLMlJ8M3jv9Q_BBKeKkmU",
  // 名前は「設定」から変えられる。ここは URL を共有したときの題名と、
  // 設定がまだ読めていない一瞬に出る名前（build-site.sh が index.html に書き込む）。
  brand: "しろspa",
  brandSub: "事務所ボード",
  support: "",
  // 盤の色の既定。白地に緑で、マーク（緑の「S」）と合わせる。
  // ボードの「設定 → 色」で選べば、そちらが勝つ。
  season: "summer",
  themeColor: "#FFFFFF",
  // 追加機能（../prime-office-board-supabase/addons/line）
  // LINE のチャネル ID は、チャネルを作ってから入れる。空のあいだは
  // メールとパスワードだけで入れる（LINE のボタンは出ない）。
  lineLogin: "",
  lineOaId: "",
  // メールと LINE の両方を1枚のログイン画面に出す（本部メンバーだけ）。
  lineLoginOptional: true,

  // ログイン画面に「パスワードを忘れた」を出す。決め直すリンクをメールで送るので、
  // Supabase 側の Site URL と Redirect URLs をこのボードの URL にしてある。
  passwordReset: true,
  editableBrand: true,
  reminders: true,
  // スタッフの契約書（リンクだけ）。addons/line/04_staff_contracts.sql を流したボードだけ。
  contracts: true,
  // やることの進捗を割合でも出す。
  taskProgress: true
};
