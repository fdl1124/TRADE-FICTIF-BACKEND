import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentUser } from '../auth/firebase-auth.decorator';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { AccountService } from '../portfolio/account.service';
import { ChatService } from './chat.service';
import { CreateChatConversationDto } from '../common/dto/create-chat-conversation.dto';
import { SendChatMessageDto } from '../common/dto/send-chat-message.dto';

@Controller('api/chat')
@UseGuards(FirebaseAuthGuard)
export class ChatController {
  constructor(
    private readonly accounts: AccountService,
    private readonly chat: ChatService,
  ) {}

  @Get('conversations')
  async listConversations(@CurrentUser() user: FirebaseUserPayload) {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.chat.listConversations(accountId);
  }

  @Post('conversations')
  async createConversation(
    @CurrentUser() user: FirebaseUserPayload,
    @Body() dto: CreateChatConversationDto,
  ) {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.chat.createConversation(accountId, dto.title);
  }

  @Delete('conversations/:id')
  async deleteConversation(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') conversationId: string,
  ): Promise<{ deleted: true }> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    await this.chat.deleteConversation(accountId, conversationId);
    return { deleted: true };
  }

  @Get('conversations/:id/messages')
  async listMessages(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') conversationId: string,
  ) {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.chat.listMessages(accountId, conversationId);
  }

  @Post('conversations/:id/messages')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async sendMessage(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') conversationId: string,
    @Body() dto: SendChatMessageDto,
    @Req() _req: Request & { res: Response },
  ): Promise<void> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    await this.chat.sendMessageStream(
      accountId,
      conversationId,
      {
        content: dto.content,
        attachments: dto.attachments ?? [],
        thinkingEnabled: dto.thinkingEnabled ?? false,
      },
      _req.res,
    );
  }
}
