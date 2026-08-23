"use client"

import { getApp, getApps, initializeApp } from "firebase/app"
import type { FirebaseError } from "firebase/app"
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth"
import type { User } from "@/lib/types"

export type AuthFailure = "EMAIL_EXISTS" | "WEAK_PASSWORD" | "INVALID_CREDENTIALS" | "GOOGLE_UNAVAILABLE"

export class AuthError extends Error {
  constructor(public code: AuthFailure) {
    super(code)
  }
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
const auth = getAuth(app)

interface AuthLikeUser {
  uid: string
  email: string | null
  displayName: string | null
  metadata: { creationTime?: string | null }
}

function toUser(user: AuthLikeUser): User {
  const email = user.email ?? ""
  return {
    id: user.uid,
    email,
    displayName: user.displayName ?? email.split("@")[0],
    createdAt: user.metadata.creationTime ?? new Date().toISOString(),
  }
}

function mapFirebaseError(error: FirebaseError): AuthFailure {
  if (error.code === "auth/email-already-in-use") return "EMAIL_EXISTS"
  if (error.code === "auth/weak-password") return "WEAK_PASSWORD"
  return "INVALID_CREDENTIALS"
}

export async function signIn(email: string, password: string): Promise<User> {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    return toUser(credential.user)
  } catch (error) {
    throw new AuthError(mapFirebaseError(error as FirebaseError))
  }
}

export async function signUp(email: string, password: string, name: string): Promise<User> {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(credential.user, { displayName: name })
    return { id: credential.user.uid, email, displayName: name, createdAt: new Date().toISOString() }
  } catch (error) {
    throw new AuthError(mapFirebaseError(error as FirebaseError))
  }
}

export async function signInWithGoogle(): Promise<User> {
  try {
    const provider = new GoogleAuthProvider()
    const credential = await signInWithPopup(auth, provider)
    return toUser(credential.user)
  } catch {
    throw new AuthError("GOOGLE_UNAVAILABLE")
  }
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth)
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => callback(user ? toUser(user) : null))
}

export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser
  return user ? await user.getIdToken() : null
}

export function currentUser(): User | null {
  const user = auth.currentUser
  return user ? toUser(user) : null
}

export const authMessage = (code: AuthFailure) =>
  (
    {
      EMAIL_EXISTS: "Cette adresse e-mail est déjà utilisée.",
      WEAK_PASSWORD: "Utilisez au moins 8 caractères avec un chiffre.",
      INVALID_CREDENTIALS: "Adresse e-mail ou mot de passe incorrect.",
      GOOGLE_UNAVAILABLE: "Connexion Google indisponible. Réessayez.",
    }
  )[code]
