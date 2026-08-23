import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { PositionsService } from './positions.service';
import { PositionsController } from './positions.controller';

@Module({
  imports: [MarketDataModule],
  controllers: [AccountController, PositionsController],
  providers: [AccountService, PositionsService],
  exports: [AccountService, PositionsService],
})
export class PortfolioModule {}
