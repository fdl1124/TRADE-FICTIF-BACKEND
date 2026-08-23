import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { OrdersModule } from '../orders/orders.module';
import { ContextEngineService } from './context-engine.service';
import { GeminiService } from './gemini.service';
import { RiskValidationService } from './risk-validation.service';
import { AiAgentService } from './ai-agent.service';
import { AiAgentController } from './ai-agent.controller';

@Module({
  imports: [MarketDataModule, PortfolioModule, OrdersModule],
  controllers: [AiAgentController],
  providers: [ContextEngineService, GeminiService, RiskValidationService, AiAgentService],
  exports: [AiAgentService],
})
export class AiAgentModule {}
