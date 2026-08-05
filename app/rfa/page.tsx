"use client";

/**
 * Onglet RFAs — référentiel des commissions de référencement par client,
 * branché en direct sur la table Supabase `rfa_rates` (via /api/rfa).
 * Ajouter / modifier / supprimer une ligne ; deux modèles cohabitent :
 * € par colis (Krousty, Lüks) et % du CA HT facturé (B&W, Pokawa).
 * Accès protégé par mot de passe (env Vercel RFA_ADMIN_PASSWORD).
 */
import { useCallback, useEffect, useState } from "react";
import clientsConfig from "@/lib/clients.json";

type ClientsConfig = Record<string, { display_name: string }>;
const CLIENTS = clientsConfig as ClientsConfig;

interface RfaRow {
  id?: string;
  client_key: string;
  reference: string;
  prix_centrale: number | string | null;
  prix_restaurant: number | string | null;
  rfa_par_colis: number | string | null;
  commission_pct: number | string | null;
  updated_at?: string;
  _dirty?: boolean;
  _saving?: boolean;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  border: "1px solid #d6d9ea",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
};

export default function RfaPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [clientKey, setClientKey] = useState("KROUSTY");
  const [rows, setRows] = useState<RfaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(
    async (pw: string, ck: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/rfa?client=${encodeURIComponent(ck)}`, {
          headers: { "x-rfa-password": pw },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Erreur de chargement.");
        setRows((data.rates as RfaRow[]).map((r) => ({ ...r })));
        setAuthed(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        if (!authed) setAuthed(false);
      } finally {
        setLoading(false);
      }
    },
    [authed]
  );

  useEffect(() => {
    if (authed) void load(password, clientKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey]);

  function edit(idx: number, field: keyof RfaRow, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value, _dirty: true } : r))
    );
  }

  async function saveRow(idx: number) {
    const row = rows[idx];
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, _saving: true } : r)));
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/rfa", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-rfa-password": password },
        body: JSON.stringify({ ...row, client_key: clientKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur d'enregistrement.");
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...(data.rate as RfaRow), _dirty: false } : r))
      );
      setInfo(`« ${row.reference} » enregistré.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, _saving: false } : r)));
    }
  }

  async function removeRow(idx: number) {
    const row = rows[idx];
    if (!row.id) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    if (!window.confirm(`Supprimer la référence « ${row.reference} » ?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/rfa?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { "x-rfa-password": password },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur de suppression.");
      setRows((prev) => prev.filter((_, i) => i !== idx));
      setInfo(`« ${row.reference} » supprimé.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        client_key: clientKey,
        reference: "",
        prix_centrale: null,
        prix_restaurant: null,
        rfa_par_colis: null,
        commission_pct: null,
        _dirty: true,
      },
    ]);
  }

  const fmt = (v: RfaRow["prix_centrale"]) =>
    v === null || v === undefined ? "" : String(v);

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
          maxWidth: 1080,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 18,
          padding: 40,
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ fontSize: 28, marginTop: 0 }}>RFAs — commissions de référencement</h1>
          <a href="/" style={{ color: "#1B1F5E", fontSize: 14 }}>
            ← Génération
          </a>
        </div>
        <p style={{ fontSize: 13, color: "#6b6f8a", marginTop: 0 }}>
          Taux utilisés par le calcul « Commission à payer - référencement » des rapports
          (base : facturé du mois). <b>€ / colis</b> prime sur <b>% du CA</b> si les deux sont
          renseignés. Les % sont des fractions : 0,1 = 10 %.
        </p>

        {error && (
          <div style={{ background: "#FBE3A3", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        )}
        {info && (
          <div style={{ background: "#DFF3E3", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13 }}>
            {info}
          </div>
        )}

        {!authed ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(password, clientKey);
            }}
            style={{ display: "flex", gap: 12, alignItems: "center", maxWidth: 420 }}
          >
            <input
              type="password"
              placeholder="Mot de passe admin"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...inputStyle, fontSize: 14, padding: "10px 12px" }}
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !password}
              style={{
                padding: "10px 22px",
                borderRadius: 8,
                border: "none",
                background: "#1B1F5E",
                color: "#fff",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {loading ? "…" : "Entrer"}
            </button>
          </form>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Client</label>
              <select
                value={clientKey}
                onChange={(e) => setClientKey(e.target.value)}
                style={{ ...inputStyle, width: 260, fontSize: 14 }}
              >
                {Object.entries(CLIENTS).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.display_name}
                  </option>
                ))}
              </select>
              {loading && <span style={{ fontSize: 13, color: "#6b6f8a" }}>Chargement…</span>}
              <span style={{ flex: 1 }} />
              <button
                onClick={addRow}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #1B1F5E",
                  background: "#fff",
                  color: "#1B1F5E",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                + Ajouter une référence
              </button>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#6b6f8a" }}>
                  <th style={{ padding: "6px 8px" }}>Référence</th>
                  <th style={{ padding: "6px 8px", width: 120 }}>Prix centrale €</th>
                  <th style={{ padding: "6px 8px", width: 120 }}>Prix restaurant €</th>
                  <th style={{ padding: "6px 8px", width: 110 }}>RFA € / colis</th>
                  <th style={{ padding: "6px 8px", width: 110 }}>% commission</th>
                  <th style={{ padding: "6px 8px", width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? `new-${i}`} style={{ borderTop: "1px solid #eef0fa" }}>
                    <td style={{ padding: "4px 8px" }}>
                      <input
                        value={r.reference}
                        onChange={(e) => edit(i, "reference", e.target.value)}
                        style={{ ...inputStyle, fontWeight: 700 }}
                        placeholder="REFERENCE"
                      />
                    </td>
                    {(["prix_centrale", "prix_restaurant", "rfa_par_colis", "commission_pct"] as const).map(
                      (f) => (
                        <td key={f} style={{ padding: "4px 8px" }}>
                          <input
                            value={fmt(r[f])}
                            onChange={(e) => edit(i, f, e.target.value)}
                            style={inputStyle}
                            inputMode="decimal"
                            placeholder="—"
                          />
                        </td>
                      )
                    )}
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => void saveRow(i)}
                        disabled={!r._dirty || r._saving || !r.reference.trim()}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "none",
                          background: r._dirty ? "#1B1F5E" : "#d6d9ea",
                          color: "#fff",
                          fontSize: 12,
                          cursor: r._dirty ? "pointer" : "default",
                          marginRight: 6,
                        }}
                      >
                        {r._saving ? "…" : "Enregistrer"}
                      </button>
                      <button
                        onClick={() => void removeRow(i)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid #e0b4b4",
                          background: "#fff",
                          color: "#a33",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Suppr.
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} style={{ padding: 16, color: "#6b6f8a" }}>
                      Aucune référence pour ce client — « + Ajouter une référence » pour commencer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
