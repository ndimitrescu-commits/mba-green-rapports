export interface ForecastRow {
  month: string;
  reference: string;
  quantity_cartons: number;
}

export async function readForecast(clientKey: string): Promise<ForecastRow[]> {
  return [];
}

/** Prix unitaire par référence (onglet "Prix" du Prévisionnel). */
export async function readPrices(clientKey: string): Promise<Map<string, number>> {
  return new Map();
}

export async function readCommissions(clientKey: string): Promise<any> {
  return {};
}
