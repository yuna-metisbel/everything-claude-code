/* PRIME 事務所ボード — 通知の受け口。
   ページを閉じていてもここだけは動くので、通知はこの中で出す。 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", function(event){
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = d.title || "PRIME 事務所ボード";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.text || "",
    // 同じ tag の通知は積み上がらず置き換わる。同じ話で何度も鳴らさないため。
    tag: d.tag || "prime-board",
    data: { url: d.url || "/" },
    icon: "./icon-192.png",
    badge: "./icon-192.png"
  }));
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(function(list){
      // すでに開いているタブがあればそれを使う。増やしても読む場所は1つでよい。
      for (const c of list){ if ("focus" in c) return c.focus(); }
      return self.clients.openWindow(url);
    }));
});
