/**
 * lib/renderDesignPdf.ts
 * ======================
 * Rendu du rapport mensuel client — réplique du template design 12 pages
 * (ex-pipeline Slides/Canva) en pdf-lib, à partir du ReportContext.
 * Référence visuelle : rapport Pokawa Février 2026.
 *
 * Système de coordonnées : le template de référence est mesuré en pixels
 * 1920x1080 ; la page PDF fait 960x540 (échelle 0,5), paysage 16:9.
 * Les helpers convertissent "coordonnées référence, origine en haut à
 * gauche" vers le repère PDF (origine en bas à gauche).
 */

import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReportData } from "./reportData";
import type { ReportContext } from "./types";
import { CLIENT_ASSETS, FONTS, ICONS, IMAGES } from "./reportAssets";

// ---------------------------------------------------------------------------
// Palette (échantillonnée sur le rapport de référence)
// ---------------------------------------------------------------------------
const NAVY = rgb(0x1f / 255, 0x2a / 255, 0x6b / 255);
const LAVENDER_BG = rgb(0xed / 255, 0xef / 255, 0xfa / 255);
const LAVENDER_PANEL = rgb(0xe9 / 255, 0xec / 255, 0xfb / 255);
const WHITE = rgb(1, 1, 1);
const PINK = rgb(0xf8 / 255, 0xca / 255, 0xc7 / 255);
const YELLOW = rgb(0xfb / 255, 0xe3 / 255, 0xa3 / 255);
const GREY_PILL = rgb(0xde / 255, 0xe2 / 255, 0xf1 / 255);
const PINK_PILL = rgb(0xfa / 255, 0xdd / 255, 0xe0 / 255);
const CIRCLE_1 = rgb(0xdb / 255, 0xdd / 255, 0xe7 / 255);
const CIRCLE_2 = rgb(0xb9 / 255, 0xbd / 255, 0xd3 / 255);
const CIRCLE_3 = rgb(0x9b / 255, 0xa0 / 255, 0xbe / 255);
const GREY_TEXT = rgb(0.42, 0.44, 0.52);
const GRID_LINE = rgb(0.9, 0.91, 0.95);

const PAGE_W = 960;
const PAGE_H = 540;
const S = 0.5;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function cleanSpaces(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, " ");
}
function nf(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return cleanSpaces(
    Number(v).toLocaleString("fr-FR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
}
function eur(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${nf(Number(v), 2)} € HT`;
}
function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${nf(Number(v), digits)} %`;
}
function asNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

interface Fonts {
  reg: PDFFont;
  med: PDFFont;
  semi: PDFFont;
  bold: PDFFont;
  xbold: PDFFont;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  f: Fonts;
  icons: Record<string, PDFImage>;
  logoClient: PDFImage | null;
  logoMba: PDFImage;
  cover: PDFImage | null;
  r: ReportContext;
}

const X = (x: number) => x * S;
const Y = (yTop: number, h = 0) => PAGE_H - yTop * S - h * S;

function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `M ${rr} 0 H ${w - rr} Q ${w} 0 ${w} ${rr} V ${h - rr} ` +
    `Q ${w} ${h} ${w - rr} ${h} H ${rr} Q 0 ${h} 0 ${h - rr} V ${rr} Q 0 0 ${rr} 0 Z`
  );
}

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number, color: any) {
  c.page.drawSvgPath(roundedRectPath(w * S, h * S, r * S), {
    x: X(x),
    y: PAGE_H - y * S,
    color,
  });
}

interface TextOpts {
  size: number;
  font?: PDFFont;
  color?: any;
  align?: "left" | "center" | "right";
  maxW?: number;
}

function txt(c: Ctx, s: string, x: number, yTop: number, o: TextOpts) {
  const font = o.font ?? c.f.reg;
  const size = o.size * S;
  const original = cleanSpaces(s);
  let str = original;
  if (o.maxW) {
    const maxW = o.maxW * S;
    while (str.length > 1 && font.widthOfTextAtSize(str, size) > maxW) {
      str = str.slice(0, -1);
    }
    if (str !== original) str = str.slice(0, -1) + "…";
  }
  const w = font.widthOfTextAtSize(str, size);
  let px = X(x);
  if (o.align === "center") px -= w / 2;
  if (o.align === "right") px -= w;
  c.page.drawText(str, {
    x: px,
    y: PAGE_H - yTop * S - size * 0.78,
    size,
    font,
    color: o.color ?? NAVY,
  });
}

