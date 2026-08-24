import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChatConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;
}
