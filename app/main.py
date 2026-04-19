"""
main.py — API MBA Green Rapports (version hybride pour Make).

UN SEUL endpoint : POST /compute
    Reçoit les 5 fichiers sources + des paramètres manuels
    Retourne un JSON plat avec tous les KPIs calculés

Usage Make :
    - Module "HTTP > Make a request"
    - Body: multipart/form-data avec les 5 fichiers
    - Headers: X-API-Key: <votre clé>

Déploiement Railway :
    - Procfile: web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    - Variables: API_KEY=<votre clé secrète>
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .report_engine import ClientReportBuilder, CLIENTS


API_KEY = os.environ.get("API_KEY", "dev-key-change-me")

app = FastAPI(
    title="MBA Green Rapports API",
    description="Calcule les KPIs mensuels à partir des fichiers sources.",
    version="1.0.0",
)

# Autoriser Make à appeler depuis tous les domaines
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def check_api_key(x_api_key: Optional[str] = Header(None)):
    """Vérifie la clé API passée dans le header X-API-Key."""
    if not x_api_key or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")


@app.get("/")
async def root():
    return {
        "service": "MBA Green Rapports API",
        "version": "1.0.0",
        "endpoints": {
            "POST /compute": "Calcule les KPIs d'un rapport mensuel",
            "GET /health": "Healthcheck",
            "GET /clients": "Liste des clients configurés",
        },
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/clients")
async def list_clients():
    """Liste les clients configurés (utile pour Make pour faire un picker)."""
    return {key: cfg.name for key, cfg in CLIENTS.items()}


@app.post("/compute")
async def compute(
    x_api_key: Optional[str] = Header(None),
    client: str = Form(..., description="Clé du client (ex: 'pokawa')"),
    month: str = Form(..., description="Mois au format 'Février 2026'"),
    sales: Optional[UploadFile] = File(None, description="Fichier ventes/commissions (xlsx)"),
    articles: Optional[UploadFile] = File(None, description="Fichier performance articles (xlsx)"),
    stock: Optional[UploadFile] = File(None, description="Fichier stock breakdown (xlsx)"),
    geodis: Optional[UploadFile] = File(None, description="Fichier suivi GEODIS (xlsx)"),
    gls: Optional[UploadFile] = File(None, description="Fichier GLS annexes (csv)"),
    commission_stock_pkg: float = Form(0, description="Commission stock PKG (€ HT)"),
    commission_referencement: float = Form(0, description="Commission référencement (€ HT)"),
    paiement_sepa_30j: float = Form(0),
    paiement_sepa_45j: float = Form(0),
    paiement_sepa_escompte_2pct: float = Form(0),
    paiement_virement_30j: float = Form(0),
):
    """
    Calcule tous les KPIs d'un rapport mensuel à partir des fichiers fournis.

    Retour : JSON plat avec tous les indicateurs, formaté pour être consommé
    directement par Make et écrit dans Google Sheets.
    """
    check_api_key(x_api_key)

    if client not in CLIENTS:
        raise HTTPException(status_code=400, detail=f"Client inconnu. Disponibles: {list(CLIENTS.keys())}")

    client_cfg = CLIENTS[client]
    builder = ClientReportBuilder(client_cfg, month)

    # Sauvegarder les fichiers uploadés dans un dossier temporaire et les charger
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_p = Path(tmpdir)

        async def save(upload: UploadFile, name: str) -> Optional[Path]:
            if upload is None or not upload.filename:
                return None
            dest = tmpdir_p / name
            content = await upload.read()
            dest.write_bytes(content)
            return dest

        sales_p = await save(sales, "sales.xlsx")
        articles_p = await save(articles, "articles.xlsx")
        stock_p = await save(stock, "stock.xlsx")
        geodis_p = await save(geodis, "geodis.xlsx")
        gls_p = await save(gls, "gls.csv")

        try:
            if sales_p: builder.load_sales(sales_p)
            if articles_p: builder.load_articles_performance(articles_p)
            if stock_p: builder.load_stock_status(stock_p)
            if geodis_p: builder.load_geodis(geodis_p)
            if gls_p: builder.load_gls(gls_p)

            builder.load_financial_manual({
                "commission_stock_pkg": commission_stock_pkg,
                "commission_referencement": commission_referencement,
                "paiement_sepa_30j": paiement_sepa_30j,
                "paiement_sepa_45j": paiement_sepa_45j,
                "paiement_sepa_escompte_2pct": paiement_sepa_escompte_2pct,
                "paiement_virement_30j": paiement_virement_30j,
            })

            report = builder.build()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Erreur de traitement : {str(e)}")

    # Aplatir la sortie en JSON simple pour faciliter l'usage dans Make
    return flatten_report(report, client_cfg.name, month)


def flatten_report(report, client_name: str, month: str) -> dict:
    """
    Transforme le MonthlyReport en dictionnaire plat prêt pour Make/Sheets.

    Les clés sont directement utilisables comme balises {{key}} dans Slides.
    """
    kf = report.key_figures
    a = report.articles
    ls = report.logistics_summary
    g = report.geodis
    gls = report.gls
    fin = report.financial

    # Helpers pour forcer les types natifs Python (évite numpy.int64/float64)
    def i(x):  # int natif
        return int(x) if x is not None else 0
    def f(x, d=2):  # float natif arrondi
        return round(float(x), d) if x is not None else 0.0
    def s(x):  # str natif
        return str(x) if x is not None else ""

    flat = {
        # Metadata
        "client": client_name,
        "month": month,
        "generated_at": _now_iso(),

        # Bloc 1 : Facteurs clés
        "nb_skus": i(kf.nb_skus),
        "total_pieces": i(kf.total_pieces),
        "ca_ht": f(kf.ca_ht),
        "ca_ht_formatted": _fr_currency(kf.ca_ht),
        "nb_orders": i(kf.nb_orders),
        "nb_cartons": i(kf.nb_cartons),
        "delivery_success_rate": f(kf.delivery_success_rate),
        "delivery_success_rate_formatted": f"{float(kf.delivery_success_rate):.0f} %",

        # Bloc 2 : Performance articles
        "ca_forecast": f(a.total_ca_forecast),
        "ca_forecast_formatted": _fr_currency(a.total_ca_forecast),
        "ca_actual": f(a.total_ca_actual),
        "ca_actual_formatted": _fr_currency(a.total_ca_actual),
        "performance_rate": f(a.performance_rate),
        "performance_rate_formatted": f"{float(a.performance_rate):.2f} %".replace(".", ","),

        # Bloc 3 : Logistique sommaire
        "nb_restaurants": i(ls.nb_restaurants),
        "nb_restaurants_wasabi": i(ls.nb_restaurants_wasabi),
        "total_weight_kg": f(ls.total_weight_kg),
        "total_weight_formatted": f"{float(ls.total_weight_kg):,.2f} kg".replace(",", " ").replace(".", ","),
        "split_geodis_pct": f(ls.split_geodis_pct, 0),
        "split_gls_pct": f(ls.split_gls_pct, 0),
        "split_formatted": f"{float(ls.split_geodis_pct):.0f}% / {float(ls.split_gls_pct):.0f}%",

        # Bloc 4 : GEODIS
        "geodis_nb_restaurants": i(g.nb_restaurants),
        "geodis_nb_restaurants_wasabi": i(g.nb_restaurants_wasabi),
        "geodis_nb_orders": i(g.nb_orders),
        "geodis_nb_cartons": i(g.nb_cartons),
        "geodis_total_weight_kg": f(g.total_weight_kg),
        "geodis_total_weight_formatted": f"{float(g.total_weight_kg):,.2f} KG".replace(",", " ").replace(".", ","),
        "geodis_pct_before_12h": f(g.pct_before_12h, 1),
        "geodis_pct_before_12h_formatted": f"{float(g.pct_before_12h):.0f}%",
        "geodis_pct_before_11h": f(g.pct_before_11h),
        "geodis_pct_before_11h_formatted": f"{float(g.pct_before_11h):.2f}%".replace(".", ","),
        "geodis_messagerie_fr_orders": i(g.messagerie_fr_orders),
        "geodis_messagerie_fr_delivered": i(g.messagerie_fr_delivered),
        "geodis_messagerie_eu_orders": i(g.messagerie_eu_orders),
        "geodis_messagerie_eu_delivered": i(g.messagerie_eu_delivered),
        "geodis_messagerie_eu_split": ", ".join(f"{k} {int(v)}" for k, v in (g.messagerie_eu_split or {}).items()),
        "geodis_express_orders": i(g.express_orders),
        "geodis_express_delivered": i(g.express_delivered),
        "geodis_affretement_orders": i(g.affretement_orders),
        "geodis_affretement_delivered": i(g.affretement_delivered),

        # Bloc 5 : GLS
        "gls_nb_restaurants": i(gls.nb_restaurants),
        "gls_nb_restaurants_wasabi": i(gls.nb_restaurants_wasabi),
        "gls_nb_orders": i(gls.nb_orders),
        "gls_nb_cartons": i(gls.nb_cartons),
        "gls_total_weight_kg": f(gls.total_weight_kg),
        "gls_fr_parcels": i(gls.fr_parcels),
        "gls_fr_delivered": i(gls.fr_delivered),
        "gls_fr_returned": i(gls.fr_returned),
        "gls_eu_parcels": i(gls.eu_parcels),
        "gls_eu_delivered": i(gls.eu_delivered),
        "gls_eu_split": ", ".join(f"{k} {int(v)}" for k, v in (gls.eu_split or {}).items()),

        # Bloc 6 : Financier
        "commission_stock_pkg": f(fin.commission_stock_pkg),
        "commission_stock_pkg_formatted": _fr_currency(fin.commission_stock_pkg),
        "commission_referencement": f(fin.commission_referencement),
        "commission_referencement_formatted": _fr_currency(fin.commission_referencement),
        "paiement_sepa_30j": f(fin.paiement_sepa_30j),
        "paiement_sepa_30j_formatted": _fr_currency(fin.paiement_sepa_30j),
        "paiement_sepa_45j": f(fin.paiement_sepa_45j),
        "paiement_sepa_45j_formatted": _fr_currency(fin.paiement_sepa_45j),
        "paiement_sepa_escompte_2pct": f(fin.paiement_sepa_escompte_2pct),
        "paiement_sepa_escompte_2pct_formatted": _fr_currency(fin.paiement_sepa_escompte_2pct),
        "paiement_virement_30j": f(fin.paiement_virement_30j),
        "paiement_virement_30j_formatted": _fr_currency(fin.paiement_virement_30j),
    }

    # Articles détaillés : transformer en liste d'objets simples (types natifs)
    flat["articles_lines"] = [
        {
            "sku": s(line.sku),
            "description": s(line.description)[:50],
            "forecast": f(line.forecast, 1),
            "consumption": f(line.consumption, 0),
            "performance_pct": f(line.performance_pct, 0) if line.performance_pct else None,
            "performance_pct_formatted": f"{int(round(float(line.performance_pct)))}%" if line.performance_pct else "—",
            "unit_price": f(line.unit_price),
            "ca_forecast": f(line.ca_forecast),
            "ca_actual": f(line.ca_actual),
        }
        for line in a.lines
    ]

    # Top 5 SKUs par consommation
    top5 = sorted(a.lines, key=lambda l: float(l.consumption or 0), reverse=True)[:5]
    flat["top5_skus"] = [
        {
            "sku": s(l.sku),
            "consumption": f(l.consumption, 0),
            "performance_pct_formatted": f"{int(round(float(l.performance_pct)))}%" if l.performance_pct else "—",
        }
        for l in top5
    ]

    # Stock lines : liste des SKUs avec leur projection
    flat["stock_lines"] = [
        {
            "sku": s(line.sku),
            "on_hand": f(line.on_hand, 0),
            "weeks": [i(w) for w in report.stock.weeks],
            "forecasts": [f(line.forecasts.get(w, 0), 0) for w in report.stock.weeks],
            "stocks": [f(line.stocks.get(w, 0), 0) for w in report.stock.weeks],
            "in_transit": [f(line.in_transit.get(w, 0), 0) for w in report.stock.weeks],
        }
        for line in report.stock.lines
    ]
    flat["stock_weeks"] = [i(w) for w in report.stock.weeks]

    return flat


def _fr_currency(value) -> str:
    if value is None:
        return "—"
    return f"{value:,.2f} €".replace(",", " ").replace(".", ",")


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")
