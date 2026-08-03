/** Consommation par référence (cartons + pièces) sur la période. */
export async function fetchConsumptionCartons(
  parentId: number,
  dateFrom: string,
  dateTo: string
): Promise<{ itemCode: string; description: string; qtyCartons: number; qtyPieces?: number }[]> {
  return [];
}

/** Stock disponible (cartons) par code article. */
export async function fetchStockOnHand(itemCodes: string[]): Promise<Map<string, number>> {
  return new Map();
}

/** Lignes de PO en transit par code article (date d'échéance + qté cartons). */
export async function fetchTransitByItem(
  itemCodes: string[]
): Promise<Map<string, { dueDate: string; qtyCartons: number }[]>> {
  return new Map();
}
