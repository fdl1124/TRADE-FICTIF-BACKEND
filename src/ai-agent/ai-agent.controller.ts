import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentUser } from '../auth/firebase-auth.decorator';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { AccountService } from '../portfolio/account.service';
import { AiAgentService } from './ai-agent.service';
import { UpdateAiConfigDto } from '../common/dto/update-ai-config.dto';
import { ListDecisionsQueryDto } from '../common/dto/query-dtos';
import { AiAgentConfig, AiDecision } from '../common/interfaces';

@Controller('api/ai')
@UseGuards(FirebaseAuthGuard)
export class AiAgentController {
  constructor(
    private readonly accounts: AccountService,
    private readonly agent: AiAgentService,
  ) {}

  @Get('config')
  async getConfig(@CurrentUser() user: FirebaseUserPayload): Promise<AiAgentConfig> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agent.getConfig(accountId);
  }

  @Put('config')
  async updateConfig(
    @CurrentUser() user: FirebaseUserPayload,
    @Body() dto: UpdateAiConfigDto,
  ): Promise<AiAgentConfig> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agent.updateConfig(accountId, dto);
  }

  @Get('decisions')
  async listDecisions(
    @CurrentUser() user: FirebaseUserPayload,
    @Query() query: ListDecisionsQueryDto,
  ): Promise<AiDecision[]> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agent.listDecisions(accountId, query.limit ?? 50);
  }

  @Get('decisions/:id')
  async getDecision(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') decisionId: string,
  ): Promise<AiDecision> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agent.getDecision(accountId, decisionId);
  }

  @Get('decisions/:id/raw')
  async getRawDecision(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') decisionId: string,
  ): Promise<{ id: string; context: unknown; rawResponse: unknown; createdAt: string }> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agent.getRawDecision(accountId, decisionId);
  }

  @Post('decisions/:id/approve')
  async approveDecision(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') decisionId: string,
  ): Promise<AiDecision> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agent.approveDecision(accountId, decisionId);
  }

  @Post('decisions/:id/reject')
  async rejectDecision(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') decisionId: string,
  ): Promise<AiDecision> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agent.rejectDecision(accountId, decisionId);
  }
}
