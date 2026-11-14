// 合同会社リーブルゲート の事務所ボード。
// これは「大元」のボード。ここから関わっている会社のボードを開ける（clients）。
// 相手のボードはこの設定を持たないので、相手からこちらへは入れない（片方向）。
// Render の Build Command: sh examples/prime-office-board-web/build-site.sh libregate
window.BOARD_CONFIG = {
  supabaseUrl: "https://zdctkdchovarrkxbrvsr.supabase.co",
  supabaseKey: "sb_publishable_2ndYlIweQHcyBHl4kzAZUA_GxCoWFSg",
  brand: "リーブルゲート",
  brandSub: "事務所ボード",
  support: "",

  // LINE はチャネルを作ってから入れる。空のあいだはメールとパスワードだけで入れる。
  lineLogin: "",
  lineOaId: "",
  lineLoginOptional: true,

  editableBrand: true,
  reminders: true,
  contracts: true,
  taskProgress: true,

  // 関わっている会社のボードへの入り口。ホームの右側に出る。
  // 増やすときはここに1行足すだけ（相手のボードは何も変えない）。
  clientsTitle: "関わっている会社のボード",
  clients: [
    { name: "しろspa（ナディア滋賀店）", url: "https://shirospa-board.onrender.com", note: "" }
  ]
};
