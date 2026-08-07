export interface ForecastRow {
  month: string;
  reference: string;
  quantity_cartons: number;
}

export async function readForecast(_clientKey: string): Promise<ForecastRow[]> {
  return [];
}

export async function readPrices(_clientKey: string): Promise<Record<string, number>> {
  return {};
}

export async function readCommissions(_clientKey: string): Promise<any> {
  return {};
}
