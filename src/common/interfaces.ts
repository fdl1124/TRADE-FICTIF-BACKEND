export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface Account {
  id: string;
  userId: string;
  balance: number;
  startingBalance: number;
  createdAt: string;
}

export interface AccountSummary {
  balance: number;
  totalPositionsValue: number;
  totalPnl: number;
  totalPnlPercent: number;
}

export interface Asset {
  symbol: string;
  name: string;
  type: 'stock' | 'crypto';
  exchange: string;
}

export interface PriceTick {
  symbol: string;
  price: number;
  timestamp: string;
  change24h: number;
}

export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  stopLoss: number | null;
  takeProfit: number | null;
  leverage: number;
  openedAt: string;
}

export type OrderType = 'market' | 'limit';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'filled' | 'rejected' | 'cancelled';
export type OrderSource = 'manual' | 'ai_agent';

export interface Order {
  id: string;
  accountId: string;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  quantity: number;
  limitPrice: number | null;
  requestedPrice: number;
  filledPrice: number | null;
  slippage: number | null;
  status: OrderStatus;
  source: OrderSource;
  stopLoss: number | null;
  takeProfit: number | null;
  rejectionReason: string | null;
  createdAt: string;
  filledAt: string | null;
}

export interface AiDecision {
  id: string;
  accountId: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidenceScore: number;
  proposedQuantity: number | null;
  proposedStopLoss: number | null;
  proposedTakeProfit: number | null;
  fullReasoning: string;
  reasoningSummary: string;
  keyFactors: string[];
  validationPassed: boolean;
  validationErrors: string[];
  resultingOrderId: string | null;
  modelUsed: 'gemini-3.7-flash' | 'gemini-3.6-flash';
  thinkingLevel: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface AiAgentConfig {
  accountId: string;
  enabled: boolean;
  mode: 'propose' | 'autonomous';
  watchedSymbols: string[];
  maxPositionSizePercent: number;
  dailyLossLimitPercent: number;
  circuitBreakerActive: boolean;
  circuitBreakerReason: string | null;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
