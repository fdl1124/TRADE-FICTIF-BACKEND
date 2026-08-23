import { Module } from '@nestjs/common';
import { PricesGateway } from './prices.gateway';

@Module({
  providers: [PricesGateway],
})
export class PricesModule {}
