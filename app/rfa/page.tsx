"use client";

/**
 * Onglet RFAs — aperçu lecture-seule des taux de commission réellement
 * appliqués par client (décision Nicolas, 09/09/2026). Plus d'édition : les
 * taux se gèrent dans NetSuite (champ général sur la fiche article, ou table
 * "Commission par client (MBA)" pour les exceptions par client — voir le
 * tutoriel). Cette page interroge NetSuite en direct pour montrer ce que le
 * calcul utilise vraiment, référence par référence.
 *
 * Références couvertes = la mercuriale du client (déduite du Prévisionnel,
 * remarque Nicolas 09/09/2026), pas seulement le facturé récent — pour
 * repérer les trous même sur des références pas encore commandées.
 */
import { useCallback, useEffect, useState } from "react";
import clientsConfig from "@/lib/clients.json";
import AppHeader from "@/app/components/AppHeader";

type ClientsConfig = Record<string, { display_name: string }>;
const CLIENTS = clientsConfig as ClientsConfig;

interface ClientRateRow {
  ref: string;
  rate: number | null;
  source: "exception" | "netsuite" | "aucun";
}

const SOURCE_LABEL: Record<ClientRateRow["source"], string> = {
  exception: "Exception client",
  netsuite: "Champ général NetSuite",
  aucun: "Aucun taux",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1px solid #DAD4C2",
  borderRadius: 8,
  fontSize: 14,
  fontFamily: "inherit",
};

export default function RfaPage() {
  const [clientKey, setClientKey] = useState("KROUSTY");
  const [rows, setRows] = useState<ClientRateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (ck: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rfa?client=${encodeURIComponent(ck)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur de chargement.");
      setRows(data.rates as ClientRateRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  // Plus de mot de passe par onglet (décision Nicolas, 09/09/2026) : le
  // cookie posé une fois via /login (middleware.ts) couvre déjà cette page.
  useEffect(() => {
    void load(clientKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey]);

  function changeClient(ck: string) {
    setClientKey(ck);
  }

  const withRate = rows.filter((r) => r.rate !== null);
  const withoutRate = rows.filter((r) => r.rate === null);

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "#F5F1E8",
        color: "#1F3D2B",
        minHeight: "100vh",
      }}
    >
      <AppHeader active="/rfa" />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 40px 64px" }}>
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 40,
          border: "1px solid #DAD4C2",
        }}
      >
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 30, marginTop: 0 }}>
          RFAs — taux de commission (aperçu)
        </h1>
        <p style={{ fontSize: 13, color: "#6B6A5F", marginTop: 0, maxWidth: 720 }}>
          Lecture seule — reflète exactement ce qu'utilise le calcul de commission : taux
          d'exception (table « Commission par client (MBA) ») en priorité, sinon champ général
          NetSuite sur la fiche article. Sur l&apos;ensemble de la mercuriale de ce client (les
          références de son Prévisionnel), pas seulement le facturé récent. Un taux à 0 € est
          affiché comme tel — seul un champ vraiment vide compte comme « aucun taux ». Pour
          modifier un taux, passe par NetSuite (voir le tutoriel de l&apos;équipe).
        </p>

        {error && (
          <div style={{ background: "#FBE3A3", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        )}

        {!loaded && loading ? (
          <div style={{ fontSize: 14, color: "#6B6A5F" }}>Chargement…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Client</label>
              <select
                value={clientKey}
                onChange={(e) => changeClient(e.target.value)}
                style={{ ...inputStyle, width: "auto" }}
              >
                {Object.entries(CLIENTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.display_name}
                  </option>
                ))}
              </select>
              {loading && <span style={{ fontSize: 13, color: "#6B6A5F" }}>Chargement…</span>}
            </div>

            {!loading && rows.length === 0 && (
              <div style={{ fontSize: 14, color: "#6B6A5F" }}>
                Aucune référence dans le Prévisionnel de ce client — importe-le d&apos;abord depuis
                l&apos;onglet Prévisionnel pour voir sa mercuriale ici.
              </div>
            )}

            {withoutRate.length > 0 && (
              <div
                style={{
                  background: "#FBE3A3",
                  borderRadius: 8,
                  padding: "12px 16px",
                  marginBottom: 18,
                  fontSize: 13,
                }}
              >
                ⚠️ {withoutRate.length} référence{withoutRate.length > 1 ? "s" : ""} de la mercuriale
                sans aucun taux (ni exception, ni champ général) : {withoutRate.map((r) => r.ref).join(", ")}.
              </div>
            )}

            {withRate.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #1B1B16" }}>
                    <th style={{ padding: "8px 10px" }}>Référence</th>
                    <th style={{ padding: "8px 10px" }}>Taux (€/carton)</th>
                    <th style={{ padding: "8px 10px" }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {withRate.map((r) => (
                    <tr key={r.ref} style={{ borderBottom: "1px solid #EFEAD9" }}>
                      <td style={{ padding: "8px 10px", fontFamily: "var(--font-mono)" }}>{r.ref}</td>
                      <td style={{ padding: "8px 10px" }}>
                        {r.rate?.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {r.source === "exception" ? (
                          <span
                            style={{
                              fontSize: 12,
                              fontFamily: "var(--font-mono)",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              color: "#8A5A1E",
                              background: "#FBF3EC",
                              border: "1px solid #EBD9C6",
                              borderRadius: 6,
                              padding: "2px 8px",
                            }}
                          >
                            {SOURCE_LABEL[r.source]}
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, color: "#6B6A5F" }}>{SOURCE_LABEL[r.source]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
