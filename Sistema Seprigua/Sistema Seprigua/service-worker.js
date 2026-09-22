"use strict";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { title:"SEPRIGUA", body:event.data ? event.data.text() : "Tienes un nuevo aviso." };
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:"window", includeUncontrolled:true });
    const visible = windows.some(client => client.visibilityState === "visible");
    // Si el usuario está usando el portal, actualizamos el centro de avisos y evitamos
    // duplicar el mismo evento como notificación del sistema operativo.
    if (visible && !data.force) {
      windows.forEach(client => client.postMessage({ type:"SEPRIGUA_PUSH", payload:data }));
      return;
    }
    await self.registration.showNotification(data.title || "SEPRIGUA", {
      body: data.body || "Tienes un nuevo aviso.",
      icon: data.icon || "/assets/pwa/seprigua-192.png",
      badge: data.badge || "/assets/pwa/seprigua-192.png",
      tag: data.tag || "seprigua-aviso",
      renotify: false,
      requireInteraction: false,
      timestamp: data.timestamp || Date.now(),
      data: { url:data.url || "/login" }
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "/login";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:"window", includeUncontrolled:true });
    for (const client of windows) {
      if ("focus" in client) {
        try { await client.navigate(target); } catch (_) {}
        return client.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
  })());
});
