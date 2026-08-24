import { IsBoolean, IsOptional } from 'class-validator';
import { CreateAgentDto } from './create-agent.dto';

export class UpdateAgentDto extends CreateAgentDto {
  @IsOptional()
  @IsBoolean()
  resetCircuitBreaker?: boolean;
}
