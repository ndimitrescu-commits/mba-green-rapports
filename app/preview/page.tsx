"use client";

/**
 * /preview — Aperçu & édition avant génération.
 * 1. Choisir client + mois → « Charger les données » appelle /api/context
 *    (collecte complète, ~10-30 s) et affiche le contexte.
 * 2. L'aperçu de droite est le VRAI PDF (même moteur que la génération),
 *    régénéré automatiquement ~1 s après chaque modification.
 * 3. « Télécharger le PDF » envoie le contexte affiché (modifications
 *    comprises) à /api/generate — ce que tu vois est ce qui est généré.
 */

import { useEffect, useRef, useState } from "react";
import clientsConfig from "@/lib/clients.json";

type ClientsConfig = Record<string, { display_name: string }>;
const CLIENTS = clientsConfig as ClientsConfig;
const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

// Libellés français des champs connus (repli : nom brut de la clé).
const LABELS: Record<string, string> = {
  kpi: "Facteurs clés (p.2-3)",
  sku_count: "SKU", pieces_consumed: "Pièces", ca_actual: "CA réalisé (€ HT)",
  ca_forecast: "CA attendu (€ HT)", performance_rate: "Taux de performance (%)",
  total_commandes: "Total commandes", total_cartons: "Total cartons",
  taux_reussite: "Taux de réussite (%)",
  articles: "Articles (p.3)", forecast: "Prévisions", consumption: "Consommation",
  rate: "Taux (%)", ca_consumption: "CA conso (€ HT)",
  stock_status: "Statut articles (p.4)", on_hand: "Stock actuel", weeks: "Semaines",
  week: "Semaine", stock: "Stock", in_transit: "En transit",
  logistics: "Logistique (p.5-10)", restaurants_livres: "Restaurants livrés",
  corner_wasabi: "Corner Wasabi", corner_wasabi_count: "Corner Wasabi",
  total_poids: "Poids total (kg)", geodis_share: "Part GEODIS (%)", gls_share: "Part GLS (%)",
  geodis: "GEODIS", gls: "GLS", france: "France", belgique_lux: "Belgique / Luxembourg",
  express: "Express", affretement: "Affrètement", livrees: "Livrées",
  delay_buckets: "Délais (jours)", le_48h: "≤ A-C", j_72h: "= A-D", plus_72h: "> A-D+",
  total: "Total", by_country: "Par pays", moyenne_jours: "Moyenne/jour",
  moyenne_cmds_cartons: "Moy. cartons/cmd", moyenne_cmds_poids: "Moy. poids/cmd",
  respect_horaires_12h: "Avant 12:00 (%)", respect_horaires_11h: "Avant 11:00 (%)",
  express_delay: "Délais express", within_24h: "≤ 24H",
  fr: "GLS France", europe: "GLS Europe", buckets: "Paliers de délai",
  livre: "Livrée", prevu: "Prévu", label: "Palier",
  financials: "Données financières (p.11)", ca_total: "CA total (€ HT)",
  reglement_30_classique: "Net 30 j (virement)", reglement_escompte_2: "Escompte 2% (SEPA)",
  reglement_30_sepa: "Net 30 j (SEPA)", reglement_45_sepa: "Net 45 j (SEPA)",
  commissions: "Commission référencement", commissions_pkg: "Commission stock PKG",
  nombre_commande: "Nombre de commandes", reglement_livraison: "À la livraison",
  reglement_commande: "À la commande",
};
// Champs non éditables / non pertinents pour l'édition.
const HIDDEN_KEYS = new Set(["client", "generated_at", "month_label", "restaurant_names", "code", "description"]);
const SECTIONS = ["kpi", "articles", "stock_status", "logistics", "financials"];

function label(k: string): string {
  return LABELS[k] ?? k;
}
function isSetMarker(v: unknown): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as any).__set);
}
function itemTitle(v: any, i: number): string {
  if (v && typeof v === "object") {
    if (typeof v.code === "string") return v.code;
    if (typeof v.label === "string") return v.label;
    if (v.week !== undefined) return `Semaine ${v.week}`;
  }
  return `#${i + 1}`;
}

