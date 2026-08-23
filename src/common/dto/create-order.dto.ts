import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ALL_SYMBOLS } from '../constants/assets';

export class CreateOrderDto {
  @IsString()
  @IsIn(ALL_SYMBOLS)
  symbol: string;

  @IsIn(['market', 'limit'])
  type: 'market' | 'limit';

  @IsIn(['buy', 'sell'])
  side: 'buy' | 'sell';

  @IsNumber()
  @Min(1e-8)
  @Max(1e9)
  @Type(() => Number)
  quantity: number;

  @IsOptional()
  @ValidateIf((o: CreateOrderDto) => o.type === 'limit')
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  limitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  stopLoss?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  takeProfit?: number;
}
