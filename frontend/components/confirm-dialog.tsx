export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  tone?: "primary" | "danger"
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.5)" }} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(420px,92vw)", background: "var(--panel)", border: "1px solid var(--border)", padding: 20, borderRadius: 10 }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <p style={{ color: "var(--muted)", margin: "8px 0 18px", lineHeight: 1.5 }}>{description}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ border: "1px solid var(--border)", background: "transparent", padding: "8px 12px", borderRadius: 6 }}>
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className={tone === "danger" ? "danger" : "primary"}
            style={{
              border: tone === "danger" ? "1px solid rgb(240 109 114 / .35)" : "1px solid var(--cyan)",
              background: tone === "danger" ? "transparent" : "var(--cyan)",
              color: tone === "danger" ? "var(--coral)" : "#071015",
              padding: "8px 12px",
              borderRadius: 6,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
