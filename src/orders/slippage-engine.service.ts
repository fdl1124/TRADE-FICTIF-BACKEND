import { Injectable } from '@nestjs/common';
import { findAsset } from '../common/constants/assets';
import { OrderSide } from '../common/interfaces';
import { ApiErrors } from '../common/api-error';

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

@Injectable()
export class SlippageEngineService {
  apply(
    symbol: string,
    requestedPrice: number,
    side: OrderSide,
  ): { filledPrice: number; slippage: number } {
    const asset = findAsset(symbol);
    if (!asset) {
      throw ApiErrors.invalidSymbol(symbol);
    }
    const minFraction = asset.slippageMinBps / 10_000;
    const maxFraction = asset.slippageMaxBps / 10_000;
    const magnitude = minFraction + Math.random() * (maxFraction - minFraction);
    const direction = side === 'buy' ? 1 : -1;
    const tick = 10 ** -asset.pricePrecision;
    let filledPrice = roundTo(requestedPrice * (1 + direction * magnitude), asset.pricePrecision);
    if (filledPrice === requestedPrice) {
      filledPrice = roundTo(requestedPrice + direction * tick, asset.pricePrecision);
    }
    const slippage = ((filledPrice - requestedPrice) / requestedPrice) * 100;
    return { filledPrice, slippage: Number(slippage.toFixed(4)) };
  }

  maxSlippageFraction(symbol: string): number {
    const asset = findAsset(symbol);
    if (!asset) {
      throw ApiErrors.invalidSymbol(symbol);
    }
    return asset.slippageMaxBps / 10_000;
  }
}
