"use client"

import { getApps, getApp } from "firebase/app"
import { getMessaging, getToken, isSupported } from "firebase/messaging"
import { request } from "@/lib/api"

export type PushEnableResult =
  | { ok: true; token: string }
  | { ok: false; reason: "unsupported" | "permission" | "vapid" | "network" }

/**
 * Active les notifications push : permission navigateur + token FCM
 * enregistre sur le backend. Requiert la clé VAPID
 * (NEXT_PUBLIC_FIREBASE_VAPID_KEY) et le service worker /firebase-messaging-sw.js.
 */
export async function enablePushNotifications(): Promise<PushEnableResult> {
  try {
    if (typeof window === "undefined" || !(await isSupported()) || !("serviceWorker" in navigator)) {
      return { ok: false, reason: "unsupported" }
    }
    const permission = await Notification.requestPermission()
    if (permission !== "granted") {
      return { ok: false, reason: "permission" }
    }
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
    if (!vapidKey) {
      return { ok: false, reason: "vapid" }
    }
    const app = getApps().length > 0 ? getApp() : getApps()[0]
    const messaging = getMessaging(app)
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js")
    await navigator.serviceWorker.ready
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    })
    if (!token) {
      return { ok: false, reason: "network" }
    }
    await request("/api/push/tokens", { method: "POST", body: JSON.stringify({ token, platform: "web" }) }, (v) => v)
    return { ok: true, token }
  } catch {
    return { ok: false, reason: "network" }
  }
}

export async function disablePushNotifications(token: string): Promise<void> {
  try {
    await request("/api/push/tokens", { method: "DELETE", body: JSON.stringify({ token }) }, (v) => v)
  } catch {}
}
