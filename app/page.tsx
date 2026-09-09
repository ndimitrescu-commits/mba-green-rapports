"use client";

import { useState, FormEvent } from "react";
import clientsConfig from "@/lib/clients.json";
import { theme, microLabel, pageShell, card, input, buttonPrimary, dot } from "@/lib/theme";
import AppHeader from "@/app/components/AppHeader";

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

interface MultiClientGap {
  ref: string;
  otherClients: string[];
}

export default function HomePage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [withCommissions, setWithCommissions] = useState(true);
  const [adminPassword, setAdminPassword] = useState("");
  const [lastClientLabel, setLastClientLabel] = useState<string | null>(null);
  const [gaps, setGaps] = useState<MultiClientGap[] | null>(null);

  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setGaps(null);
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

      // Fichier de commissions (xlsx) généré dans la foulée, sur les mêmes
      // données (base facturée + taux RFAs) — cohérence garantie avec le PDF.
      if (withCommissions) {
        const clientKey = String(formData.get("client") ?? "");
        const monthLabel = String(formData.get("month_label") ?? "");
        setLastClientLabel(CLIENTS[clientKey]?.display_name ?? clientKey);
        const resX = await fetch(
          `/api/commissions?client=${encodeURIComponent(clientKey)}&month_label=${encodeURIComponent(monthLabel)}`,
          { headers: { "x-admin-password": adminPassword } }
        );
        if (!resX.ok) {
          let msg = "Le rapport PDF est généré, mais le fichier commissions a échoué.";
          try {
            const dataX = await resX.json();
            if (dataX?.error) msg += ` ${dataX.error}`;
          } catch {}
          setError(msg);
        } else {
          // Alerte multi-client (Price Levels) transmise via un en-tête dédié
          // — encart affiché dans l'outil uniquement, jamais dans le PDF/xlsx
          // client (décision Nicolas, 09/09/2026).
          try {
            const raw = resX.headers.get("X-Commission-Warnings");
            if (raw) {
              // atob() décode en "binary string" (1 char = 1 octet) : il faut
              // repasser par un TextDecoder UTF-8 pour les accents (Lüks…).
              const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
              setGaps(JSON.parse(new TextDecoder("utf-8").decode(bytes)));
            }
          } catch {
            // affichage non-bloquant : une alerte manquée ne doit jamais gêner le téléchargement
          }

          const blobX = await resX.blob();
          let fnX = `Commissions ${monthLabel}.xlsx`;
          const dispoX = resX.headers.get("Content-Disposition");
          if (dispoX) {
            const mX = dispoX.match(/filename="?([^"]+)"?/);
            if (mX) fnX = mX[1];
          }
          const urlX = window.URL.createObjectURL(blobX);
          const aX = document.createElement("a");
          aX.href = urlX;
          aX.download = fnX;
          document.body.appendChild(aX);
          aX.click();
          aX.remove();
          window.URL.revokeObjectURL(urlX);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={pageShell}>
      <AppHeader active="/" />

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 40px 64px" }}>
        <div style={microLabel}>OUTIL DE GÉNÉRATION</div>
        <h1 style={{ fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 44, margin: "6px 0 8px" }}>
          Rapport mensuel client
        </h1>
        <p style={{ color: theme.inkMuted, fontSize: 15, margin: "0 0 32px", maxWidth: 560 }}>
          Interroge NetSuite, Supabase et Google Sheets en direct — prévisions, consommation,
          stock/transit, financier et logistique GEODIS/GLS récupérés automatiquement.
        </p>

        <div style={{ ...card, padding: 32, maxWidth: 640 }}>
          {error && (
            <div
              style={{
                background: "#FBE3A3",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 20,
                fontSize: 14,
                color: "#5A4A12",
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <label style={{ ...microLabel, display: "block", marginBottom: 6 }}>Client (marque)</label>
            <select name="client" required style={{ ...input, marginBottom: 18 }} defaultValue="">
              <option value="" disabled>
                Choisir un client
              </option>
              {Object.entries(CLIENTS).map(([key, cfg]) => (
                <option key={key} value={key}>
                  {cfg.display_name}
                </option>
              ))}
            </select>

            <label style={{ ...microLabel, display: "block", marginBottom: 6 }}>Mois du rapport</label>
            <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
              <select name="month_name" required style={{ ...input, flex: 2 }} defaultValue="">
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
                style={{ ...input, flex: 1 }}
                defaultValue={currentYear}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <label
              style={{
                ...microLabel,
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                marginBottom: withCommissions ? 12 : 0,
                textTransform: "none",
                letterSpacing: 0,
                fontFamily: theme.fontSans,
                fontSize: 14,
                color: theme.ink,
              }}
            >
              <input
                type="checkbox"
                checked={withCommissions}
                onChange={(e) => setWithCommissions(e.target.checked)}
              />
              Générer aussi le fichier commissions (xlsx)
            </label>
            {withCommissions && (
              <>
                <input
                  type="password"
                  placeholder="Mot de passe admin (onglets RFAs / Prévisionnel)"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  style={{ ...input, marginBottom: 8 }}
                  required
                />
                <div style={{ fontSize: 12, color: theme.inkMuted, marginBottom: 4 }}>
                  Détail des factures du mois + commissions par référence (taux RFAs) — mêmes
                  chiffres que le rapport, base « facturé uniquement ».
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{ ...buttonPrimary(submitting), marginTop: 24, width: "100%" }}
            >
              {submitting ? "Génération en cours…" : "Générer le rapport PDF"}
            </button>
          </form>
        </div>

        {gaps && (
          <div style={{ ...card, padding: 24, maxWidth: 640, marginTop: 20 }}>
            {gaps.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", fontSize: 14 }}>
                <span style={dot(theme.good)} />
                Aucune référence à risque détectée{lastClientLabel ? ` pour ${lastClientLabel}` : ""} ce mois-ci.
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                  <span style={dot(theme.bad)} />
                  {gaps.length} référence{gaps.length > 1 ? "s" : ""} à vérifier
                  {lastClientLabel ? ` pour ${lastClientLabel}` : ""}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {gaps.map((g) => (
                    <div
                      key={g.ref}
                      style={{
                        fontSize: 13,
                        padding: "8px 12px",
                        background: "#FBF3EC",
                        border: `1px solid #EBD9C6`,
                        borderRadius: 8,
                      }}
                    >
                      <span style={{ fontFamily: theme.fontMono, fontWeight: 600 }}>{g.ref}</span>
                      {" — vendue aussi à "}
                      {g.otherClients.join(", ")}
                      {" — pas d'exception dans NetSuite pour ce client sur cette référence."}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: theme.inkMuted, marginTop: 12 }}>
                  Le taux utilisé aujourd'hui vient du champ général NetSuite — vérifier qu'il
                  correspond bien à ce client, ou créer une ligne dans la table d'exceptions
                  « Commission par client (MBA) ». Détail aussi disponible dans la colonne
                  « Alerte » de l'onglet RFAs du fichier commissions.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
