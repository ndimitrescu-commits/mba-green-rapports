"use client";

/**
 * Porte d'entrée unique de l'outil (voir middleware.ts) — décision Nicolas
 * (09/09/2026). Un seul mot de passe, une seule fois : le cookie posé par
 * /api/login couvre ensuite toutes les pages (Générer, Aperçu & édition,
 * Prévisionnel, RFAs), plus de repli par onglet.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { theme, microLabel, pageShell, card, input, buttonPrimary } from "@/lib/theme";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Mot de passe incorrect.");
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ ...pageShell, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={onSubmit} style={{ ...card, padding: 40, width: 340, boxSizing: "border-box" }}>
        <div style={microLabel}>MBA GREEN — RAPPORTS</div>
        <h1 style={{ fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 26, margin: "6px 0 20px" }}>
          Connexion
        </h1>
        {error && (
          <div style={{ background: "#FBE3A3", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...input, marginBottom: 16 }}
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !password}
          style={{ ...buttonPrimary(loading || !password), width: "100%" }}
        >
          {loading ? "…" : "Entrer"}
        </button>
      </form>
    </div>
  );
}
