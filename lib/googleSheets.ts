export interface ForecastRow {
  month: string;
  reference: string;
  quantity_cartons: number;
}

export async function readForecast(clientKey: string): Promise<ForecastRow[]> {
  return [];
}

export async function readPrices(clientKey: string): Promise<Record<string, number>> {
  return {};
}

export async function readCommissions(clientKey: string): Promise<any> {
  return {};
}
