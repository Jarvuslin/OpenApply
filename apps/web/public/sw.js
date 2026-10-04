// Plain service worker (served from /sw.js, not bundled). Renders Pilot web-push
// notifications and routes clicks. Payload is JSON { title, body, url?, tag? }.

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  const title = payload.title || "OpenApply";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      // PNGs, not the manifest SVG: Android/Chrome don't render SVG notification icons.
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: payload.tag,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/pilot";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.includes(target) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
