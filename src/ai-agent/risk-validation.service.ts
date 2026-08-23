import { Injectable } from '@nestjs/common';
import { findAsset } from '../common/constants/assets';

export interface ValidationContext {
  symbol: string;
  spotPrice: number;
  assetType: 'stock' | 'crypto';
  marketOpen: boolean;
  volatilityPct: number;
  change24hPct: number;
  cashBalance: number;
  totalEquity: number;
  startingBalance: number;
  heldQuantity: number;
  maxPositionSizePercent: number;
  dailyLossLimitPercent: number;
  dailyPnl: number;
}

export interface NormalizedDecision {
  action: 'BUY' | 'SELL' | 'HOLD';
  symbol: string;
  confidenceScore: number;
  proposedQuantity: number | null;
  proposedStopLoss: number | null;
  proposedTakeProfit: number | null;
  reasoningSummary: string;
  keyFactors: string[];
}

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  normalized: NormalizedDecision | null;
}

export const UNUSUAL_CHANGE_24H_PERCENT = 8;
export const UNUSUAL_VOLATILITY_PERCENT = 4;
export const STOP_LOSS_MAX_DISTANCE_PERCENT = 10;
export const STOP_LOSS_MAX_DISTANCE_VOLATILE_PERCENT = 20;
const MONEY_EPSILON = 1e-4;
const PERCENT_EPSILON = 1e-6;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumberOrNullOrUndefined(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  return isFiniteNumber(value) && value > 0;
}

@Injectable()
export class RiskValidationService {
  hasUnusualVolatility(ctx: ValidationContext): boolean {
    return (
      Math.abs(ctx.change24hPct) >= UNUSUAL_CHANGE_24H_PERCENT ||
      (isFiniteNumber(ctx.volatilityPct) && ctx.volatilityPct >= UNUSUAL_VOLATILITY_PERCENT)
    );
  }

  maxStopLossDistancePercent(ctx: ValidationContext): number {
    return this.hasUnusualVolatility(ctx)
      ? STOP_LOSS_MAX_DISTANCE_VOLATILE_PERCENT
      : STOP_LOSS_MAX_DISTANCE_PERCENT;
  }

  validate(raw: unknown, ctx: ValidationContext): ValidationResult {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { passed: false, errors: ['MALFORMED_DECISION'], normalized: null };
    }
    const obj = raw as Record<string, unknown>;

    const action = obj.action;
    if (action !== 'BUY' && action !== 'SELL' && action !== 'HOLD') {
      return { passed: false, errors: ['MALFORMED_DECISION'], normalized: null };
    }

    const errors: string[] = [];

    if (typeof obj.ticker !== 'string' || obj.ticker.trim().toUpperCase() !== ctx.symbol.toUpperCase() || findAsset(obj.ticker) === null) {
      errors.push('INVALID_SYMBOL');
    }

    if (!isFiniteNumber(obj.confidence_score) || obj.confidence_score < 0 || obj.confidence_score > 1) {
      errors.push('CONFIDENCE_OUT_OF_RANGE');
    }

    if (!isPositiveNumberOrNullOrUndefined(obj.proposed_stop_loss) || !isPositiveNumberOrNullOrUndefined(obj.proposed_take_profit)) {
      return { passed: false, errors: ['MALFORMED_DECISION'], normalized: null };
    }

    if (!ctx.marketOpen) {
      errors.push('MARKET_CLOSED');
    }

    const dailyLossThreshold = (ctx.startingBalance * ctx.dailyLossLimitPercent) / 100;
    if (ctx.dailyPnl <= -dailyLossThreshold) {
      errors.push('DAILY_LOSS_LIMIT_REACHED');
    }

    let quantity: number | null = null;
    if (action !== 'HOLD') {
      if (!isFiniteNumber(obj.proposed_quantity) || (obj.proposed_quantity as number) <= 0) {
        errors.push('INVALID_QUANTITY');
      } else {
        quantity = obj.proposed_quantity;
      }
    }

    let stopLoss: number | null = null;
    if (obj.proposed_stop_loss !== null && obj.proposed_stop_loss !== undefined && isFiniteNumber(obj.proposed_stop_loss)) {
      stopLoss = obj.proposed_stop_loss;
    }
    let takeProfit: number | null = null;
    if (obj.proposed_take_profit !== null && obj.proposed_take_profit !== undefined && isFiniteNumber(obj.proposed_take_profit)) {
      takeProfit = obj.proposed_take_profit;
    }

    if (action === 'BUY' && quantity !== null) {
      const cost = quantity * ctx.spotPrice;
      const maxCost = (ctx.totalEquity * ctx.maxPositionSizePercent) / 100;
      if (cost > maxCost + MONEY_EPSILON) {
        errors.push('POSITION_SIZE_EXCEEDED');
      }
      if (cost > ctx.cashBalance + MONEY_EPSILON) {
        errors.push('INSUFFICIENT_BALANCE');
      }
    }

    if (action === 'BUY' && stopLoss !== null) {
      if (stopLoss >= ctx.spotPrice) {
        errors.push('INVALID_STOP_LOSS');
      } else {
        const distancePercent = ((ctx.spotPrice - stopLoss) / ctx.spotPrice) * 100;
        if (distancePercent > this.maxStopLossDistancePercent(ctx) + PERCENT_EPSILON) {
          errors.push('STOP_LOSS_TOO_FAR');
        }
      }
    }

    if (action === 'BUY' && takeProfit !== null && takeProfit <= ctx.spotPrice) {
      errors.push('INVALID_TAKE_PROFIT');
    }

    if (action === 'SELL') {
      if (quantity !== null && quantity > ctx.heldQuantity) {
        errors.push('INSUFFICIENT_POSITION');
      }
      stopLoss = null;
      takeProfit = null;
    }

    if (action === 'HOLD') {
      quantity = null;
      stopLoss = null;
      takeProfit = null;
    }

    const normalized: NormalizedDecision = {
      action,
      symbol: ctx.symbol,
      confidenceScore: isFiniteNumber(obj.confidence_score) ? Math.min(Math.max(obj.confidence_score, 0), 1) : 0,
      proposedQuantity: quantity,
      proposedStopLoss: stopLoss,
      proposedTakeProfit: takeProfit,
      reasoningSummary: typeof obj.reasoning_summary === 'string' ? obj.reasoning_summary : '',
      keyFactors: Array.isArray(obj.key_factors)
        ? obj.key_factors.filter((f): f is string => typeof f === 'string').slice(0, 10)
        : [],
    };

    return { passed: errors.length === 0, errors, normalized };
  }
}