/** Éditeur récursif : nombres/chaînes en <input>, objets/tableaux en blocs. */
function FieldEditor({
  value, original, path, onChange, depth,
}: {
  value: any; original: any; path: (string | number)[];
  onChange: (path: (string | number)[], v: any) => void; depth: number;
}) {
  if (value === null || typeof value === "number") {
    const changed = original !== undefined && String(original ?? "") !== String(value ?? "");
    return (
      <input
        type="number"
        step="any"
        value={value ?? ""}
        placeholder="-"
        onChange={(e) => {
          const t = e.target.value;
          onChange(path, t === "" ? null : Number(t));
        }}
        style={{
          width: 110, padding: "3px 7px", borderRadius: 7, fontSize: 13,
          border: changed ? "2px solid #e8804d" : "1px solid #c7cce6",
          background: changed ? "#fff4ec" : "#fff", color: "#1f2a6b",
        }}
      />
    );
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return <span style={{ fontSize: 13, color: "#6a6f85" }}>{String(value)}</span>;
  }
  if (isSetMarker(value)) {
    return <span style={{ fontSize: 12, color: "#9aa0ba" }}>{(value as any).__set.length} éléments</span>;
  }
  if (Array.isArray(value)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
        {value.map((item, i) => (
          <details key={i} open={depth < 1} style={{ background: "#f2f4fc", borderRadius: 8, padding: "4px 8px" }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#1f2a6b" }}>
              {itemTitle(item, i)}
            </summary>
            <div style={{ paddingLeft: 8, paddingTop: 4 }}>
              <FieldEditor value={item} original={original?.[i]} path={[...path, i]} onChange={onChange} depth={depth + 1} />
            </div>
          </details>
        ))}
      </div>
    );
  }
  if (value && typeof value === "object") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
        {Object.entries(value)
          .filter(([k]) => !HIDDEN_KEYS.has(k))
          .map(([k, v]) => {
            const leaf = v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean" || isSetMarker(v);
            return (
              <div
                key={k}
                style={leaf
                  ? { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }
                  : { display: "flex", flexDirection: "column", gap: 3 }}
              >
                <span style={{ fontSize: 13, color: "#3a4066", fontWeight: leaf ? 400 : 700 }}>{label(k)}</span>
                <FieldEditor value={v} original={original?.[k]} path={[...path, k]} onChange={onChange} depth={depth + 1} />
              </div>
            );
          })}
      </div>
    );
  }
  return null;
}

function setAtPath(obj: any, path: (string | number)[], v: any): any {
  if (path.length === 0) return v;
  const [head, ...rest] = path;
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  copy[head as any] = setAtPath(obj?.[head as any], rest, v);
  return copy;
}

