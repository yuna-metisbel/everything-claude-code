/* この設置ぶんの接続先。導入する会社ごとに、このファイルだけを差し替える。
   app.js は全社共通のまま触らない。

   ここに置く2つは、どちらもブラウザに配られる前提の公開値。
   publishable（旧 anon）キーはクライアントに載せる設計のもので、
   これだけでは何も読めない——読めるかどうかは全部 RLS が決める。
   service_role の鍵は絶対にここに置かない。 */
window.BOARD_CONFIG = {
  supabaseUrl: "https://ixsycdkazorljshjejcz.supabase.co",
  supabaseKey: "sb_publishable_GwiqO3s7SeG6MkmRa5bI0A_-kX7twCN",
  // 画面の左上とブラウザのタブに出る名前。
  brand: "PRIME",
  brandSub: "事務所ボード"
};
