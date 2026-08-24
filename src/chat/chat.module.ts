import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { OrdersModule } from '../orders/orders.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [MarketDataModule, PortfolioModule, OrdersModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
