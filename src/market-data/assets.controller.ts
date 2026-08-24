import { Controller, Get, Param, Query } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { ASSETS, findAsset } from '../common/constants/assets';
import { ApiErrors } from '../common/api-error';
import { Asset, Candle, PriceTick } from '../common/interfaces';
import { PriceHistoryQueryDto } from '../common/dto/query-dtos';

@Controller('api/assets')
export class AssetsController {
  constructor(private readonly marketData: MarketDataService) {}

  @Get()
  listAssets(): Asset[] {
    return ASSETS.map(({ symbol, name, type, exchange }) => ({ symbol, name, type, exchange }));
  }

  @Get(':symbol/price')
  async getPrice(@Param('symbol') symbol: string): Promise<PriceTick> {
    const asset = findAsset(symbol);
    if (!asset) {
      throw ApiErrors.invalidSymbol(symbol);
    }
    const cached = this.marketData.getCachedTick(asset.symbol);
    if (cached) {
      return cached;
    }
    const fresh = await this.marketData.getFreshTick(asset.symbol);
    if (!fresh) {
      throw ApiErrors.stalePrice(asset.symbol);
    }
    return fresh;
  }

  @Get(':symbol/history')
  async getHistory(
    @Param('symbol') symbol: string,
    @Query() query: PriceHistoryQueryDto,
  ): Promise<PriceTick[]> {
    const asset = findAsset(symbol);
    if (!asset) {
      throw ApiErrors.invalidSymbol(symbol);
    }
    return this.marketData.getHistory(asset.symbol, query.range);
  }

  @Get(':symbol/candles')
  async getCandles(
    @Param('symbol') symbol: string,
    @Query() query: PriceHistoryQueryDto,
  ): Promise<Candle[]> {
    const asset = findAsset(symbol);
    if (!asset) {
      throw ApiErrors.invalidSymbol(symbol);
    }
    return this.marketData.getCandles(asset.symbol, query.range);
  }
}