export default function PreviewPage() {
  const now = new Date();
  const [clientKey, setClientKey] = useState("POKAWA");
  const [monthName, setMonthName] = useState(MONTHS[(now.getMonth() + 11) % 12]);
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [ctx, setCtx] = useState<any>(null);
  const [origJson, setOrigJson] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monthLabel = `${monthName} ${year}`;

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("client", clientKey);
      fd.set("month_label", monthLabel);
      const res = await fetch("/api/context", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || "Erreur pendant la collecte des données.");
      }
      const json = await res.text();
      setOrigJson(json);
      setCtx(JSON.parse(json));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function renderPreview(current: any) {
    setRendering(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("client", clientKey);
      fd.set("month_label", monthLabel);
      fd.set("context", JSON.stringify(current));
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || "Erreur pendant le rendu de l'aperçu.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRendering(false);
    }
  }

  // Aperçu initial + régénération différée (~1 s) après chaque édition.
  useEffect(() => {
    if (!ctx) return;
    if (renderTimer.current) clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => renderPreview(ctx), 1000);
    return () => {
      if (renderTimer.current) clearTimeout(renderTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  function onFieldChange(path: (string | number)[], v: any) {
    setCtx((cur: any) => setAtPath(cur, path, v));
  }

  async function download() {
    if (!ctx) return;
    setDownloading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("client", clientKey);
      fd.set("month_label", monthLabel);
      fd.set("context", JSON.stringify(ctx));
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || "Erreur pendant la génération.");
      }
      const blob = await res.blob();
      let filename = "rapport.pdf";
      const disposition = res.headers.get("Content-Disposition");
      const m = disposition?.match(/filename="?([^"]+)"?/);
      if (m) filename = m[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDownloading(false);
    }
  }

  const modified = ctx && origJson && JSON.stringify(ctx) !== origJson;
  const sel: React.CSSProperties = {
    padding: "8px 10px", borderRadius: 10, border: "1px solid #c7cce6",
    fontSize: 14, color: "#1f2a6b", background: "#fff",
  };
  const btn = (bg: string): React.CSSProperties => ({
    padding: "9px 16px", borderRadius: 10, border: "none", cursor: "pointer",
    background: bg, color: "#fff", fontSize: 14, fontWeight: 700,
  });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#eef0fa", fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#fff", borderBottom: "1px solid #dde1f1", flexWrap: "wrap" }}>
        <a href="/" style={{ color: "#1f2a6b", fontWeight: 800, fontSize: 17, textDecoration: "none" }}>
          ← Rapport mensuel — aperçu & édition
        </a>
        <select style={sel} value={clientKey} onChange={(e) => setClientKey(e.target.value)}>
          {Object.entries(CLIENTS).map(([k, v]) => (
            <option key={k} value={k}>{v.display_name}</option>
          ))}
        </select>
        <select style={sel} value={monthName} onChange={(e) => setMonthName(e.target.value)}>
          {MONTHS.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select style={sel} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button style={btn("#1f2a6b")} onClick={loadData} disabled={loading}>
          {loading ? "Collecte en cours…" : ctx ? "Recharger les données" : "Charger les données"}
        </button>
        {ctx && (
          <>
            {modified && (
              <button
                style={{ ...btn("#fff"), color: "#b3541e", border: "1px solid #e8804d" }}
                onClick={() => setCtx(JSON.parse(origJson))}
              >
                Réinitialiser les modifications
              </button>
            )}
            <span style={{ fontSize: 13, color: rendering ? "#b3541e" : "#6a6f85" }}>
              {rendering ? "Actualisation de l'aperçu…" : modified ? "Aperçu à jour (valeurs modifiées)" : "Aperçu à jour"}
            </span>
            <div style={{ flex: 1 }} />
            <button style={btn("#2e7d4f")} onClick={download} disabled={downloading || rendering}>
              {downloading ? "Génération…" : "Télécharger le PDF"}
            </button>
          </>
        )}
      </div>
      {error && (
        <div style={{ margin: "10px 16px 0", padding: "10px 14px", background: "#fbe9b8", borderRadius: 10, color: "#5a4a12", fontSize: 13 }}>
          {error}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ width: 430, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {!ctx && !loading && (
            <div style={{ color: "#6a6f85", fontSize: 14, lineHeight: 1.5 }}>
              Choisis un client et un mois puis « Charger les données ». Toutes les
              statistiques du rapport apparaîtront ici, modifiables ; l'aperçu de
              droite est le PDF réel, régénéré à chaque changement. Les champs
              modifiés passent en orange.
            </div>
          )}
          {ctx &&
            SECTIONS.filter((s) => ctx[s] !== undefined).map((s) => (
              <details key={s} open={s === "kpi"} style={{ background: "#fff", borderRadius: 12, padding: "8px 12px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 800, color: "#1f2a6b", fontSize: 15 }}>
                  {label(s)}
                </summary>
                <div style={{ paddingTop: 8 }}>
                  <FieldEditor
                    value={ctx[s]}
                    original={JSON.parse(origJson)[s]}
                    path={[s]}
                    onChange={onFieldChange}
                    depth={0}
                  />
                </div>
              </details>
            ))}
        </div>
        <div style={{ flex: 1, padding: "14px 14px 14px 0" }}>
          {pdfUrl ? (
            <embed src={pdfUrl} type="application/pdf" style={{ width: "100%", height: "100%", borderRadius: 12, border: "1px solid #dde1f1" }} />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa0ba", fontSize: 15, background: "#e9ecfb", borderRadius: 12 }}>
              {loading ? "Collecte des données en cours…" : ctx ? "Rendu de l'aperçu…" : "L'aperçu PDF s'affichera ici"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
