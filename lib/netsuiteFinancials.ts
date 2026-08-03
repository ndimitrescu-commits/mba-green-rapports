export interface NetsuiteFinancials {
  caHtTotal: number | null;
  salesOrderCount: number | null;
  /** CA HT ventilé par libellé (ex. par enseigne / catégorie). */
  caHtByLabel: Record<string, number>;
}

export async function fetchFinancials(
  parentId: number,
  dateFrom: string,
  dateTo: string
): Promise<NetsuiteFinancials> {
  return { caHtTotal: null, salesOrderCount: null, caHtByLabel: {} };
}

/** Commission de référencement = Sales Orders NetSuite x taux par article (onglet "Commission"). */
export async function fetchReferencingCommission(
  parentId: number,
  dateFrom: string,
  dateTo: string,
  commissionRates: any
): Promise<number | null> {
  return null;
}
