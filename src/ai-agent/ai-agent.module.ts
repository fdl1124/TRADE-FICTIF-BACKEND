import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { OrdersModule } from '../orders/orders.module';
import { AuthModule } from '../auth/auth.module';
import { PushModule } from '../push/push.module';
import { ContextEngineService } from './context-engine.service';
import { GeminiService } from './gemini.service';
import { RiskValidationService } from './risk-validation.service';
import { AiAgentService } from './ai-agent.service';
import { AiAgentsService } from './ai-agents.service';
import { AiAgentController } from './ai-agent.controller';
import { AiAgentsController } from './ai-agents.controller';
import { PushService } from '../push/push.service';

@Module({
  imports: [MarketDataModule, PortfolioModule, OrdersModule, AuthModule, PushModule],
  controllers: [AiAgentController, AiAgentsController],
  providers: [PushService, ContextEngineService, GeminiService, RiskValidationService, AiAgentService, AiAgentsService],
  exports: [AiAgentService, AiAgentsService, ContextEngineService, GeminiService],
})
export class AiAgentModule {}
