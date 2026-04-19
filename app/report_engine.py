"""
report_engine.py — Moteur de calcul des KPIs du rapport mensuel MBA Green.

Entrées : 4-5 fichiers uploadés pour un client donné (ex. Pokawa)
Sortie  : un dictionnaire structuré contenant tous les KPIs du rapport,
          prêt à être injecté dans un template PDF ou affiché dans l'UI.

Architecture : une classe `ClientReportBuilder` avec un fichier de config
par client (patterns de filtre, règles de parsing, etc.) → multi-tenant facile.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import pandas as pd


# ============================================================
# Configuration par client
# ============================================================

@dataclass
class ClientConfig:
    """Config propre à chaque client pour le matching et le parsing."""
    name: str                                # Nom affiché ("Pokawa")
    geodis_destinataire_pattern: str         # Pattern regex pour filtrer GEODIS
    gls_reference_pattern: str               # Pattern regex pour filtrer GLS
    sales_customer_pattern: str              # Pattern pour filtrer les ventes NetSuite
    corner_wasabi_pattern: Optional[str] = None  # Sous-filtre "corner Wasabi"


CLIENTS = {
    "pokawa": ClientConfig(
        name="Pokawa",
        geodis_destinataire_pattern=r"POKAWA",
        gls_reference_pattern=r"Pokawa",
        sales_customer_pattern=r"Pokawa",
        corner_wasabi_pattern=r"WASABI|Wasabi",
    ),
    # Ajouter ici les autres clients au fur et à mesure
    # "krousty": ClientConfig(...)
}


# ============================================================
# Structures de sortie
# ============================================================

@dataclass
class KeyFigures:
    """Bloc 1 — Facteurs clés."""
    nb_skus: int = 0
    total_pieces: int = 0                    # Sum Quantity (pièces unitaires)
    ca_ht: float = 0.0                       # Sum Amount
    nb_orders: int = 0                       # Nb SO distincts
    nb_cartons: int = 0                      # GEODIS parsé + GLS lignes
    delivery_success_rate: float = 0.0       # % livraisons réussies


@dataclass
class ArticleLine:
    """Une ligne de la table articles (bloc 3)."""
    sku: str
    description: str
    forecast: float
    consumption: float
    performance_pct: Optional[float]         # None si prévision=0
    unit_price: float
    ca_forecast: float
    ca_actual: float


@dataclass
class ArticlesPerformance:
    """Bloc 3 — Performance articles."""
    lines: list[ArticleLine] = field(default_factory=list)
    total_ca_forecast: float = 0.0           # CA attendu
    total_ca_actual: float = 0.0             # CA actuel (via facturation)
    performance_rate: float = 0.0            # total_ca_actual / total_ca_forecast


@dataclass
class StockLine:
    """Une ligne de la table stock par semaine (bloc 4)."""
    sku: str
    on_hand: float
    forecasts: dict[int, float]              # semaine → prévision
    stocks: dict[int, float]                 # semaine → stock projeté
    in_transit: dict[int, float]             # semaine → en transit


@dataclass
class StockStatus:
    """Bloc 4 — Statut articles."""
    lines: list[StockLine] = field(default_factory=list)
    weeks: list[int] = field(default_factory=list)


@dataclass
class LogisticsSummary:
    """Bloc 5 — Sommaire logistique global."""
    nb_restaurants: int = 0
    nb_restaurants_wasabi: int = 0
    nb_orders: int = 0
    nb_cartons: int = 0
    total_weight_kg: float = 0.0
    split_geodis_pct: float = 0.0            # % commandes via GEODIS
    split_gls_pct: float = 0.0


@dataclass
class GeodisPerformance:
    """Bloc 6 — Performance GEODIS détaillée."""
    # Sommaire
    nb_restaurants: int = 0
    nb_restaurants_wasabi: int = 0
    nb_orders: int = 0
    nb_cartons: int = 0
    total_weight_kg: float = 0.0
    # Respect horaires messagerie
    pct_before_12h: float = 0.0
    pct_before_11h: float = 0.0
    # Détail par service
    messagerie_fr_orders: int = 0
    messagerie_fr_delivered: int = 0
    messagerie_eu_orders: int = 0
    messagerie_eu_delivered: int = 0
    messagerie_eu_split: dict = field(default_factory=dict)   # {"BE": n, "LU": n, "CH": n}
    express_orders: int = 0
    express_delivered: int = 0
    affretement_orders: int = 0
    affretement_delivered: int = 0


@dataclass
class GlsPerformance:
    """Bloc 6bis — Performance GLS."""
    nb_restaurants: int = 0
    nb_restaurants_wasabi: int = 0
    nb_orders: int = 0
    nb_cartons: int = 0
    total_weight_kg: float = 0.0
    # France
    fr_parcels: int = 0
    fr_delivered: int = 0
    fr_returned: int = 0
    # Europe
    eu_parcels: int = 0
    eu_delivered: int = 0
    eu_split: dict = field(default_factory=dict)


@dataclass
class FinancialData:
    """Bloc 7 — Données financières."""
    ca_total: float = 0.0
    commission_stock_pkg: float = 0.0        # Manuel
    commission_referencement: float = 0.0    # Manuel
    paiement_sepa_30j: float = 0.0
    paiement_sepa_45j: float = 0.0
    paiement_sepa_escompte_2pct: float = 0.0
    paiement_virement_30j: float = 0.0


@dataclass
class MonthlyReport:
    """Rapport mensuel complet pour un client."""
    client: str
    month: str                               # "Février 2026"
    key_figures: KeyFigures = field(default_factory=KeyFigures)
    articles: ArticlesPerformance = field(default_factory=ArticlesPerformance)
    stock: StockStatus = field(default_factory=StockStatus)
    logistics_summary: LogisticsSummary = field(default_factory=LogisticsSummary)
    geodis: GeodisPerformance = field(default_factory=GeodisPerformance)
    gls: GlsPerformance = field(default_factory=GlsPerformance)
    financial: FinancialData = field(default_factory=FinancialData)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


# ============================================================
# Helpers parsing
# ============================================================

def _parse_geodis_cartons(ref: str) -> int:
    """Extrait le nb de cartons depuis 'SO41395 - 9 COLIS' ou 'SO41464 - 6'."""
    if pd.isna(ref):
        return 0
    m = re.search(r"-\s*(\d+)", str(ref))
    return int(m.group(1)) if m else 0


# ============================================================
# Moteur de calcul principal
# ============================================================

class ClientReportBuilder:
    """
    Construit un MonthlyReport à partir des fichiers sources pour un client.

    Usage:
        builder = ClientReportBuilder(CLIENTS["pokawa"], "Février 2026")
        builder.load_sales(path_to_commissions_file)
        builder.load_articles_performance(path_to_data_file)
        builder.load_stock_status(path_to_breakdown_file)
        builder.load_geodis(path_to_geodis_file)
        builder.load_gls(path_to_gls_file)
        builder.load_financial_manual(commissions_dict)
        report = builder.build()
    """

    def __init__(self, config: ClientConfig, month: str):
        self.config = config
        self.month = month
        self.report = MonthlyReport(client=config.name, month=month)
        # Dataframes bruts
        self._df_sales: Optional[pd.DataFrame] = None
        self._df_articles: Optional[pd.DataFrame] = None
        self._df_stock_sheets: dict[str, pd.DataFrame] = {}
        self._df_geodis: Optional[pd.DataFrame] = None
        self._df_gls: Optional[pd.DataFrame] = None
        # Overrides financiers (saisis manuellement par l'utilisateur)
        self._financial_overrides: dict = {}

    # ---------- Ingestion ----------

    def load_sales(self, path: Path, sheet_name: Optional[str] = None):
        """Charge le fichier 'Commissions_<client>_<mois>.xlsx' (onglet Ventes)."""
        if sheet_name is None:
            # Tenter de deviner la feuille
            xl = pd.ExcelFile(path)
            sheet_name = next((s for s in xl.sheet_names if "vente" in s.lower()), xl.sheet_names[0])
        self._df_sales = pd.read_excel(path, sheet_name=sheet_name)

    def load_articles_performance(self, path: Path):
        """Charge le fichier '<CLIENT>_DATA_<MOIS>.xlsx' (table prévisions/consommation)."""
        df = pd.read_excel(path)
        df = df[df["Articles"].notna()].copy()
        # Normaliser les noms de colonnes (espaces potentiels)
        df.columns = [c.strip() for c in df.columns]
        self._df_articles = df

    def load_stock_status(self, path: Path, sheet_name: Optional[str] = None):
        """Charge le fichier 'Client_Report_Breakdown_<MOIS>.xlsx' (onglet client)."""
        if sheet_name is None:
            sheet_name = self.config.name.upper()
        try:
            self._df_stock_sheets[sheet_name] = pd.read_excel(path, sheet_name=sheet_name, header=None)
        except ValueError:
            self.report.warnings.append(f"Onglet '{sheet_name}' introuvable dans le fichier stock.")

    def load_geodis(self, path: Path):
        """Charge le fichier GEODIS multi-clients et filtre sur ce client."""
        df = pd.read_excel(path, header=1)
        mask = df["Nom du destinataire"].str.contains(
            self.config.geodis_destinataire_pattern, case=False, na=False
        )
        self._df_geodis = df[mask].copy()

    def load_gls(self, path: Path):
        """Charge le CSV GLS multi-clients et filtre sur ce client."""
        df = pd.read_csv(path, sep=";", encoding="utf-8")
        mask = df["Client Référence"].str.contains(
            self.config.gls_reference_pattern, case=False, na=False
        )
        self._df_gls = df[mask].copy()

    def load_financial_manual(self, overrides: dict):
        """
        Saisie manuelle pour les champs non-calculables :
          - commission_stock_pkg
          - commission_referencement
        + éventuellement overrides des splits de paiement.
        """
        self._financial_overrides = overrides or {}

    # ---------- Calculs par bloc ----------

    def _compute_key_figures(self):
        kf = self.report.key_figures
        if self._df_sales is not None:
            kf.nb_skus = int(self._df_sales["Item Name"].nunique())
            kf.total_pieces = int(self._df_sales["Quantity"].sum())
            kf.ca_ht = float(self._df_sales["Amount"].sum())
            kf.nb_orders = int(self._df_sales["Sales Order ref"].nunique())
        # Cartons = GEODIS parsé + GLS (nb lignes FDS/EFDS)
        cartons_geodis = 0
        if self._df_geodis is not None:
            parsed = self._df_geodis["Référence1"].apply(_parse_geodis_cartons)
            cartons_geodis = int(parsed.sum())
        cartons_gls = 0
        if self._df_gls is not None:
            cartons_gls = len(self._df_gls)   # 1 ligne = 1 colis facturé
        kf.nb_cartons = cartons_geodis + cartons_gls
        # Taux de succès : livraisons réussies / total
        # On se base pour l'instant sur GEODIS (GLS n'a pas d'état clair dans ce CSV)
        if self._df_geodis is not None and len(self._df_geodis) > 0:
            livrees = (self._df_geodis["Etat"] == "Livrée").sum()
            kf.delivery_success_rate = 100.0 * livrees / len(self._df_geodis)

    def _compute_articles(self):
        if self._df_articles is None:
            return
        ap = self.report.articles
        for _, row in self._df_articles.iterrows():
            forecast = row.get("Prévisions", 0) or 0
            consumption = row.get("Cons. FEB", 0) or 0  # ⚠️ dépend du mois — à généraliser
            perf = row.get("Cons vs Prévisions")
            perf_pct = float(perf) * 100 if pd.notna(perf) else None
            ap.lines.append(ArticleLine(
                sku=str(row["Articles"]),
                description=str(row.get("Description", "")),
                forecast=float(forecast),
                consumption=float(consumption),
                performance_pct=perf_pct,
                unit_price=float(row.get("Prix vente unitaire", 0) or 0),
                ca_forecast=float(row.get("Prévison - C.A", 0) or 0),
                ca_actual=float(row.get("Consommation - C.A", 0) or 0),
            ))
        ap.total_ca_forecast = sum(l.ca_forecast for l in ap.lines)
        # CA actuel = CA facturé réel (depuis key_figures), pas la somme des CA par SKU
        # Car les prix facturés varient selon franchisés (remises Pokawa Liège etc.)
        ap.total_ca_actual = self.report.key_figures.ca_ht
        if ap.total_ca_forecast > 0:
            ap.performance_rate = 100.0 * ap.total_ca_actual / ap.total_ca_forecast

    def _compute_stock_status(self):
        """
        Le fichier Client_Report_Breakdown a cette structure :
        - Ligne 0 : nom client + répartition mois (March/Avril)
        - Ligne 1 : headers (Item, Stock, On Hand, 10, 11, 12, ...)
        - Lignes 2+ : pour chaque SKU, 3 lignes (Forecast, Stock, In Transit)
        """
        sheet_name = self.config.name.upper()
        df = self._df_stock_sheets.get(sheet_name)
        if df is None or df.empty:
            return
        ss = self.report.stock

        # Les semaines sont en ligne 1, colonnes 3+
        week_row = df.iloc[1]
        weeks = []
        for v in week_row.iloc[3:]:
            try:
                weeks.append(int(v))
            except (ValueError, TypeError):
                pass
        ss.weeks = weeks

        # Parcourir les lignes par blocs de 3 à partir de la ligne 2
        current_line = None
        for i in range(2, len(df)):
            row = df.iloc[i]
            a, b = row.iloc[0], row.iloc[1]
            if pd.notna(a):
                # Nouvelle ligne SKU
                if current_line:
                    ss.lines.append(current_line)
                current_sku = str(a).strip()
                current_line = StockLine(
                    sku=current_sku, on_hand=0.0,
                    forecasts={}, stocks={}, in_transit={}
                )
            if current_line is None:
                continue
            kind = str(b).strip().lower() if pd.notna(b) else ""
            on_hand = row.iloc[2]
            if kind.startswith("forecast"):
                for j, w in enumerate(weeks):
                    val = row.iloc[3 + j] if (3 + j) < len(row) else None
                    current_line.forecasts[w] = float(val) if pd.notna(val) else 0.0
            elif kind.startswith("stock"):
                current_line.on_hand = float(on_hand) if pd.notna(on_hand) else 0.0
                for j, w in enumerate(weeks):
                    val = row.iloc[3 + j] if (3 + j) < len(row) else None
                    current_line.stocks[w] = float(val) if pd.notna(val) else 0.0
            elif "transit" in kind:
                for j, w in enumerate(weeks):
                    val = row.iloc[3 + j] if (3 + j) < len(row) else None
                    current_line.in_transit[w] = float(val) if pd.notna(val) else 0.0
        if current_line:
            ss.lines.append(current_line)

    def _compute_geodis(self):
        if self._df_geodis is None:
            return
        df = self._df_geodis
        g = self.report.geodis

        # Sommaire
        g.nb_restaurants = df["Nom du destinataire"].nunique()
        if self.config.corner_wasabi_pattern:
            wasabi = df[df["Nom du destinataire"].str.contains(
                self.config.corner_wasabi_pattern, case=False, na=False)]
            g.nb_restaurants_wasabi = wasabi["Nom du destinataire"].nunique()
        g.nb_orders = len(df)  # 1 ligne GEODIS = 1 expédition = 1 SO
        g.nb_cartons = int(df["Référence1"].apply(_parse_geodis_cartons).sum())
        g.total_weight_kg = float(df["Poids"].sum())

        # Par service
        mess_fr_mask = df["Prestation"].str.contains("Messagerie France", case=False, na=False)
        mess_eu_mask = df["Prestation"].str.contains("Messagerie Europe", case=False, na=False)
        express_mask = df["Prestation"].str.contains("Express", case=False, na=False)
        affret_mask = df["Prestation"].str.contains("Affrètement", case=False, na=False)

        mess_fr = df[mess_fr_mask]
        mess_eu = df[mess_eu_mask]
        express = df[express_mask]
        affret = df[affret_mask]

        g.messagerie_fr_orders = len(mess_fr)
        g.messagerie_fr_delivered = (mess_fr["Etat"] == "Livrée").sum()
        g.messagerie_eu_orders = len(mess_eu)
        g.messagerie_eu_delivered = (mess_eu["Etat"] == "Livrée").sum()
        g.messagerie_eu_split = mess_eu["Pays du destinataire"].value_counts().to_dict()
        g.express_orders = len(express)
        g.express_delivered = (express["Etat"] == "Livrée").sum()
        g.affretement_orders = len(affret)
        g.affretement_delivered = (affret["Etat"] == "Livrée").sum()

        # Respect horaires messagerie FR livrée
        livrees = mess_fr[mess_fr["Etat"] == "Livrée"].copy()
        if len(livrees) > 0:
            livrees["heure_dt"] = pd.to_datetime(livrees["Heure"], format="%H:%M", errors="coerce")
            heures = livrees["heure_dt"].dt.hour
            g.pct_before_12h = 100.0 * (heures < 12).sum() / len(livrees)
            g.pct_before_11h = 100.0 * (heures < 11).sum() / len(livrees)

    def _compute_gls(self):
        if self._df_gls is None:
            return
        df = self._df_gls
        gls = self.report.gls

        gls.nb_restaurants = df["Client Référence"].nunique()
        if self.config.corner_wasabi_pattern:
            wasabi = df[df["Client Référence"].str.contains(
                self.config.corner_wasabi_pattern, case=False, na=False)]
            gls.nb_restaurants_wasabi = wasabi["Client Référence"].nunique()

        # nb orders = SO NetSuite distincts (extraits de Client Référence 1)
        def _extract_so(s):
            if pd.isna(s):
                return None
            m = re.search(r"(SO\d+)", str(s))
            return m.group(1) if m else None

        df["_so_parsed"] = df["Client Référence 1"].apply(_extract_so)
        gls.nb_orders = df["_so_parsed"].nunique()
        # cartons = lignes de facturation (1 ligne = 1 colis tarifé)
        gls.nb_cartons = len(df)

        # FR vs EU
        fr = df[df["Code Pays"] == "FR"]
        eu = df[df["Code Pays"] != "FR"]
        gls.fr_parcels = len(fr)
        gls.fr_delivered = len(fr)  # Pas d'état dans le fichier GLS → on considère livré
        gls.fr_returned = 0
        gls.eu_parcels = len(eu)
        gls.eu_delivered = len(eu)
        gls.eu_split = eu["Code Pays"].value_counts().to_dict()

    def _compute_logistics_summary(self):
        ls = self.report.logistics_summary
        g = self.report.geodis
        gls = self.report.gls
        # Restaurants livrés uniques (GEODIS + GLS fusionnés)
        ls.nb_restaurants = (
            self._df_sales["End Customer"].nunique() if self._df_sales is not None else 0
        )
        ls.nb_restaurants_wasabi = g.nb_restaurants_wasabi + gls.nb_restaurants_wasabi
        ls.nb_orders = g.nb_orders + gls.nb_orders
        ls.nb_cartons = self.report.key_figures.nb_cartons
        ls.total_weight_kg = g.total_weight_kg + 0  # GLS n'a pas de poids dans ce fichier
        if ls.nb_orders > 0:
            ls.split_geodis_pct = 100.0 * g.nb_orders / ls.nb_orders
            ls.split_gls_pct = 100.0 * gls.nb_orders / ls.nb_orders

    def _compute_financial(self):
        f = self.report.financial
        f.ca_total = self.report.key_figures.ca_ht
        # Ces deux valeurs sont saisies manuellement
        f.commission_stock_pkg = float(self._financial_overrides.get("commission_stock_pkg", 0))
        f.commission_referencement = float(self._financial_overrides.get("commission_referencement", 0))
        # Splits de paiement : soit saisie manuelle, soit calcul via colonne Bank List
        # Par défaut, reprendre les overrides
        f.paiement_sepa_30j = float(self._financial_overrides.get("paiement_sepa_30j", 0))
        f.paiement_sepa_45j = float(self._financial_overrides.get("paiement_sepa_45j", 0))
        f.paiement_sepa_escompte_2pct = float(
            self._financial_overrides.get("paiement_sepa_escompte_2pct", 0))
        f.paiement_virement_30j = float(self._financial_overrides.get("paiement_virement_30j", 0))

    def build(self) -> MonthlyReport:
        """Exécute tous les calculs et retourne le rapport complet."""
        # ORDRE IMPORTANT : key_figures avant articles (pour CA actuel)
        self._compute_key_figures()
        self._compute_articles()
        self._compute_stock_status()
        self._compute_geodis()
        self._compute_gls()
        self._compute_logistics_summary()
        self._compute_financial()
        return self.report
