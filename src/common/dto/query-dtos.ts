import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsIn(['pending', 'filled', 'rejected', 'cancelled'])
  status?: 'pending' | 'filled' | 'rejected' | 'cancelled';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

export class ListDecisionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

export class PriceHistoryQueryDto {
  @IsIn(['1d', '1w', '1m'])
  range: '1d' | '1w' | '1m';
}
