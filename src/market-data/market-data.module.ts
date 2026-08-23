import { Module } from '@nestjs/common';
import { PriceCacheService } from './price-cache.service';
import { BinanceService } from './binance.service';
import { YahooFinanceService } from './yahoo-finance.service';
import { MarketStatusService } from './market-status.service';
import { MarketDataService } from './market-data.service';
import { AssetsController } from './assets.controller';

@Module({
  controllers: [AssetsController],
  providers: [PriceCacheService, BinanceService, YahooFinanceService, MarketStatusService, MarketDataService],
  exports: [PriceCacheService, BinanceService, YahooFinanceService, MarketStatusService, MarketDataService],
})
export class MarketDataModule {}
