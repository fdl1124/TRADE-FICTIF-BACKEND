import { Asset } from '../interfaces';

export interface AssetDefinition extends Asset {
  pricePrecision: number;
  slippageMinBps: number;
  slippageMaxBps: number;
}

export const ASSETS: AssetDefinition[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', type: 'crypto', exchange: 'BINANCE', pricePrecision: 2, slippageMinBps: 5, slippageMaxBps: 20 },
  { symbol: 'ETHUSDT', name: 'Ethereum', type: 'crypto', exchange: 'BINANCE', pricePrecision: 2, slippageMinBps: 8, slippageMaxBps: 30 },
  { symbol: 'SOLUSDT', name: 'Solana', type: 'crypto', exchange: 'BINANCE', pricePrecision: 3, slippageMinBps: 10, slippageMaxBps: 40 },
  { symbol: 'BNBUSDT', name: 'BNB', type: 'crypto', exchange: 'BINANCE', pricePrecision: 2, slippageMinBps: 8, slippageMaxBps: 30 },
  { symbol: 'XRPUSDT', name: 'XRP', type: 'crypto', exchange: 'BINANCE', pricePrecision: 5, slippageMinBps: 10, slippageMaxBps: 50 },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', type: 'crypto', exchange: 'BINANCE', pricePrecision: 6, slippageMinBps: 12, slippageMaxBps: 60 },
  { symbol: 'ADAUSDT', name: 'Cardano', type: 'crypto', exchange: 'BINANCE', pricePrecision: 5, slippageMinBps: 12, slippageMaxBps: 55 },
  { symbol: 'LINKUSDT', name: 'Chainlink', type: 'crypto', exchange: 'BINANCE', pricePrecision: 3, slippageMinBps: 12, slippageMaxBps: 50 },
  { symbol: 'AVAXUSDT', name: 'Avalanche', type: 'crypto', exchange: 'BINANCE', pricePrecision: 3, slippageMinBps: 12, slippageMaxBps: 55 },
  { symbol: 'DOTUSDT', name: 'Polkadot', type: 'crypto', exchange: 'BINANCE', pricePrecision: 4, slippageMinBps: 12, slippageMaxBps: 55 },
  { symbol: 'LTCUSDT', name: 'Litecoin', type: 'crypto', exchange: 'BINANCE', pricePrecision: 2, slippageMinBps: 10, slippageMaxBps: 45 },
  { symbol: 'ATOMUSDT', name: 'Cosmos', type: 'crypto', exchange: 'BINANCE', pricePrecision: 3, slippageMinBps: 14, slippageMaxBps: 60 },
  { symbol: 'UNIUSDT', name: 'Uniswap', type: 'crypto', exchange: 'BINANCE', pricePrecision: 3, slippageMinBps: 14, slippageMaxBps: 60 },
  { symbol: 'NEARUSDT', name: 'NEAR Protocol', type: 'crypto', exchange: 'BINANCE', pricePrecision: 4, slippageMinBps: 14, slippageMaxBps: 65 },
  { symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 2, slippageMaxBps: 10 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 2, slippageMaxBps: 10 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 2, slippageMaxBps: 12 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 2, slippageMaxBps: 12 },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 3, slippageMaxBps: 15 },
  { symbol: 'TSLA', name: 'Tesla Inc.', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 4, slippageMaxBps: 20 },
  { symbol: 'META', name: 'Meta Platforms Inc.', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 3, slippageMaxBps: 15 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 4, slippageMaxBps: 18 },
  { symbol: 'NFLX', name: 'Netflix Inc.', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 4, slippageMaxBps: 18 },
  { symbol: 'INTC', name: 'Intel Corporation', type: 'stock', exchange: 'NASDAQ', pricePrecision: 2, slippageMinBps: 4, slippageMaxBps: 18 },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', type: 'stock', exchange: 'NYSE', pricePrecision: 2, slippageMinBps: 3, slippageMaxBps: 14 },
  { symbol: 'V', name: 'Visa Inc.', type: 'stock', exchange: 'NYSE', pricePrecision: 2, slippageMinBps: 3, slippageMaxBps: 12 },
  { symbol: 'KO', name: 'The Coca-Cola Company', type: 'stock', exchange: 'NYSE', pricePrecision: 2, slippageMinBps: 3, slippageMaxBps: 12 },
  { symbol: 'DIS', name: 'The Walt Disney Company', type: 'stock', exchange: 'NYSE', pricePrecision: 2, slippageMinBps: 4, slippageMaxBps: 16 },
  { symbol: 'BA', name: 'The Boeing Company', type: 'stock', exchange: 'NYSE', pricePrecision: 2, slippageMinBps: 5, slippageMaxBps: 22 },
];

export const ALL_SYMBOLS: string[] = ASSETS.map((a) => a.symbol);

export const CRYPTO_SYMBOLS: string[] = ASSETS.filter((a) => a.type === 'crypto').map((a) => a.symbol);

export const STOCK_SYMBOLS: string[] = ASSETS.filter((a) => a.type === 'stock').map((a) => a.symbol);

export function findAsset(symbol: string): AssetDefinition | null {
  const normalized = symbol.trim().toUpperCase();
  return ASSETS.find((a) => a.symbol === normalized) ?? null;
}
