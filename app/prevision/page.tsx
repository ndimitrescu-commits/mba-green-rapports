"use client";

/**
 * Onglet Prévisionnel — LA source de référence des prévisions mensuelles
 * (cartons) par client : table Supabase `forecasts`, éditée ici et lue par la
 * génération des rapports. Le Google Sheet ne sert plus qu'à l'import initial
 * (bouton dédié). Même mot de passe admin que l'onglet RFAs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import clientsConfig from "@/lib/clients.json";

type ClientsConfig = Record<string, { display_name: string }>;
const CLIENTS = clientsConfig as ClientsConfig;

interface Row {
  id: string;
  client_key: string;
  reference: string;
  month: string;
  quantity_cartons: number;
  updated_at?: string;
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

const btnPrimary: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "none",
  background: "#1B1F5E",
  color: "#fff",
  fontSize: 12,
  cursor: "pointer",
};

export default function PrevisionPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [clientKey, setClientKey] = useState("POKAWA");
  const [rows, setRows] = useState<Row[]>([]);
  const [monthFilter, setMonthFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [draft, setDraft] = useState({ reference: "", month: "", quantity: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (pw: string, ck: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prevision?client=${encodeURIComponent(ck)}`, {
        headers: { "x-admin-password": pw },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur de chargement.");
      setRows(data.rows ?? []);
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

  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].sort(), [rows]);
  const shown = useMemo(
    () => (monthFilter ? rows.filter((r) => r.month === monthFilter) : rows),
    [rows, monthFilter]
  );

  async function save(reference: string, month: string, quantity: string | number) {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/prevision", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ client: clientKey, reference, month, quantity_cartons: quantity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur d'enregistrement.");
      setInfo(`« ${reference} » (${month}) enregistré.`);
      setDraft({ reference: "", month: "", quantity: "" });
      await load(password, clientKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: Row) {
    if (!window.confirm(`Supprimer « ${r.reference} » (${r.month}) ?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/prevision?id=${encodeURIComponent(r.id)}`, {
        method: "DELETE",
        headers: { "x-admin-password": password },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur de suppression.");
      setInfo(`« ${r.reference} » (${r.month}) supprimé.`);
      await load(password, clientKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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
          maxWidth: 960,
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
          Prévisions mensuelles (cartons) par client — <b>c'est la source utilisée par les
          rapports</b>. Ce que tu modifies ici est pris en compte à la prochaine génération.
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
              style={{ ...btnPrimary, padding: "10px 22px", fontSize: 14 }}
            >
              {loading ? "…" : "Entrer"}
            </button>
          </form>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Client</label>
              <select
                value={clientKey}
                onChange={(e) => {
                  setMonthFilter("");
                  setClientKey(e.target.value);
                }}
                style={{ ...inputStyle, width: 220, fontSize: 14 }}
              >
                {Object.entries(CLIENTS).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.display_name}
                  </option>
                ))}
              </select>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Mois</label>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                style={{ ...inputStyle, width: 130, fontSize: 14 }}
              >
                <option value="">Tous</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {loading && <span style={{ fontSize: 13, color: "#6b6f8a" }}>Chargement…</span>}
              <span style={{ flex: 1 }} />
              <button
                onClick={() => void importFromSheets()}
                disabled={importing}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #1B1F5E",
                  background: "#fff",
                  color: "#1B1F5E",
                  fontSize: 13,
                  cursor: "pointer",
                }}
                title="Récupère l'existant du classeur Google (toutes enseignes) — à faire une fois"
              >
                {importing ? "Import en cours…" : "Importer depuis Google Sheets"}
              </button>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#6b6f8a" }}>
                  <th style={{ padding: "6px 8px" }}>Référence</th>
                  <th style={{ padding: "6px 8px", width: 110 }}>Mois</th>
                  <th style={{ padding: "6px 8px", width: 110 }}>Cartons</th>
                  <th style={{ padding: "6px 8px", width: 130 }}>MàJ</th>
                  <th style={{ padding: "6px 8px", width: 170 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <EditableRow key={r.id} r={r} saving={saving} onSave={save} onRemove={remove} />
                ))}
                {shown.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} style={{ padding: 16, color: "#6b6f8a" }}>
                      Aucune prévision pour ce client{monthFilter ? ` en ${monthFilter}` : ""} —
                      ajoute une ligne ci-dessous ou lance l'import Google Sheets.
                    </td>
                  </tr>
                )}
                <tr style={{ borderTop: "2px solid #eef0fa", background: "#fafbff" }}>
                  <td style={{ padding: "6px 8px" }}>
                    <input
                      value={draft.reference}
                      onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                      style={{ ...inputStyle, fontWeight: 700 }}
                      placeholder="Nouvelle référence"
                    />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input
                      value={draft.month}
                      onChange={(e) => setDraft({ ...draft, month: e.target.value })}
                      style={inputStyle}
                      placeholder="2026-09"
                    />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input
                      value={draft.quantity}
                      onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                      style={inputStyle}
                      inputMode="numeric"
                      placeholder="0"
                    />
                  </td>
                  <td />
                  <td style={{ padding: "6px 8px" }}>
                    <button
                      onClick={() => void save(draft.reference, draft.month, draft.quantity)}
                      disabled={saving || !draft.reference.trim() || !draft.month || draft.quantity === ""}
                      style={btnPrimary}
                    >
                      + Ajouter
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function EditableRow({
  r,
  saving,
  onSave,
  onRemove,
}: {
  r: Row;
  saving: boolean;
  onSave: (reference: string, month: string, quantity: string | number) => Promise<void>;
  onRemove: (r: Row) => Promise<void>;
}) {
  const [qty, setQty] = useState(String(r.quantity_cartons));
  useEffect(() => setQty(String(r.quantity_cartons)), [r.quantity_cartons]);
  const dirty = qty !== String(r.quantity_cartons);
  const maj = r.updated_at ? new Date(r.updated_at).toLocaleDateString("fr-FR") : "";
  return (
    <tr style={{ borderTop: "1px solid #eef0fa" }}>
      <td style={{ padding: "4px 8px", fontWeight: 700 }}>{r.reference}</td>
      <td style={{ padding: "4px 8px" }}>{r.month}</td>
      <td style={{ padding: "4px 8px" }}>
        <input value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} inputMode="numeric" />
      </td>
      <td style={{ padding: "4px 8px", color: "#6b6f8a" }}>{maj}</td>
      <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
        <button
          onClick={() => void onSave(r.reference, r.month, qty)}
          disabled={!dirty || saving || qty === ""}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: dirty ? "#1B1F5E" : "#d6d9ea",
            color: "#fff",
            fontSize: 12,
            cursor: dirty ? "pointer" : "default",
            marginRight: 6,
          }}
        >
          Enregistrer
        </button>
        <button
          onClick={() => void onRemove(r)}
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
  );
}
