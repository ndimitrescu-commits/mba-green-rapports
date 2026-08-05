"use client";

/**
 * Onglet Prévisionnel — matrice références (lignes) × mois (colonnes), en
 * cartons. Source de référence des rapports : table Supabase `forecasts`.
 * Une cellule se sauvegarde à la sortie du champ (vider une cellule supprime
 * la prévision). Le bouton d'import Google Sheets reste disponible pour un
 * rattrapage. Même mot de passe admin que l'onglet RFAs.
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

interface Cell {
  id?: string;
  qty: number | null;
}

const keyOf = (ref: string, month: string) => `${ref}|${month}`;

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  border: "1px solid #d6d9ea",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: "#1B1F5E",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid #1B1F5E",
  background: "#fff",
  color: "#1B1F5E",
  fontSize: 13,
  cursor: "pointer",
};

export default function PrevisionPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [clientKey, setClientKey] = useState("POKAWA");
  const [cells, setCells] = useState<Map<string, Cell>>(new Map());
  const [refs, setRefs] = useState<string[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [newRef, setNewRef] = useState("");
  const [newMonth, setNewMonth] = useState("");

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
      const map = new Map<string, Cell>();
      for (const r of rows) {
        map.set(keyOf(r.reference, r.month), { id: r.id, qty: Number(r.quantity_cartons) });
      }
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

  /** Sauvegarde d'une cellule : valeur → upsert ; vide → suppression. */
  async function saveCell(reference: string, month: string, raw: string): Promise<void> {
    const k = keyOf(reference, month);
    const cur = cells.get(k);
    const trimmed = raw.trim();
    setError(null);
    try {
      if (trimmed === "") {
        if (!cur?.id) return; // rien à supprimer
        const res = await fetch(`/api/prevision?id=${encodeURIComponent(cur.id)}`, {
          method: "DELETE",
          headers: { "x-admin-password": password },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Erreur de suppression.");
        setCells((prev) => {
          const next = new Map(prev);
          next.delete(k);
          return next;
        });
        return;
      }
      const qty = Number(trimmed.replace(",", "."));
      if (!Number.isFinite(qty) || qty < 0) throw new Error(`Valeur invalide pour ${reference} (${month}).`);
      if (cur && cur.qty === qty) return;
      const res = await fetch("/api/prevision", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ client: clientKey, reference, month, quantity_cartons: qty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur d'enregistrement.");
      const saved = data.row as DbRow;
      setCells((prev) => {
        const next = new Map(prev);
        next.set(k, { id: saved.id, qty: Number(saved.quantity_cartons) });
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeReference(reference: string) {
    const ids = months
      .map((m) => cells.get(keyOf(reference, m))?.id)
      .filter((id): id is string => Boolean(id));
    if (!window.confirm(`Supprimer « ${reference} » (${ids.length} mois renseignés) ?`)) return;
    setError(null);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/prevision?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "x-admin-password": password },
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data?.error ?? "Erreur de suppression.");
        }
      }
      setRefs((prev) => prev.filter((r) => r !== reference));
      setCells((prev) => {
        const next = new Map(prev);
        for (const m of months) next.delete(keyOf(reference, m));
        return next;
      });
      setInfo(`« ${reference} » supprimé.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function addReference() {
    const r = newRef.trim().toUpperCase();
    if (!r) return;
    if (!refs.includes(r)) setRefs((prev) => [...prev, r].sort());
    setNewRef("");
  }

  function addMonth() {
    const m = newMonth.trim();
    if (!/^\d{4}-\d{2}$/.test(m)) {
      setError(`Mois invalide « ${m} » — format attendu : YYYY-MM (ex. 2026-09).`);
      return;
    }
    if (!months.includes(m)) setMonths((prev) => [...prev, m].sort());
    setNewMonth("");
    setError(null);
  }

  async function importFromSheets() {
    if (
      !window.confirm(
        "Importer le Prévisionnel depuis Google Sheets ?\n\nToutes les enseignes sont importées ; en cas de doublon (client + référence + mois), la valeur du Sheet écrase celle saisie ici."
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
      for (const r of refs) s += cells.get(keyOf(r, m))?.qty ?? 0;
      t.set(m, Math.round(s));
    }
    return t;
  }, [cells, refs, months]);

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
          maxWidth: 1240,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 18,
          padding: 40,
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ fontSize: 28, marginTop: 0 }}>Prévisionnel clients</h1>
          <a href="/" style={{ color: "#1B1F5E", fontSize: 14 }}>
            ← Génération
          </a>
        </div>
        <p style={{ fontSize: 13, color: "#6b6f8a", marginTop: 0 }}>
          Prévisions mensuelles en <b>cartons</b> — références en ligne, mois en colonne. Une
          cellule s'enregistre quand tu en sors ; <b>vider une cellule supprime la prévision</b>.
          C'est la source utilisée par les rapports.
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
              <input
                value={newMonth}
                onChange={(e) => setNewMonth(e.target.value)}
                placeholder="2026-09"
                style={{ ...inputStyle, width: 100 }}
              />
              <button onClick={addMonth} style={btnSecondary}>
                + Mois
              </button>
              {loading && <span style={{ fontSize: 13, color: "#6b6f8a" }}>Chargement…</span>}
              <span style={{ flex: 1 }} />
              <button
                onClick={() => void importFromSheets()}
                disabled={importing}
                style={btnSecondary}
                title="Récupère l'existant du classeur Google (toutes enseignes)"
              >
                {importing ? "Import en cours…" : "Importer depuis Google Sheets"}
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#6b6f8a" }}>
                    <th
                      style={{
                        padding: "6px 8px",
                        position: "sticky",
                        left: 0,
                        background: "#fff",
                        minWidth: 180,
                      }}
                    >
                      Référence
                    </th>
                    {months.map((m) => (
                      <th key={m} style={{ padding: "6px 6px", minWidth: 84, textAlign: "center" }}>
                        {m}
                      </th>
                    ))}
                    <th style={{ width: 70 }} />
                  </tr>
                </thead>
                <tbody>
                  {refs.map((r) => (
                    <tr key={r} style={{ borderTop: "1px solid #eef0fa" }}>
                      <td
                        style={{
                          padding: "4px 8px",
                          fontWeight: 700,
                          position: "sticky",
                          left: 0,
                          background: "#fff",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r}
                      </td>
                      {months.map((m) => (
                        <MatrixCell
                          key={`${r}|${m}`}
                          value={cells.get(keyOf(r, m))?.qty ?? null}
                          onCommit={(raw) => void saveCell(r, m, raw)}
                        />
                      ))}
                      <td style={{ padding: "4px 6px" }}>
                        <button
                          onClick={() => void removeReference(r)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 6,
                            border: "1px solid #e0b4b4",
                            background: "#fff",
                            color: "#a33",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          Suppr.
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid #eef0fa", background: "#fafbff" }}>
                    <td style={{ padding: "6px 8px", position: "sticky", left: 0, background: "#fafbff" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={newRef}
                          onChange={(e) => setNewRef(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addReference()}
                          placeholder="Nouvelle référence"
                          style={{ ...inputStyle, fontWeight: 700 }}
                        />
                        <button onClick={addReference} disabled={!newRef.trim()} style={{ ...btnPrimary, padding: "6px 10px", fontSize: 12 }}>
                          +
                        </button>
                      </div>
                    </td>
                    <td colSpan={months.length + 1} style={{ padding: "6px 8px", color: "#6b6f8a", fontSize: 12 }}>
                      Ajoute la référence puis saisis ses cartons dans les colonnes.
                    </td>
                  </tr>
                  <tr style={{ borderTop: "2px solid #d6d9ea", fontWeight: 700 }}>
                    <td style={{ padding: "6px 8px", position: "sticky", left: 0, background: "#fff" }}>Total</td>
                    {months.map((m) => (
                      <td key={m} style={{ padding: "6px 6px", textAlign: "center" }}>
                        {(totals.get(m) ?? 0).toLocaleString("fr-FR")}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {refs.length === 0 && !loading && (
              <div style={{ padding: 16, color: "#6b6f8a", fontSize: 13 }}>
                Aucune prévision pour ce client — ajoute une référence ou lance l'import Google Sheets.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Cellule éditable : commit à la sortie du champ ou sur Entrée. */
function MatrixCell({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit: (raw: string) => void;
}) {
  const [v, setV] = useState(value === null ? "" : String(value));
  useEffect(() => setV(value === null ? "" : String(value)), [value]);
  const dirty = v !== (value === null ? "" : String(value));
  return (
    <td style={{ padding: "2px 3px" }}>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => dirty && onCommit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        inputMode="numeric"
        style={{
          ...inputStyle,
          textAlign: "center",
          padding: "5px 4px",
          background: dirty ? "#FFF7E0" : value === null ? "#fafbfd" : "#fff",
        }}
      />
    </td>
  );
}
