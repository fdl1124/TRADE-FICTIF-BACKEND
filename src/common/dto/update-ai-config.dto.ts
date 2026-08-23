import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ALL_SYMBOLS } from '../constants/assets';

export class UpdateAiConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['propose', 'autonomous'])
  mode?: 'propose' | 'autonomous';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(ALL_SYMBOLS, { each: true })
  watchedSymbols?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  maxPositionSizePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  dailyLossLimitPercent?: number;

  @IsOptional()
  @IsBoolean()
  resetCircuitBreaker?: boolean;
}
