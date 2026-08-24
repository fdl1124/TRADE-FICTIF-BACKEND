import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class PatchPositionDto {
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  stopLoss?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  takeProfit?: number | null;
}
