// Shared type definitions for the MBA Green report engine port.

export interface ClientConfig {
  display_name: string;
  brand_color: string;
  accent_color: string;
  background_color: string;
  data_feb_file_pattern: string;
  breakdown_sheet_name: string;
  financial_column: string;
  logo_text: string;
  restaurant_name_matches: string[];
  restaurant_name_aliases: string[];
  corner_wasabi_count_manual: number;
  /** NetSuite internal ID of this brand's top-level ("parent") customer
   * record -- every restaurant is a sub-customer under it. Used to filter
   * consumption queries per client. See lib/netsuiteData.ts. */
  netsuite_parent_id: number;
}

export type ClientsConfig = Record<string, ClientConfig>;

export interface ArticleItem {
  code: string;
  description: string;
  forecast: number;
  consumption: number;
  rate: number | null;
  ca_forecast: number;
  ca_consumption: number;
}

export interface ArticlePerformance {
  items: ArticleItem[];
  sku_count: number;
  total_pieces_consumed: number;
  ca_forecast: number;
  ca_actual: number;
  performance_rate: number | null;
}

export interface StockWeek {
  week: number;
  forecast?: number | null;
  stock?: number | null;
  in_transit?: number | null;
}

export interface StockItem {
  code: string;
  on_hand: number | null;
  weeks: StockWeek[];
}

/** Répartition "Respect délais jour" confirmée par Nicolas : écart en jours
 * calendaires entre "Départ" et "Date" (livraison). 1 jour = A->B (24h),
 * 2 jours = A->C (48h), 3 jours = A->D (72h). Le graphique de référence
 * regroupe en 3 barres : "<=A-C" (livré en <=48h, donc B+C), "=A-D"
 * (livré exactement en 72h), ">A-D+" (plus de 72h). Ex. confirmé : Départ
 * 02/02, livré 04/02 (écart de 2 jours) = "A pour C". */
export interface DelayBuckets {
  total: number;
  le_48h: number;
  le_48h_rate: number | null;
  j_72h: number;
  j_72h_rate: number | null;
  plus_72h: number;
  plus_72h_rate: number | null;
}

export interface CountryStats {
  total_commandes: number;
  livrees: number;
  rate: number | null;
  by_country?: Record<string, number>;
  delay_buckets?: DelayBuckets;
}

export interface ServiceStats {
  total_commandes: number;
  livrees: number;
  rate: number | null;
}

export interface GeodisResult {
  restaurant_names: Set<string>;
  restaurants_livres: number;
  total_commandes: number;
  total_cartons: number;
  total_poids: number;
  taux_reussite: number | null;
  france: CountryStats;
  belgique_lux: CountryStats;
  /** Confirmed against the real GEODIS export: "Prestation" column names the
   * service ("Messagerie France...", "Express France...", "Affrètement
   * France..."). Split out here as a supplementary breakdown alongside the
   * country-based one above (mirrors the reference report's "GEODIS autres"
   * page). */
  express: ServiceStats;
  affretement: ServiceStats;
  /** "Livré en 24h" (jours ouvrés, hors week-ends ET jours fériés français) :
   * = 1 jour ouvré si pas de week-end/férié entre Départ et Date (peu
   * importe l'heure), OU 1 jour ouvré avec traversée d'un week-end/férié
   * MAIS livré avant 11:00 ce jour-là (confirmé par Nicolas -- un départ
   * vendredi livré lundi avant 11h compte comme "24h", après 11h non). */
  express_delay: { total: number; within_24h: number; rate: number | null };
  /** total_commandes / nb de jours ouvrés (lun-ven) distincts sur lesquels
   * il y a eu au moins une expédition (colonne "Départ"). Confirmé: 252/20 = 12.6. */
  moyenne_jours: number | null;
  moyenne_cmds_cartons: number | null;
  moyenne_cmds_poids: number | null;
  /** Nb de restaurants distincts dont le nom contient "WASABI" -- confirmé
   * comme la définition réelle de "Corner Wasabi" en croisant le fichier
   * GEODIS (0 restaurant Wasabi) avec la référence. */
  corner_wasabi_count: number;
  /** % de livraisons Messagerie France (heure <= seuil), colonne "Heure".
   * Confirmé pour 12:00 (84% exact) ; 11:00 est une approximation (~1pt
   * d'écart avec la référence, cause exacte non identifiée). */
  respect_horaires_12h: number | null;
  respect_horaires_11h: number | null;
}

export interface GlsResult {
  restaurant_names: Set<string>;
  restaurants_livres: number;
  /** Confirmé: nb de valeurs distinctes de la colonne "Client Référence 2"
   * (276 pour Pokawa Février 2026, correspond exactement à la référence).
   * "Client Référence 1" est presque identique (278) mais légèrement moins
   * précis -- 2 diffère probablement d'une correction de commande. */
  total_commandes: number | null;
  total_cartons: number;
  total_poids: number;
  by_country: Record<string, number>;
  moyenne_jours: number | null;
  moyenne_cmds_cartons: number | null;
  moyenne_cmds_poids: number | null;
  corner_wasabi_count: number;
  /** Stats de livraison par zone (page 10) — calculées depuis les colonnes
   * statut / date_livraison_prevue / date_livraison_reelle de gls_parcels.
   * Optionnelles : absentes si la source ne les fournit pas. */
  fr?: GlsZoneStats | null;
  europe?: GlsZoneStats | null;
}

/** Stats "Respect délais jour" d'une zone GLS (France ou Europe). */
export interface GlsZoneStats {
  total: number;
  livrees: number;
  /** % livrés parmi les colis au statut décidé (livré / problème) ;
   * les colis encore en cours ne comptent pas au dénominateur. */
  rate: number | null;
  /** Barres du graphique : nb de colis livrés (réel) vs prévus par palier
   * de délai en jours ouvrés (France 24H/48H/>48H, Europe 48H/72H/>72H). */
  buckets: { label: string; livre: number; prevu: number }[];
}

export type FinancialsResult = Record<string, unknown>;

export interface ReportFiles {
  geodis: ArrayBuffer;
  gls: ArrayBuffer;
}

export interface ReportContext {
  generated_at: string;
  client: ClientConfig;
  month_label: string;
  kpi: {
    sku_count: number;
    pieces_consumed: number;
    /** Cartons facturés du mois (somme des consommations articles). */
    cartons_consumed?: number | null;
    ca_actual: number;
    ca_forecast: number;
    performance_rate: number | null;
    total_commandes: number | null;
    total_cartons: number;
    taux_reussite: number | null;
  };
  articles: ArticleItem[];
  stock_status: StockItem[];
  logistics: {
    restaurants_livres: number;
    corner_wasabi: number;
    total_commandes: number | null;
    total_cartons: number;
    total_poids: number;
    geodis_share: number | null;
    gls_share: number | null;
    geodis: GeodisResult;
    gls: GlsResult;
  };
  financials: {
    ca_total: number | null | undefined;
    reglement_livraison: unknown;
    reglement_commande: unknown;
    reglement_30_classique: unknown;
    reglement_escompte_2: unknown;
    reglement_30_sepa: unknown;
    reglement_45_sepa: unknown;
    commissions: unknown;
    commissions_pkg: unknown;
    nombre_commande: unknown;
  };
  max_forecast?: number;
}