function icon(c: Ctx, name: string, x: number, yTop: number, hRef: number) {
  const img = c.icons[name];
  if (!img) return;
  const h = hRef * S;
  const w = (img.width / img.height) * h;
  c.page.drawImage(img, { x: X(x), y: PAGE_H - yTop * S - h, width: w, height: h });
}

function newPage(c: Ctx, bg: any = WHITE) {
  c.page = c.doc.addPage([PAGE_W, PAGE_H]);
  c.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: bg });
}

function pageNumber(c: Ctx, n: number, yTop = 40) {
  txt(c, String(n).padStart(2, "0"), 1870, yTop, {
    size: 30,
    font: c.f.semi,
    align: "right",
  });
}

function footerLogos(c: Ctx, yTop = 990) {
  const h = 52;
  let xRight = 1860;
  const mba = c.logoMba;
  const wMba = (mba.width / mba.height) * h * S;
  c.page.drawImage(mba, { x: X(xRight) - wMba, y: Y(yTop, h), width: wMba, height: h * S });
  xRight -= wMba / S + 22;
  txt(c, "x", xRight, yTop + 14, { size: 22, font: c.f.bold, align: "right" });
  xRight -= 24;
  if (c.logoClient) {
    const lc = c.logoClient;
    const wc = (lc.width / lc.height) * h * S;
    c.page.drawImage(lc, { x: X(xRight) - wc, y: Y(yTop, h), width: wc, height: h * S });
  } else {
    txt(c, c.r.client.logo_text || c.r.client.display_name, xRight, yTop + 14, {
      size: 22,
      font: c.f.bold,
      align: "right",
    });
  }
}

function monthYear(label: string): { month: string; year: string } {
  const parts = label.trim().split(/\s+/);
  return { month: parts[0] ?? label, year: parts[1] ?? "" };
}

