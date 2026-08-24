import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { CurrentUser } from '../auth/firebase-auth.decorator';
import { FirebaseUserPayload } from '../auth/firebase.service';
import { AccountService } from '../portfolio/account.service';
import { AiAgentsService } from './ai-agents.service';
import { CreateAgentDto } from '../common/dto/create-agent.dto';
import { UpdateAgentDto } from '../common/dto/update-agent.dto';
import { AiDecision } from '../common/interfaces';

@Controller('api/ai/agents')
@UseGuards(FirebaseAuthGuard)
export class AiAgentsController {
  constructor(
    private readonly accounts: AccountService,
    private readonly agents: AiAgentsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: FirebaseUserPayload) {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agents.list(accountId);
  }

  @Post()
  async create(@CurrentUser() user: FirebaseUserPayload, @Body() dto: CreateAgentDto) {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agents.create(accountId, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: FirebaseUserPayload,
    @Param('id') agentId: string,
    @Body() dto: UpdateAgentDto,
  ) {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agents.update(accountId, agentId, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: FirebaseUserPayload, @Param('id') agentId: string): Promise<{ deleted: true }> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    await this.agents.remove(accountId, agentId);
    return { deleted: true };
  }

  @Post(':id/run')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async run(@CurrentUser() user: FirebaseUserPayload, @Param('id') agentId: string): Promise<AiDecision[]> {
    const accountId = await this.accounts.getOrCreateAccountId(user);
    return this.agents.runAgentNow(accountId, agentId);
  }
}
