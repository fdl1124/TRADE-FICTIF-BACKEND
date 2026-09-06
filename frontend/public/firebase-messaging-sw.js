/* Service worker de notifications push LEDGER (Firebase Cloud Messaging) */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js")
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js")

firebase.initializeApp({
  apiKey: "AIzaSyCfd_jwec6WFDPok7RNH1j7Unk49X05GmU",
  authDomain: "trade-fictif.firebaseapp.com",
  projectId: "trade-fictif",
  storageBucket: "trade-fictif.firebasestorage.app",
  messagingSenderId: "655609493654",
  appId: "1:655609493654:web:9392d208a3fa04dbb96ab7",
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "LEDGER"
  const body = (payload.notification && payload.notification.body) || ""
  const link = (payload.fcmOptions && payload.fcmOptions.link) || (payload.data && payload.data.url) || "/"
  self.registration.showNotification(title, {
    body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: payload.data && payload.data.tag ? payload.data.tag : undefined,
    data: { url: link },
  })
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
