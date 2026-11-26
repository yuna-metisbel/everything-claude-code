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
  // ホーム画面から開いたときの下地の色。ボードの色（白地）に合わせる。
  themeColor: "#FFFFFF",

  // LINE はチャネルを作ってから入れる。空のあいだはメールとパスワードだけで入れる。
  lineLogin: "",
  lineOaId: "",
  lineLoginOptional: true,

  // ログイン画面に「パスワードを忘れた」を出す。決め直すリンクをメールで送るので、
  // Supabase 側の Site URL と Redirect URLs をこのボードの URL にしてある。
  passwordReset: true,

  // ホームに「メモ」の欄を出す（全員で使う覚え書き。通知なし）。
  // notices の kind に 'memo' を足す migration を流したボードだけ。
  memos: true,

  // 「書類」のタブを出す（書類を読んでサインする）。
  // addons/line/05_doc_sign.sql を流したボードだけ。
  docs: true,

  editableBrand: true,
  reminders: true,
  contracts: true,
  taskProgress: true,

  // 関わっている会社のボードへの入り口。ホームの右側に出る。
  // 増やすときはここに1行足すだけ（相手のボードは何も変えない）。
  clientsTitle: "関わっている会社のボード",
  // enter を入れた行は、押すだけで入れる（相手のボードに partner-enter の窓口がある行だけ）。
  // enterKey は相手のボードの公開キー（config.js に載せているものと同じ）。
  // enter を入れていない行は今までどおり URL を開くだけ。
  clients: [
    {
      name: "しろspa（ナディア滋賀店）",
      url: "https://shirospa-board.onrender.com",
      note: "",
      enter: "https://qnmkzhjkgaaeqqnplubd.supabase.co/functions/v1/partner-enter",
      enterKey: "sb_publishable_FrUgK__HEStLMlJ8M3jv9Q_BBKeKkmU"
    }
  ]
};
