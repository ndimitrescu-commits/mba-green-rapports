"use client";

/**
 * Onglet Prévisionnel — aperçu lecture-seule de la matrice références × mois
 * (cartons), table Supabase `forecasts`. Décision Nicolas (09/09/2026) :
 * l'équipe saisit dans le Google Sheet Prévisionnel, puis importe ici via
 * "Importer depuis Google Sheets" — plus de saisie manuelle cellule par
 * cellule dans l'outil (source d'erreurs de double-saisie). Cette page reste
 * la vérification visuelle de ce que les rapports utilisent réellement.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import clientsConfig from "@/lib/clients.json";

type ClientsConfig = Record<string, { display_name: string }>;
const CLIENTS = clientsConfig as ClientsConfig;

interface DbRow {
  id: string;
  client_key: string;
  reference: string;
  month: string;
  quantity_cartons: number;
  updated_at?: string;
}

const keyOf = (ref: string, month: string) => `${ref}|${month}`;

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  border: "1px solid #DAD4C2",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: "#1B1B16",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export default function PrevisionPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [clientKey, setClientKey] = useState("POKAWA");
  const [cells, setCells] = useState<Map<string, number>>(new Map());
  const [refs, setRefs] = useState<string[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async (pw: string, ck: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prevision?client=${encodeURIComponent(ck)}`, {
        headers: { "x-admin-password": pw },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur de chargement.");
      const rows = (data.rows ?? []) as DbRow[];
      const map = new Map<string, number>();
      for (const r of rows) map.set(keyOf(r.reference, r.month), Number(r.quantity_cartons));
      setCells(map);
      setRefs([...new Set(rows.map((r) => r.reference))].sort());
      setMonths([...new Set(rows.map((r) => r.month))].sort());
      setAuthed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) void load(password, clientKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey]);

  async function importFromSheets() {
    if (
      !window.confirm(
        "Importer le Prévisionnel depuis Google Sheets ?\n\nToutes les enseignes sont importées ; en cas de doublon (client + référence + mois), la valeur du Sheet écrase celle déjà enregistrée."
      )
    )
      return;
    setImporting(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/prevision/import", {
        method: "POST",
        headers: { "x-admin-password": password },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur d'import.");
      const summary = Object.entries(data.results as Record<string, number | string>)
        .map(([k, v]) => `${k} : ${typeof v === "number" ? `${v} lignes` : v}`)
        .join(" · ");
      setInfo(`Import terminé — ${summary}`);
      await load(password, clientKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const totals = useMemo(() => {
    const t = new Map<string, number>();
    for (const m of months) {
      let s = 0;
      for (const r of refs) s += cells.get(keyOf(r, m)) ?? 0;
      t.set(m, Math.round(s));
    }
    return t;
  }, [cells, refs, months]);

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "#F5F1E8",
        margin: 0,
        padding: 40,
        color: "#1F3D2B",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 14,
          padding: 40,
          border: "1px solid #DAD4C2",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 30, marginTop: 0 }}>
            Prévisionnel clients — aperçu
          </h1>
          <a href="/" style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6A5F", textDecoration: "none" }}>
            ← Génération
          </a>
        </div>
        <p style={{ fontSize: 13, color: "#6B6A5F", marginTop: 0, maxWidth: 760 }}>
          Lecture seule — prévisions mensuelles en <b>cartons</b>, telles qu'utilisées par les
          rapports. La saisie se fait dans le Google Sheet Prévisionnel ; « Importer depuis Google
          Sheets » recopie ensuite son contenu ici.
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
            <button type="submit" disabled={loading || !password} style={{ ...btnPrimary, padding: "10px 22px", fontSize: 14 }}>
              {loading ? "…" : "Entrer"}
            </button>
          </form>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Client</label>
              <select
                value={clientKey}
                onChange={(e) => setClientKey(e.target.value)}
                style={{ ...inputStyle, width: 220, fontSize: 14 }}
              >
                {Object.entries(CLIENTS).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.display_name}
                  </option>
                ))}
              </select>
              {loading && <span style={{ fontSize: 13, color: "#6B6A5F" }}>Chargement…</span>}
              <span style={{ flex: 1 }} />
              <button
                onClick={() => void importFromSheets()}
                disabled={importing}
                style={btnPrimary}
                title="Récupère l'existant du classeur Google (toutes enseignes)"
              >
                {importing ? "Import en cours…" : "Importer depuis Google Sheets"}
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#6B6A5F", borderBottom: "2px solid #1B1B16" }}>
                    <th
                      style={{
                        padding: "8px 8px",
                        position: "sticky",
                        left: 0,
                        background: "#fff",
                        minWidth: 180,
                      }}
                    >
                      Référence
                    </th>
                    {months.map((m) => (
                      <th key={m} style={{ padding: "8px 6px", minWidth: 84, textAlign: "center" }}>
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {refs.map((r) => (
                    <tr key={r} style={{ borderTop: "1px solid #F5F1E8" }}>
                      <td
                        style={{
                          padding: "6px 8px",
                          fontWeight: 700,
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          position: "sticky",
                          left: 0,
                          background: "#fff",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r}
                      </td>
                      {months.map((m) => {
                        const v = cells.get(keyOf(r, m));
                        return (
                          <td key={`${r}|${m}`} style={{ padding: "6px 6px", textAlign: "center" }}>
                            {v !== undefined ? v.toLocaleString("fr-FR") : <span style={{ color: "#CFC9B8" }}>—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid #DAD4C2", fontWeight: 700, background: "#FBF8F0" }}>
                    <td style={{ padding: "6px 8px", position: "sticky", left: 0, background: "#FBF8F0" }}>Total</td>
                    {months.map((m) => (
                      <td key={m} style={{ padding: "6px 6px", textAlign: "center" }}>
                        {(totals.get(m) ?? 0).toLocaleString("fr-FR")}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {refs.length === 0 && !loading && (
              <div style={{ padding: 16, color: "#6B6A5F", fontSize: 13 }}>
                Aucune prévision pour ce client — lance l'import depuis Google Sheets.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
