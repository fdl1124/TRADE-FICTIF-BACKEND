import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatAttachmentDto {
  @IsString()
  @MaxLength(260)
  name: string;

  @IsString()
  mimeType: string;

  @IsString()
  @MaxLength(8_500_000)
  dataBase64: string;
}

export class SendChatMessageDto {
  @IsString()
  @MaxLength(6000)
  content: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  attachments?: ChatAttachmentDto[];

  @IsOptional()
  @IsBoolean()
  thinkingEnabled?: boolean;
}
