import { PDFDocument, rgb, PDFPage } from "pdf-lib";
import type { ReportData } from "./reportData";

const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const MARGIN = 40;
const PAGE_NUMBER_Y = 30;
const BRAND_COLOR_KROUSTY = { r: 0.47, g: 0.12, b: 0.12 }; // #7A1F1F
const ACCENT_COLOR_KROUSTY = { r: 0.95, g: 0.84, b: 0.69 }; // #F3D6B0

interface PageLayout {
  width: number;
  height: number;
  margin: number;
  contentWidth: number;
}

function getPageLayout(): PageLayout {
  return {
    width: A4_WIDTH,
    height: A4_HEIGHT,
    margin: MARGIN,
    contentWidth: A4_WIDTH - 2 * MARGIN,
  };
}

function addPageNumber(page: PDFPage, pageNum: number, totalPages: number): void {
  const { width } = page.getSize();
  const pageText = `${pageNum} / ${totalPages}`;
  page.drawText(pageText, {
    x: width - MARGIN - 60,
    y: PAGE_NUMBER_Y,
    size: 10,
    color: rgb(0.5, 0.5, 0.5),
  });
}

function drawSectionTitle(
  page: PDFPage,
  title: string,
  y: number,
  layout: PageLayout
): number {
  page.drawText(title, {
    x: layout.margin,
    y,
    size: 16,
    color: rgb(BRAND_COLOR_KROUSTY.r, BRAND_COLOR_KROUSTY.g, BRAND_COLOR_KROUSTY.b),
  });
  // Draw underline
  page.drawLine({
    start: { x: layout.margin, y: y - 8 },
    end: { x: layout.margin + layout.contentWidth, y: y - 8 },
    thickness: 2,
    color: rgb(ACCENT_COLOR_KROUSTY.r, ACCENT_COLOR_KROUSTY.g, ACCENT_COLOR_KROUSTY.b),
  });
  return y - 30;
}

