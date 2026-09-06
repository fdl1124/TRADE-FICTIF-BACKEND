import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [AuthModule, PortfolioModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