function card(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  iconName: string,
  title: string,
  lines: { text: string; big?: boolean }[]
) {
  rrect(c, x, y, w, h, 24, WHITE);
  icon(c, iconName, x + 44, y + 44, 52);
  let ty = y + 122;
  const words = title.split(" ");
  const maxW = (w - 88) * S;
  let line = "";
  const titleLines: string[] = [];
  for (const wd of words) {
    const test = line ? `${line} ${wd}` : wd;
    if (c.f.semi.widthOfTextAtSize(test, 24 * S) > maxW && line) {
      titleLines.push(line);
      line = wd;
    } else line = test;
  }
  if (line) titleLines.push(line);
  for (const tl of titleLines) {
    txt(c, tl, x + 44, ty, { size: 24, font: c.f.semi });
    ty += 32;
  }
  ty += 8;
  for (const l of lines) {
    txt(c, l.text, x + 44, ty, {
      size: l.big ? 24 : 19,
      font: l.big ? c.f.med : c.f.reg,
      color: l.big ? NAVY : GREY_TEXT,
      maxW: w - 80,
    });
    ty += l.big ? 34 : 27;
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function pageCover(c: Ctx) {
  newPage(c, LAVENDER_BG);
  const { month, year } = monthYear(c.r.month_label);
  txt(c, "RAPPORT MENSUEL", 960, 80, { size: 96, font: c.f.xbold, align: "center" });
  if (c.cover) {
    const w = 1072 * S;
    const h = (c.cover.height / c.cover.width) * w;
    const ix = (PAGE_W - w) / 2;
    const iy = PAGE_H - 240 * S - h;
    c.page.drawImage(c.cover, { x: ix, y: iy, width: w, height: h });
    // angles arrondis : masques quart-de-cercle inversés couleur fond
    const cr = 13;
    const corner = (px: number, py: number, sx: number, sy: number) => {
      const path = `M 0 0 L ${cr * sx} 0 A ${cr} ${cr} 0 0 ${sx * sy > 0 ? 0 : 1} 0 ${cr * sy} Z`;
      c.page.drawSvgPath(path, { x: px, y: py, color: LAVENDER_BG });
    };
    corner(ix, iy + h, 1, 1); // haut-gauche
    corner(ix + w, iy + h, -1, 1); // haut-droit
    corner(ix, iy, 1, -1); // bas-gauche
    corner(ix + w, iy, -1, -1); // bas-droit
  } else {
    rrect(c, 424, 240, 1072, 443, 26, NAVY);
    txt(c, c.r.client.logo_text || c.r.client.display_name, 960, 420, {
      size: 72,
      font: c.f.xbold,
      align: "center",
      color: WHITE,
    });
  }
  txt(c, month, 118, 930, { size: 44, font: c.f.med });
  txt(c, year, 1842, 930, { size: 44, font: c.f.med, align: "right" });
}

function pageKpi(c: Ctx) {
  newPage(c);
  pageNumber(c, 2);
  txt(c, "Facteurs clés", 88, 115, { size: 58, font: c.f.xbold });
  rrect(c, 60, 250, 1800, 780, 28, LAVENDER_PANEL);
  const k = c.r.kpi;
  const cw = 400,
    ch = 305,
    gap = 30,
    x0 = 118,
    y0 = 320;
  card(c, x0, y0, cw, ch, "articles", "Articles", [
    { text: `SKU : ${nf(k.sku_count)}`, big: true },
    { text: `Pièces : ${nf(k.pieces_consumed)}`, big: true },
  ]);
  card(c, x0 + (cw + gap), y0, cw, ch, "ca", "Chiffre d'affaires", [
    { text: eur(k.ca_actual), big: true },
  ]);
  card(c, x0 + 2 * (cw + gap), y0, cw, ch, "livraisons", "Livraisons", [
    { text: "Total de commandes :", big: true },
    { text: nf(k.total_commandes), big: true },
    { text: `${nf(k.total_cartons)} cartons`, big: true },
  ]);
  card(c, x0 + 3 * (cw + gap), y0, cw, ch, "taux", "Taux de réussite des livraisons", [
    { text: pct(k.taux_reussite), big: true },
  ]);
  footerLogos(c);
}

function pageArticles(c: Ctx) {
  newPage(c);
  pageNumber(c, 3);
  txt(c, "Articles : Performance", 72, 85, { size: 52, font: c.f.xbold });
  c.page.drawCircle({ x: X(90), y: Y(200), size: 5, color: NAVY });
  txt(c, "Prévisions", 108, 188, { size: 22, font: c.f.med });
  c.page.drawCircle({ x: X(290), y: Y(200), size: 5, color: PINK });
  txt(c, "Consommation", 308, 188, { size: 22, font: c.f.med });

  const arts = c.r.articles;
  const chartTop = 240;
  const chartBottom = 1030;
  const axisX0 = 278;
  const axisX1 = 1160;
  const maxVal = Math.max(100, ...arts.map((a) => Math.max(a.forecast, a.consumption)));
  const axisMax = Math.ceil(maxVal / 200) * 200;

  const steps = axisMax / 200;
  for (let i = 0; i <= steps; i++) {
    const gx = axisX0 + ((axisX1 - axisX0) * i) / steps;
    c.page.drawLine({
      start: { x: X(gx), y: Y(chartTop) },
      end: { x: X(gx), y: Y(chartBottom) },
      thickness: 0.5,
      color: GRID_LINE,
    });
    if (i > 0)
      txt(c, String(i * 200), gx, chartBottom + 6, { size: 18, color: GREY_TEXT, align: "center" });
  }

  const n = Math.max(arts.length, 1);
  const rowH = Math.min(30, (chartBottom - chartTop) / n);
  const barH = Math.min(11, rowH * 0.36);
  const scale = (axisX1 - axisX0) / axisMax;

  arts.forEach((a, i) => {
    const yRow = chartTop + i * rowH;
    txt(c, a.code, axisX0 - 14, yRow + rowH / 2 - 10, {
      size: 17,
      font: c.f.med,
      align: "right",
      maxW: 215,
    });
    const yPrev = yRow + rowH / 2 - barH - 1.5;
    const yCons = yRow + rowH / 2 + 1.5;
    if (a.forecast > 0) {
      rrect(c, axisX0, yPrev, Math.max(a.forecast * scale, 4), barH, barH / 2, NAVY);
      txt(c, nf(a.forecast), axisX0 + a.forecast * scale + 10, yPrev - 3, {
        size: 15,
        font: c.f.med,
      });
    }
    if (a.consumption > 0) {
      rrect(c, axisX0, yCons, Math.max(a.consumption * scale, 4), barH, barH / 2, PINK);
      txt(c, nf(a.consumption), axisX0 + a.consumption * scale + 10, yCons - 3, {
        size: 15,
        font: c.f.med,
      });
    }
    if (a.rate !== null) {
      const pw = 74,
        ph = 26;
      rrect(c, 1205, yRow + rowH / 2 - ph / 2, pw, ph, ph / 2, PINK);
      txt(c, `${nf(a.rate)}%`, 1205 + pw / 2, yRow + rowH / 2 - 10, {
        size: 16,
        font: c.f.semi,
        align: "center",
      });
    }
  });

  const circles: { label: string[]; value: string; color: any; cy: number }[] = [
    {
      label: ["Chiffre d'affaires", "attendu"],
      value: eur(c.r.kpi.ca_forecast),
      color: CIRCLE_1,
      cy: 325,
    },
    {
      label: ["Chiffre d'affaires", "actuel"],
      value: eur(c.r.kpi.ca_actual),
      color: CIRCLE_2,
      cy: 525,
    },
    {
      label: ["Taux de", "performance"],
      value: pct(c.r.kpi.performance_rate, 2),
      color: CIRCLE_3,
      cy: 725,
    },
  ];
  for (const ci of circles) {
    c.page.drawCircle({ x: X(1718), y: Y(ci.cy), size: 116 * S, color: ci.color });
    let ly = ci.cy - 46;
    for (const l of ci.label) {
      txt(c, l, 1718, ly, { size: 23, align: "center" });
      ly += 29;
    }
    txt(c, ci.value, 1718, ly + 8, { size: 21, font: c.f.bold, align: "center" });
  }
}

function pageStock(c: Ctx) {
  newPage(c);
  pageNumber(c, 4, 18);
  txt(c, "Articles", 55, 48, { size: 46, font: c.f.xbold });
  txt(c, "Statut :", 55, 104, { size: 46, font: c.f.xbold });

  const items = c.r.stock_status.slice(0, 6);
  const weeks = items[0]?.weeks?.map((w) => w.week) ?? [];
  const nW = Math.min(weeks.length, 8);

  // Pill décalé après le titre (le titre "Articles" s'étend jusqu'à ~295)
  // et rétréci pour ne pas mordre la première colonne SEMAINE (x=560).
  rrect(c, 330, 62, 216, 44, 22, NAVY);
  txt(c, "PRÉVISIONS / STOCK / EN TRANSIT", 438, 80, {
    size: 10,
    font: c.f.semi,
    align: "center",
    color: WHITE,
  });
  const colX0 = 560,
    colW = 155,
    colGap = 13;
  for (let i = 0; i < nW; i++) {
    const x = colX0 + i * (colW + colGap);
    rrect(c, x, 58, colW, 50, 25, NAVY);
    txt(c, "SEMAINE", x + colW / 2, 66, { size: 11, font: c.f.semi, align: "center", color: WHITE });
    txt(c, String(weeks[i]), x + colW / 2, 84, {
      size: 13,
      font: c.f.semi,
      align: "center",
      color: WHITE,
    });
  }

  const rowDefs = [
    { key: "forecast" as const, label: "PRÉVISIONS", pill: YELLOW },
    { key: "stock" as const, label: "STOCK", pill: GREY_PILL },
    { key: "in_transit" as const, label: "EN TRANSIT", pill: PINK_PILL },
  ];

  const blockTop = 150;
  const blockH = 142;
  items.forEach((item, bi) => {
    const yB = blockTop + bi * blockH;
    rrect(c, 190, yB + 8, 260, 128, 18, NAVY);
    txt(c, item.code, 320, yB + 58, {
      size: 19,
      font: c.f.bold,
      align: "center",
      color: WHITE,
      maxW: 240,
    });
    rowDefs.forEach((rd, ri) => {
      const yR = yB + 12 + ri * 42;
      rrect(c, 458, yR, 94, 34, 17, rd.pill);
      txt(c, rd.label, 505, yR + 12, { size: 9.5, font: c.f.semi, align: "center" });
      for (let wi = 0; wi < nW; wi++) {
        const x = colX0 + wi * (colW + colGap);
        rrect(c, x, yR, colW, 34, 17, rd.pill);
        const wk = item.weeks[wi];
        const v =
          rd.key === "forecast" ? wk?.forecast : rd.key === "stock" ? wk?.stock : wk?.in_transit;
        if (v !== undefined && v !== null && !(rd.key === "in_transit" && v === 0)) {
          txt(c, nf(v), x + colW / 2, yR + 8, { size: 14, font: c.f.semi, align: "center" });
        }
      }
    });
  });
  txt(c, "Voir le rapport complet en annexe", 960, 1020, {
    size: 24,
    font: c.f.bold,
    align: "center",
  });
}

function cardsPage(
  c: Ctx,
  num: number,
  sectionTitle: string,
  cards: { icon: string; title: string; lines: { text: string; big?: boolean }[] }[]
) {
  newPage(c);
  pageNumber(c, num);
  txt(c, "Logistique", 88, 115, { size: 58, font: c.f.xbold });
  rrect(c, 60, 250, 1800, 780, 28, LAVENDER_PANEL);
  txt(c, sectionTitle, 960, 298, { size: 40, font: c.f.bold, align: "center" });
  const n = cards.length;
  const cw = n === 5 ? 322 : 366;
  const ch = 350;
  const gap = 26;
  const total = n * cw + (n - 1) * gap;
  const x0 = (1920 - total) / 2;
  const y0 = 380;
  cards.forEach((cd, i) => card(c, x0 + i * (cw + gap), y0, cw, ch, cd.icon, cd.title, cd.lines));
  footerLogos(c);
}

function perfPanel(
  c: Ctx,
  x: number,
  title: string,
  rate: number | null | undefined,
  rows: { label: string; value: string }[],
  chart: { title: string; bars: { label: string; navy: number; pink: number }[] } | null
) {
  rrect(c, x, 288, 882, 742, 26, LAVENDER_PANEL);
  txt(c, title, x + 42, 322, { size: 30, font: c.f.med });
  // Cercle descendu sous le sous-titre (avant : sommet du cercle à ~340,
  // en collision avec la ligne de titre 322-352).
  const cy = 470;
  c.page.drawCircle({ x: X(x + 105), y: Y(cy), size: 46, color: NAVY });
  txt(c, rate === null || rate === undefined ? "-" : `${nf(rate)}%`, x + 105, cy - 16, {
    size: 26,
    font: c.f.bold,
    align: "center",
    color: WHITE,
  });
  let ry = 426;
  const labelW = Math.max(
    ...rows.map((rr) => c.f.reg.widthOfTextAtSize(rr.label, 24 * S)),
    0
  );
  for (const rrow of rows) {
    txt(c, rrow.label, x + 218, ry, { size: 24 });
    txt(c, rrow.value, x + 218 + labelW / S + 30, ry, { size: 24, font: c.f.bold });
    ry += 36;
  }
  if (chart) {
    txt(c, chart.title, x + 441, 556, { size: 26, font: c.f.med, align: "center" });
    if (chart.bars.length > 0) {
      const maxV = Math.max(1, ...chart.bars.flatMap((b) => [b.navy, b.pink]));
      const bx0 = x + 132;
      const bw = 655;
      let by = 602;
      for (const b of chart.bars) {
        txt(c, b.label, bx0 - 12, by + 4, { size: 15, color: GREY_TEXT, align: "right" });
        if (b.navy > 0) rrect(c, bx0, by, Math.max((b.navy / maxV) * bw, 6), 13, 6.5, NAVY);
        if (b.pink > 0) rrect(c, bx0, by + 17, Math.max((b.pink / maxV) * bw, 6), 13, 6.5, PINK);
        by += 46;
      }
      const ly = by + 12;
      c.page.drawCircle({ x: X(x + 322), y: Y(ly + 12), size: 5, color: NAVY });
      txt(c, "Livrée", x + 338, ly, { size: 18, font: c.f.med });
      c.page.drawCircle({ x: X(x + 462), y: Y(ly + 12), size: 5, color: PINK });
      txt(c, "Prévu", x + 478, ly, { size: 18, font: c.f.med });
    } else {
      const ly = 604;
      c.page.drawCircle({ x: X(x + 322), y: Y(ly + 12), size: 5, color: NAVY });
      txt(c, "Livrée", x + 338, ly, { size: 18, font: c.f.med });
      c.page.drawCircle({ x: X(x + 462), y: Y(ly + 12), size: 5, color: PINK });
      txt(c, "Prévu", x + 478, ly, { size: 18, font: c.f.med });
    }
  }
}

function perfHeader(c: Ctx, num: number, subtitle: string) {
  newPage(c);
  pageNumber(c, num);
  txt(c, "Logistique : Performance", 72, 105, { size: 52, font: c.f.xbold });
  txt(c, subtitle, 74, 178, { size: 28 });
  footerLogos(c, 962);
}

function pageFinancials(c: Ctx) {
  newPage(c);
  pageNumber(c, 11);
  txt(c, "Données Financières", 80, 95, { size: 58, font: c.f.xbold });
  rrect(c, 60, 195, 1800, 850, 28, LAVENDER_PANEL);
  const fin = c.r.financials;

  const top = [
    { icon: "euro", title: "Chiffre d'affaires total", value: eur(asNum(fin.ca_total)) },
    {
      icon: "handcoin",
      title: "Commission à payer - stock PKG",
      value: eur(asNum(fin.commissions_pkg) ?? 0),
    },
    {
      icon: "handcoin2",
      title: "Commission à payer - référencement",
      value: eur(asNum(fin.commissions)),
    },
  ];
  const cwT = 552,
    chT = 352,
    gapT = 28;
  const x0T = (1920 - (3 * cwT + 2 * gapT)) / 2;
  top.forEach((t, i) => {
    const x = x0T + i * (cwT + gapT);
    rrect(c, x, 240, cwT, chT, 24, WHITE);
    icon(c, t.icon, x + 48, 284, 50);
    txt(c, t.title, x + 48, 360, { size: 26, maxW: cwT - 90 });
    txt(c, t.value, x + 48, 410, { size: 34, font: c.f.bold });
  });

  const bottom = [
    {
      icon: "percent",
      title: "Total des factures avec 2% d'escompte, prélèvement automatique",
      value: eur(asNum(fin.reglement_escompte_2)),
    },
    {
      icon: "receipt",
      title: "Total des factures payées dans les 30 jours, prélèvement automatique",
      value: eur(asNum(fin.reglement_30_sepa)),
    },
    {
      icon: "calendar",
      title: "Total des factures payées dans les 45 jours, prélèvement automatique",
      value: eur(asNum(fin.reglement_45_sepa)),
    },
    {
      icon: "receipt2",
      title: "Total des factures payées dans les 30 jours, virement bancaire",
      value: eur(asNum(fin.reglement_30_classique)),
    },
  ];
  const cwB = 408,
    chB = 358,
    gapB = 26;
  const x0B = (1920 - (4 * cwB + 3 * gapB)) / 2;
  bottom.forEach((b, i) => {
    const x = x0B + i * (cwB + gapB);
    const y = 632;
    rrect(c, x, y, cwB, chB, 24, WHITE);
    icon(c, b.icon, x + 44, y + 40, 46);
    const words = b.title.split(" ");
    let line = "",
      ty = y + 112;
    for (const wd of words) {
      const test = line ? `${line} ${wd}` : wd;
      if (c.f.reg.widthOfTextAtSize(test, 21 * S) > (cwB - 84) * S && line) {
        txt(c, line, x + 44, ty, { size: 21 });
        ty += 28;
        line = wd;
      } else line = test;
    }
    if (line) txt(c, line, x + 44, ty, { size: 21 });
    txt(c, b.value, x + 44, y + 292, { size: 30, font: c.f.bold });
  });
  footerLogos(c);
}

function pageClosing(c: Ctx) {
  newPage(c, WHITE);
  rrect(c, 28, 28, 1864, 1024, 30, LAVENDER_BG);
  const { month, year } = monthYear(c.r.month_label);
  const h = 120 * S;
  const gap = 34 * S;
  const mba = c.logoMba;
  const wMba = (mba.width / mba.height) * h;
  let totalW = wMba;
  let wCl = 0;
  if (c.logoClient) {
    wCl = (c.logoClient.width / c.logoClient.height) * h;
    totalW += wCl + gap;
  }
  let lx = (PAGE_W - totalW) / 2;
  const ly = PAGE_H - 415 * S - h;
  if (c.logoClient) {
    c.page.drawImage(c.logoClient, { x: lx, y: ly, width: wCl, height: h });
    lx += wCl + gap;
  }
  c.page.drawImage(mba, { x: lx, y: ly, width: wMba, height: h });

  txt(c, "R A P P O R T   M E N S U E L", 960, 585, { size: 62, align: "center" });
  txt(c, month, 118, 930, { size: 44, font: c.f.med });
  txt(c, year, 1842, 930, { size: 44, font: c.f.med, align: "right" });
}

// ---------------------------------------------------------------------------
// Entrée principale
// ---------------------------------------------------------------------------
export async function renderDesignReportPdf(data: ReportData): Promise<Uint8Array> {
  const r = data.context;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const f: Fonts = {
    reg: await doc.embedFont(Buffer.from(FONTS.regular, "base64"), { subset: true }),
    med: await doc.embedFont(Buffer.from(FONTS.medium, "base64"), { subset: true }),
    semi: await doc.embedFont(Buffer.from(FONTS.semibold, "base64"), { subset: true }),
    bold: await doc.embedFont(Buffer.from(FONTS.bold, "base64"), { subset: true }),
    xbold: await doc.embedFont(Buffer.from(FONTS.extrabold, "base64"), { subset: true }),
  };

  const icons: Record<string, PDFImage> = {};
  for (const [k, v] of Object.entries(ICONS)) {
    icons[k] = await doc.embedPng(Buffer.from(v, "base64"));
  }

  const clientKey = Object.keys(CLIENT_ASSETS).find((k) =>
    (r.client.logo_text || r.client.display_name || "").toUpperCase().includes(k)
  );
  const clientAssets = (clientKey ? CLIENT_ASSETS[clientKey] : undefined) ?? {};

  const logoMba = await doc.embedPng(Buffer.from(IMAGES.logoMba, "base64"));
  const logoClient = clientAssets.logo
    ? await doc.embedPng(Buffer.from(clientAssets.logo, "base64"))
    : null;
  const cover = clientAssets.coverJpg
    ? await doc.embedJpg(Buffer.from(clientAssets.coverJpg, "base64"))
    : null;

  const c: Ctx = {
    doc,
    page: null as unknown as PDFPage,
    f,
    icons,
    logoClient,
    logoMba,
    cover,
    r,
  };

  const g = r.logistics.geodis;
  const gl = r.logistics.gls;

  pageCover(c);
  pageKpi(c);
  pageArticles(c);
  pageStock(c);
  cardsPage(c, 5, "SOMMAIRE", [
    {
      icon: "pin",
      title: "Restaurants livrés",
      lines: [
        { text: nf(r.logistics.restaurants_livres), big: true },
        { text: `Dont Corner Wasabi : ${nf(r.logistics.corner_wasabi)}` },
      ],
    },
    {
      icon: "box",
      title: "Total commandes",
      lines: [{ text: nf(r.logistics.total_commandes), big: true }],
    },
    {
      icon: "grid",
      title: "Total cartons",
      lines: [{ text: nf(r.logistics.total_cartons), big: true }],
    },
    {
      icon: "bag",
      title: "Total poids",
      lines: [{ text: `${nf(r.logistics.total_poids, 2)} Kg`, big: true }],
    },
    {
      icon: "trucks",
      title: "Répartition commandes GEODIS/GLS",
      lines: [
        {
          text:
            r.logistics.geodis_share === null
              ? "-"
              : `${nf(r.logistics.geodis_share)}% / ${nf(r.logistics.gls_share)}%`,
          big: true,
        },
      ],
    },
  ]);
  cardsPage(c, 6, "GEODIS", [
    {
      icon: "pin",
      title: "Restaurants livrés",
      lines: [
        { text: nf(g.restaurants_livres), big: true },
        { text: `Dont Corner Wasabi : ${nf(g.corner_wasabi_count)}` },
      ],
    },
    {
      icon: "box",
      title: "Total commandes",
      lines: [
        { text: nf(g.total_commandes), big: true },
        { text: `Moyenne/jours : ${nf(g.moyenne_jours, 1)}` },
      ],
    },
    {
      icon: "grid",
      title: "Total cartons",
      lines: [
        { text: nf(g.total_cartons), big: true },
        { text: `Moyenne/cmds : ${nf(g.moyenne_cmds_cartons, 2)}` },
      ],
    },
    {
      icon: "bag",
      title: "Total poids",
      lines: [
        { text: `${nf(g.total_poids, 2)} KG`, big: true },
        { text: `Moyenne/cmds : ${nf(g.moyenne_cmds_poids, 2)} KG` },
      ],
    },
    {
      icon: "clock",
      title: "Respect horaires",
      lines: [
        { text: "Avant 12:00" },
        { text: pct(g.respect_horaires_12h), big: true },
        { text: "Avant 11:00" },
        { text: pct(g.respect_horaires_11h, 2), big: true },
      ],
    },
  ]);
  perfHeader(c, 7, "GEODIS MESSAGERIE :");
  perfPanel(
    c,
    58,
    "France :",
    g.france.rate,
    [
      { label: "Total commandes :", value: nf(g.france.total_commandes) },
      { label: "Livrées :", value: nf(g.france.livrees) },
    ],
    {
      title: "Respect délais jour",
      bars: [
        {
          label: "<=A-C",
          navy: g.france.delay_buckets?.le_48h ?? 0,
          pink: g.france.delay_buckets?.total ?? 0,
        },
        { label: "=A-D", navy: g.france.delay_buckets?.j_72h ?? 0, pink: 0 },
        { label: ">A-D+", navy: g.france.delay_buckets?.plus_72h ?? 0, pink: 0 },
      ],
    }
  );
  const be = g.belgique_lux;
  const beRep = be.by_country ?? {};
  perfPanel(
    c,
    980,
    "Belgique / Luxembourg :",
    be.rate,
    [
      { label: "Total commandes :", value: nf(be.total_commandes) },
      { label: "Livrées :", value: nf(be.livrees) },
      {
        label: "Répartition BE / LU / CH :",
        value: `${beRep["BE"] ?? 0}/ ${beRep["LU"] ?? 0}/ ${beRep["CH"] ?? 0}`,
      },
    ],
    {
      title: "Respect délais jour",
      bars: [
        {
          label: "<=A-C",
          navy: be.delay_buckets?.le_48h ?? 0,
          pink: be.delay_buckets?.total ?? 0,
        },
        { label: "=A-D", navy: be.delay_buckets?.j_72h ?? 0, pink: 0 },
        { label: ">A-D+", navy: be.delay_buckets?.plus_72h ?? 0, pink: 0 },
      ],
    }
  );
  perfHeader(c, 8, "GEODIS autres :");
  perfPanel(
    c,
    58,
    "Express :",
    g.express.rate,
    [
      { label: "Total commandes :", value: nf(g.express.total_commandes) },
      { label: "Livrées :", value: nf(g.express.livrees) },
    ],
    g.express.total_commandes > 0
      ? {
          title: "Délais livraison :",
          bars: [
            { label: "24H", navy: g.express_delay.within_24h, pink: g.express_delay.total },
            {
              label: ">24H",
              navy: Math.max(g.express_delay.total - g.express_delay.within_24h, 0),
              pink: 0,
            },
          ],
        }
      : null
  );
  perfPanel(
    c,
    980,
    "Affrètement :",
    g.affretement.total_commandes > 0 ? g.affretement.rate : null,
    [
      { label: "Total commandes :", value: nf(g.affretement.total_commandes) },
      { label: "Livrées :", value: nf(g.affretement.livrees) },
    ],
    null
  );
  cardsPage(c, 9, "GLS", [
    {
      icon: "pin",
      title: "Restaurants livrés",
      lines: [
        { text: nf(gl.restaurants_livres), big: true },
        { text: `Dont Corner Wasabi : ${nf(gl.corner_wasabi_count)}` },
      ],
    },
    {
      icon: "box",
      title: "Total commandes",
      lines: [
        { text: nf(gl.total_commandes), big: true },
        { text: `Moyenne/jours : ${nf(gl.moyenne_jours, 1)}` },
      ],
    },
    {
      icon: "grid",
      title: "Total cartons",
      lines: [
        { text: nf(gl.total_cartons), big: true },
        { text: `Moyenne/cmds : ${nf(gl.moyenne_cmds_cartons, 2)}` },
      ],
    },
    {
      icon: "bag",
      title: "Total poids",
      lines: [
        { text: `${nf(gl.total_poids, 2)} KG`, big: true },
        { text: `Moyenne/cmds : ${nf(gl.moyenne_cmds_poids, 2)} kg` },
      ],
    },
  ]);
  perfHeader(c, 10, "GLS :");
  const glsFr = gl.by_country?.["FR"];
  const glsBe = gl.by_country?.["BE"] ?? 0;
  const glsLu = gl.by_country?.["LU"] ?? 0;
  const frS = gl.fr ?? null;
  const euS = gl.europe ?? null;
  const zoneBars = (z: { buckets: { label: string; livre: number; prevu: number }[] } | null) =>
    z ? z.buckets.map((b) => ({ label: b.label, navy: b.livre, pink: b.prevu })) : [];
  perfPanel(
    c,
    58,
    "France :",
    frS?.rate ?? null,
    [
      { label: "Total colis :", value: frS ? nf(frS.total) : glsFr === undefined ? "-" : nf(glsFr) },
      ...(frS ? [{ label: "Livrées :", value: nf(frS.livrees) }] : []),
    ],
    { title: "Respect délais jour", bars: zoneBars(frS) }
  );
  perfPanel(
    c,
    980,
    "Europe :",
    euS?.rate ?? null,
    [
      { label: "Total colis :", value: euS ? nf(euS.total) : nf(glsBe + glsLu) },
      ...(euS ? [{ label: "Livrées :", value: nf(euS.livrees) }] : []),
      { label: "Répartition BE / LU :", value: `${nf(glsBe)} / ${nf(glsLu)}` },
    ],
    { title: "Respect délais jour", bars: zoneBars(euS) }
  );
  pageFinancials(c);
  pageClosing(c);

  return await doc.save();
}
