export async function fetchConsumptionCartons(
  _parentId: number,
  _dateFrom: string,
  _dateTo: string
): Promise<any[]> {
  return [];
}

export async function fetchStockOnHand(codes: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const code of codes) {
    result.set(code, 0);
  }
  return result;
}

export async function fetchTransitByItem(codes: string[]): Promise<Map<string, any[]>> {
  const result = new Map<string, any[]>();
  for (const code of codes) {
    result.set(code, []);
  }
  return result;
}

export async function fetchCatalogPriceByCarton(_codes: string[]): Promise<Record<string, number>> {
  return {};
}
