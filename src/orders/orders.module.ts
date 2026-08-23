import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { SlippageEngineService } from './slippage-engine.service';

@Module({
  imports: [MarketDataModule, PortfolioModule],
  controllers: [OrdersController],
  providers: [OrdersService, SlippageEngineService],
  exports: [OrdersService, SlippageEngineService],
})
export class OrdersModule {}
