import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { ReportData } from "./reportData";

const NAVY = rgb(0.106, 0.122, 0.369); // #1B1F5E
const GREY = rgb(0.4, 0.4, 0.4);
const LIGHT = rgb(0.93, 0.94, 0.98);

const A4: [number, number] = [595, 842];
const MARGIN = 50;

/** toLocaleString("fr-FR") insère des espaces fines insécables (U+202F)
 * que la police WinAnsi de pdf-lib ne peut pas encoder — on les remplace. */
function cleanSpaces(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, " ");
}

function fmt(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return cleanSpaces(`${Number(v).toLocaleString("fr-FR")}${suffix}`);
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return cleanSpaces(`${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`);
}

interface Cursor {
  page: PDFPage;
  y: number;
}

export async function renderDesignReportPdf(data: ReportData): Promise<Uint8Array> {
  const ctx = data.context;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cur: Cursor = { page: doc.addPage(A4), y: A4[1] - MARGIN };

  const ensureSpace = (needed: number) => {
    if (cur.y - needed < MARGIN) {
      cur.page = doc.addPage(A4);
      cur.y = A4[1] - MARGIN;
    }
  };

  const text = (
    s: string,
    opts: { x?: number; size?: number; font?: PDFFont; color?: any } = {}
  ) => {
    cur.page.drawText(s, {
      x: opts.x ?? MARGIN,
      y: cur.y,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: opts.color ?? rgb(0, 0, 0),
    });
  };

  const heading = (s: string) => {
    ensureSpace(40);
    cur.y -= 24;
    text(s, { size: 14, font: bold, color: NAVY });
    cur.y -= 6;
    cur.page.drawLine({
      start: { x: MARGIN, y: cur.y },
      end: { x: A4[0] - MARGIN, y: cur.y },
      thickness: 1,
      color: NAVY,
    });
    cur.y -= 14;
  };

  const kv = (label: string, value: string) => {
    ensureSpace(16);
    text(label, { size: 10, color: GREY });
    text(value, { x: 280, size: 10, font: bold });
    cur.y -= 16;
  };

  // ---- En-tete ----
  text(ctx.client.logo_text || ctx.client.display_name, { size: 22, font: bold, color: NAVY });
  cur.y -= 26;
  text(`Rapport mensuel client — ${ctx.month_label}`, { size: 13, color: NAVY });
  cur.y -= 14;
  text(`Généré le ${ctx.generated_at}`, { size: 9, color: GREY });
  cur.y -= 4;

  // ---- KPI ----
  heading("Indicateurs clés");
  kv("Nombre de références (SKU)", fmt(ctx.kpi.sku_count));
  kv("Pièces consommées", fmt(ctx.kpi.pieces_consumed));
  kv("CA réel H.T.", money(ctx.kpi.ca_actual));
  kv("CA prévisionnel H.T.", money(ctx.kpi.ca_forecast));
  kv("Taux de performance", fmt(ctx.kpi.performance_rate, " %"));
  kv("Nombre de commandes", fmt(ctx.kpi.total_commandes));
  kv("Total cartons", fmt(ctx.kpi.total_cartons));
  kv("Taux de réussite livraison", fmt(ctx.kpi.taux_reussite, " %"));

  // ---- Articles ----
  heading("Articles — prévisionnel vs consommation (cartons)");
  if (ctx.articles.length === 0) {
    text("Aucune donnée article pour ce mois.", { size: 10, color: GREY });
    cur.y -= 16;
  } else {
    const cols = [MARGIN, 170, 330, 400, 470];
    ensureSpace(18);
    cur.page.drawRectangle({
      x: MARGIN - 4,
      y: cur.y - 4,
      width: A4[0] - 2 * MARGIN + 8,
      height: 16,
      color: LIGHT,
    });
    text("Code", { x: cols[0], size: 9, font: bold });
    text("Description", { x: cols[1], size: 9, font: bold });
    text("Prévu", { x: cols[2], size: 9, font: bold });
    text("Conso", { x: cols[3], size: 9, font: bold });
    text("Taux", { x: cols[4], size: 9, font: bold });
    cur.y -= 18;
    for (const a of ctx.articles) {
      ensureSpace(14);
      text(a.code.slice(0, 22), { x: cols[0], size: 8 });
      text((a.description || "").slice(0, 32), { x: cols[1], size: 8 });
      text(fmt(a.forecast), { x: cols[2], size: 8 });
      text(fmt(a.consumption), { x: cols[3], size: 8 });
      text(fmt(a.rate, " %"), { x: cols[4], size: 8 });
      cur.y -= 13;
    }
  }

  // ---- Stock / transit ----
  heading("Stock & transit (projection hebdomadaire)");
  if (ctx.stock_status.length === 0) {
    text("Aucune donnée de stock disponible.", { size: 10, color: GREY });
    cur.y -= 16;
  } else {
    for (const item of ctx.stock_status) {
      ensureSpace(16);
      const weeks = item.weeks
        .map((w) => `S${w.week}: ${fmt(w.stock)}`)
        .join("   ");
      text(item.code, { size: 9, font: bold });
      text(weeks, { x: 180, size: 8 });
      cur.y -= 14;
    }
  }

  // ---- Logistique ----
  heading("Logistique (GEODIS + GLS via Supabase)");
  kv("Restaurants livrés", fmt(ctx.logistics.restaurants_livres));
  kv("Corner Wasabi", fmt(ctx.logistics.corner_wasabi));
  kv("Total commandes", fmt(ctx.logistics.total_commandes));
  kv("Total cartons", fmt(ctx.logistics.total_cartons));
  kv("Total poids", fmt(ctx.logistics.total_poids, " kg"));
  kv("Part GEODIS", fmt(ctx.logistics.geodis_share, " %"));
  kv("Part GLS", fmt(ctx.logistics.gls_share, " %"));
  kv("GEODIS — cartons", fmt(ctx.logistics.geodis.total_cartons));
  kv("GEODIS — délai moyen (jours)", fmt(ctx.logistics.geodis.moyenne_jours));
  kv("GLS — colis", fmt(ctx.logistics.gls.total_cartons));
  kv("GLS — délai moyen (jours)", fmt(ctx.logistics.gls.moyenne_jours));

  // ---- Finances ----
  heading("Données financières");
  kv("CA total H.T.", money(ctx.financials.ca_total ?? null));
  kv("Nombre de commandes", String(ctx.financials.nombre_commande ?? "-"));
  kv("RFAs / Commissions", String(ctx.financials.commissions ?? "-"));

  // ---- Pied de page ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`MBA Green — ${ctx.client.display_name} — ${ctx.month_label} — page ${i + 1}/${pages.length}`, {
      x: MARGIN,
      y: 28,
      size: 8,
      font,
      color: GREY,
    });
  });

  return await doc.save();
}
