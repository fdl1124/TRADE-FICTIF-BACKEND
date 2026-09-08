"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"
import { onAuthChange, signInWithGoogle } from "@/lib/auth/client"

export function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      if (user) router.replace("/")
    })
    return () => unsub()
  }, [router])

  async function google() {
    setBusy(true)
    setError("")
    try {
      await signInWithGoogle()
      router.push(mode === "signup" ? "/welcome" : "/")
    } catch {
      setError("Connexion Google indisponible. Vérifiez votre connexion et réessayez.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-principle">
        <Link href="/" className="brand auth-brand">
          <svg width="38" height="38" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="12" fill="#0B0F14" />
            <rect x="5" y="5" width="54" height="54" rx="9" fill="none" stroke="#39C6D4" strokeWidth="3" />
            <path d="M24 16v28h18" fill="none" stroke="#39C6D4" strokeWidth="6" strokeLinecap="square" />
          </svg>
          <span>
            <strong>LEDGER</strong>
            <small>SIMULATED MARKETS</small>
          </span>
        </Link>
        <div>
          <span className="eyebrow">DISCIPLINE FINANCIÈRE</span>
          <h1>
            L&apos;argent est fictif.
            <br />
            Vos décisions ne le sont pas.
          </h1>
          <p>Un environnement de simulation qui traite chaque ordre, chaque perte et chaque limite comme dans un compte réel.</p>
        </div>
        <div className="auth-proof">
          <ShieldCheck />
          <span>
            <strong>10 000 $</strong> de capital initial
          </span>
          <span>Slippage et rejets simulés</span>
          <span>Historique d&apos;audit complet</span>
        </div>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <div>
            <span className="eyebrow">{mode === "login" ? "BON RETOUR" : "OUVRIR UN COMPTE"}</span>
            <h2>{mode === "login" ? "Se connecter" : "Commencer avec 10 000 $ fictifs"}</h2>
            <p>{mode === "login" ? "Retrouvez votre journal et vos limites." : "Un compte Google suffit pour commencer."}</p>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button type="button" className="google full" disabled={busy} onClick={google}>
            <span>G</span> {busy ? "Connexion…" : mode === "login" ? "Continuer avec Google" : "Créer mon compte avec Google"}
          </button>
          <p className="auth-switch">{mode === "login" ? "Pas encore de compte ?" : "Déjà un compte ?"} Le bouton ci-dessus fait les deux.</p>
        </div>
      </section>
    </main>
  )
}
