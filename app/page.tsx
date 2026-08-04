"use client";

import { useState, FormEvent } from "react";
import clientsConfig from "@/lib/clients.json";

type ClientsConfig = Record<string, { display_name: string }>;
const CLIENTS = clientsConfig as ClientsConfig;

const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export default function HomePage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const monthName = String(formData.get("month_name") ?? "");
    const monthYear = String(formData.get("month_year") ?? "");
    formData.set("month_label", `${monthName} ${monthYear}`);
    formData.delete("month_name");
    formData.delete("month_year");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let message = "Erreur pendant la génération.";
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // response wasn't JSON, keep default message
        }
        setError(message);
        setSubmitting(false);
        return;
      }

      const blob = await res.blob();
      let filename = "rapport.pdf";
      const disposition = res.headers.get("Content-Disposition");
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "#EEF0FA",
        margin: 0,
        padding: 40,
        color: "#1B1F5E",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 18,
          padding: 40,
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ fontSize: 28, marginTop: 0 }}>Rapport mensuel client</h1>
          <span style={{ display: "flex", gap: 16 }}>
            <a href="/preview" style={{ color: "#1B1F5E", fontSize: 14, fontWeight: 700 }}>
              Aperçu &amp; édition →
            </a>
            <a href="/prevision" style={{ color: "#1B1F5E", fontSize: 14 }}>
              Prévisionnel →
            </a>
          </span>
        </div>

        {error && (
          <div
            style={{
              background: "#FBE9A5",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Client</label>
          <select name="client" required style={inputStyle} defaultValue="">
            <option value="" disabled>
              Choisir un client
            </option>
            {Object.entries(CLIENTS).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.display_name}
              </option>
            ))}
          </select>

          <label style={labelStyle}>Mois du rapport</label>
          <div style={{ display: "flex", gap: 16 }}>
            <select name="month_name" required style={{ ...inputStyle, flex: 2 }} defaultValue="">
              <option value="" disabled>
                Mois
              </option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              name="month_year"
              required
              style={{ ...inputStyle, flex: 1 }}
              defaultValue={currentYear}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div style={hintStyle}>
            Prévisions, consommation, stock/transit, données financières et logistique GEODIS/GLS (Supabase) sont récupérés automatiquement — plus aucun fichier à importer.
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 28,
              background: "#1B1F5E",
              color: "#fff",
              border: "none",
              padding: "14px 24px",
              borderRadius: 10,
              fontSize: 16,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              width: "100%",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Génération en cours..." : "Générer le rapport PDF"}
          </button>
        </form>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 700,
  margin: "18px 0 6px",
  fontSize: 14,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #ccc",
  fontSize: 14,
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#555",
  marginTop: 2,
};
