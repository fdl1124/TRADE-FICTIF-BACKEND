import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { OrdersModule } from '../orders/orders.module';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [MarketDataModule, PortfolioModule, OrdersModule, AiAgentModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
