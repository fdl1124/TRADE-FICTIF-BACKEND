import { Asset } from '../interfaces';

export interface AssetDefinition extends Asset {
  pricePrecision: number;
  slippageMinBps: number;
  slippageMaxBps: number;
}

export const ASSETS: AssetDefinition[] = [
  {
    symbol: 'BTCUSDT',
    name: 'Bitcoin',
    type: 'crypto',
    exchange: 'BINANCE',
    pricePrecision: 2,
    slippageMinBps: 5,
    slippageMaxBps: 20,
  },
  {
    symbol: 'ETHUSDT',
    name: 'Ethereum',
    type: 'crypto',
    exchange: 'BINANCE',
    pricePrecision: 2,
    slippageMinBps: 8,
    slippageMaxBps: 30,
  },
  {
    symbol: 'SOLUSDT',
    name: 'Solana',
    type: 'crypto',
    exchange: 'BINANCE',
    pricePrecision: 3,
    slippageMinBps: 10,
    slippageMaxBps: 40,
  },
  {
    symbol: 'BNBUSDT',
    name: 'BNB',
    type: 'crypto',
    exchange: 'BINANCE',
    pricePrecision: 2,
    slippageMinBps: 8,
    slippageMaxBps: 30,
  },
  {
    symbol: 'XRPUSDT',
    name: 'XRP',
    type: 'crypto',
    exchange: 'BINANCE',
    pricePrecision: 5,
    slippageMinBps: 10,
    slippageMaxBps: 50,
  },
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    type: 'stock',
    exchange: 'NASDAQ',
    pricePrecision: 2,
    slippageMinBps: 2,
    slippageMaxBps: 10,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    type: 'stock',
    exchange: 'NASDAQ',
    pricePrecision: 2,
    slippageMinBps: 2,
    slippageMaxBps: 10,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Inc.',
    type: 'stock',
    exchange: 'NASDAQ',
    pricePrecision: 2,
    slippageMinBps: 2,
    slippageMaxBps: 12,
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    type: 'stock',
    exchange: 'NASDAQ',
    pricePrecision: 2,
    slippageMinBps: 2,
    slippageMaxBps: 12,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    type: 'stock',
    exchange: 'NASDAQ',
    pricePrecision: 2,
    slippageMinBps: 3,
    slippageMaxBps: 15,
  },
  {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    type: 'stock',
    exchange: 'NASDAQ',
    pricePrecision: 2,
    slippageMinBps: 4,
    slippageMaxBps: 20,
  },
  {
    symbol: 'META',
    name: 'Meta Platforms Inc.',
    type: 'stock',
    exchange: 'NASDAQ',
    pricePrecision: 2,
    slippageMinBps: 3,
    slippageMaxBps: 15,
  },
];

export const ALL_SYMBOLS: string[] = ASSETS.map((a) => a.symbol);

export const CRYPTO_SYMBOLS: string[] = ASSETS.filter((a) => a.type === 'crypto').map((a) => a.symbol);

export const STOCK_SYMBOLS: string[] = ASSETS.filter((a) => a.type === 'stock').map((a) => a.symbol);

export function findAsset(symbol: string): AssetDefinition | null {
  const normalized = symbol.trim().toUpperCase();
  return ASSETS.find((a) => a.symbol === normalized) ?? null;
}