function drawMetricRow(
  page: PDFPage,
  label: string,
  value: string | number | null,
  y: number,
  layout: PageLayout
): number {
  const displayValue = value !== null && value !== undefined ? String(value) : "N/A";
  page.drawText(label, {
    x: layout.margin,
    y,
    size: 11,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText(displayValue, {
    x: layout.margin + 300,
    y,
    size: 11,
    color: rgb(BRAND_COLOR_KROUSTY.r, BRAND_COLOR_KROUSTY.g, BRAND_COLOR_KROUSTY.b),
  });
  return y - 20;
}

export async function renderDesignReportPdf(data: ReportData): Promise<ArrayBuffer> {
  const pdfDoc = await PDFDocument.create();
  const layout = getPageLayout();
  const context = data.context;
  const client = context.client;
  const geodis = context.logistics.geodis;
  const gls = context.logistics.gls;

  // Parse brand color
  const brandColorHex = client.brand_color.replace("#", "");
  const r = parseInt(brandColorHex.substr(0, 2), 16) / 255;
  const g = parseInt(brandColorHex.substr(2, 2), 16) / 255;
  const b = parseInt(brandColorHex.substr(4, 2), 16) / 255;
  const brandColor = { r, g, b };

  // ===== PAGE 1: TITLE & SUMMARY =====
  let currentPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - layout.margin;

  // Title
  currentPage.drawText(`${client.display_name}`, {
    x: layout.margin,
    y,
    size: 32,
    color: rgb(brandColor.r, brandColor.g, brandColor.b),
  });
  y -= 50;

  currentPage.drawText(`Rapport Mensuel - ${context.month_label}`, {
    x: layout.margin,
    y,
    size: 16,
    color: rgb(0.5, 0.5, 0.5),
  });
  y -= 40;

  // KPI Summary
  y = drawSectionTitle(currentPage, "KPI Globaux", y, layout);
  y = drawMetricRow(currentPage, "CA réel:", context.kpi.ca_actual, y, layout);
  y = drawMetricRow(currentPage, "CA prévisionnel:", context.kpi.ca_forecast, y, layout);
  y = drawMetricRow(currentPage, "Performance:", context.kpi.performance_rate ? `${context.kpi.performance_rate}%` : "N/A", y, layout);
  y = drawMetricRow(currentPage, "Taux de réussite:", context.kpi.taux_reussite ? `${context.kpi.taux_reussite}%` : "N/A", y, layout);

  // Logistics Summary
  y -= 20;
  y = drawSectionTitle(currentPage, "Logistique", y, layout);
  y = drawMetricRow(currentPage, "Restaurants livrés:", context.logistics.restaurants_livres, y, layout);
  y = drawMetricRow(currentPage, "Total commandes:", context.logistics.total_commandes, y, layout);
  y = drawMetricRow(currentPage, "Total colis:", context.logistics.total_cartons, y, layout);
  y = drawMetricRow(currentPage, "Total poids (kg):", context.logistics.total_poids, y, layout);

  addPageNumber(currentPage, 1, 3);

  // ===== PAGE 2: GEODIS DETAILS =====
  currentPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  y = A4_HEIGHT - layout.margin;

  y = drawSectionTitle(currentPage, "Détails GEODIS", y, layout);
  y = drawMetricRow(currentPage, "Restaurants livrés:", geodis.restaurants_livres, y, layout);
  y = drawMetricRow(currentPage, "Total commandes:", geodis.total_commandes, y, layout);
  y = drawMetricRow(currentPage, "Total cartons:", geodis.total_cartons, y, layout);

  // Delay buckets
  y -= 20;
  currentPage.drawText("Performance de délai:", {
    x: layout.margin,
    y,
    size: 12,
    color: rgb(brandColor.r, brandColor.g, brandColor.b),
  });
  y -= 25;
  if (geodis.delay_buckets) {
    y = drawMetricRow(currentPage, "  ≤ 48h:", `${geodis.delay_buckets.le_48h_rate}%`, y, layout);
    y = drawMetricRow(currentPage, "  ≤ 72h:", `${geodis.delay_buckets.j_72h_rate}%`, y, layout);
    y = drawMetricRow(currentPage, "  > 72h:", `${geodis.delay_buckets.plus_72h_rate}%`, y, layout);
  }

  // Respect horaires
  y -= 20;
  currentPage.drawText("Respect des horaires:", {
    x: layout.margin,
    y,
    size: 12,
    color: rgb(brandColor.r, brandColor.g, brandColor.b),
  });
  y -= 25;
  y = drawMetricRow(currentPage, "  Avant 12h:", `${geodis.respect_horaires_12h}%`, y, layout);
  y = drawMetricRow(currentPage, "  Avant 11h:", `${geodis.respect_horaires_11h}%`, y, layout);
  y = drawMetricRow(currentPage, "  Conforme (12h-14h excl.):", `${geodis.respect_horaires_conformes}%`, y, layout);

  addPageNumber(currentPage, 2, 3);

  // ===== PAGE 3: GLS & DELIVERY PERFORMANCE =====
  currentPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  y = A4_HEIGHT - layout.margin;

  y = drawSectionTitle(currentPage, "Livraison Conforme et Non-Livraison Avant 12h", y, layout);

  // Display conforme metric prominently
  currentPage.drawText("Livraison Conforme (Messagerie France)", {
    x: layout.margin,
    y,
    size: 14,
    color: rgb(brandColor.r, brandColor.g, brandColor.b),
  });
  y -= 30;

  const conformeRate = geodis.respect_horaires_conformes;
  const conformeDisplay = conformeRate !== null && conformeRate !== undefined ? `${conformeRate}%` : "N/A";
  currentPage.drawText(conformeDisplay, {
    x: layout.margin + 100,
    y,
    size: 48,
    color: rgb(brandColor.r, brandColor.g, brandColor.b),
  });
  y -= 60;

  currentPage.drawText("Définition: Avant 12h OU après 14h (excluant service de midi 12h-14h)", {
    x: layout.margin,
    y,
    size: 10,
    color: rgb(0.5, 0.5, 0.5),
  });
  y -= 30;

  // GLS details
  y = drawSectionTitle(currentPage, "Détails GLS", y, layout);
  y = drawMetricRow(currentPage, "Restaurants livrés:", gls.restaurants_livres, y, layout);
  y = drawMetricRow(currentPage, "Total commandes:", gls.total_commandes, y, layout);
  y = drawMetricRow(currentPage, "Total colis:", gls.total_cartons, y, layout);
  y = drawMetricRow(currentPage, "Total poids (kg):", gls.total_poids, y, layout);

  // Non-delivery before 12h note
  y -= 20;
  currentPage.drawText("Note: Les données de temps de livraison GLS ne sont pas disponibles par défaut.", {
    x: layout.margin,
    y,
    size: 10,
    color: rgb(0.8, 0.2, 0.2),
  });

  addPageNumber(currentPage, 3, 3);

  const bytes = await pdfDoc.save();
  return bytes.buffer as ArrayBuffer;
}