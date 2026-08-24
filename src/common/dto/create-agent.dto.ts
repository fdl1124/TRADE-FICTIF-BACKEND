import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ALL_SYMBOLS } from '../constants/assets';

export class CreateAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsIn(['technical', 'news', 'risk', 'custom'])
  profile?: 'technical' | 'news' | 'risk' | 'custom';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  thinkingLevel?: 'low' | 'medium' | 'high';

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
  enabled?: boolean;

  @IsOptional()
  @IsIn(['propose', 'autonomous'])
  mode?: 'propose' | 'autonomous';
}
