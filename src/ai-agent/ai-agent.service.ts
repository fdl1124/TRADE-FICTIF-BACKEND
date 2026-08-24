import { HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { LIBSQL_CLIENT } from '../database/libsql-token';
import { AccountService } from '../portfolio/account.service';
import { OrdersService } from '../orders/orders.service';
import { AiDecision, ApiError } from '../common/interfaces';
import { CreateOrderDto } from '../common/dto/create-order.dto';
import { UpdateAiConfigDto } from '../common/dto/update-ai-config.dto';
import { ApiErrors } from '../common/api-error';
import { AiAgentsService } from './ai-agents.service';

const MIN_CYCLE_SECONDS = 5;

function decisionToOrderDto(input: {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  stopLoss: number | null;
  takeProfit: number | null;
}): CreateOrderDto {
  const dto = new CreateOrderDto();
  dto.symbol = input.symbol;
  dto.type = 'market';
  dto.side = input.side;
  dto.quantity = input.quantity;
  dto.limitPrice = undefined;
  dto.stopLoss = input.stopLoss === null ? undefined : input.stopLoss;
  dto.takeProfit = input.takeProfit === null ? undefined : input.takeProfit;
  return dto;
}

@Injectable()
export class AiAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiAgentService.name);
  private cycleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
    private readonly config: ConfigService,
    private readonly accounts: AccountService,
    private readonly orders: OrdersService,
    private readonly agents: AiAgentsService,
  ) {}

  onModuleInit(): void {
    const rawSeconds = Number(this.config.get('AI_CYCLE_SECONDS') ?? 60);
    const seconds = Number.isFinite(rawSeconds) ? Math.max(MIN_CYCLE_SECONDS, rawSeconds) : 60;
    this.cycleTimer = setInterval(() => {
      void this.runCycleForAllAccounts().catch((error: unknown) => {
        this.logger.error(
          `AI cycle failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, seconds * 1_000);
  }

  onModuleDestroy(): void {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  async runCycleForAllAccounts(): Promise<number> {
    return this.agents.runCycleForAllAgents();
  }


  async getConfig(accountId: string): Promise<AiAgentConfig> {
    const existing = await this.db.execute({
      sql: 'SELECT * FROM ai_agent_configs WHERE account_id = ?',
      args: [accountId],
    });
    if (existing.rows.length === 0) {
      await this.db.execute({
        sql: 'INSERT INTO ai_agent_configs (account_id, enabled, mode, watched_symbols, max_position_size_percent, daily_loss_limit_percent, circuit_breaker_active, circuit_breaker_reason) VALUES (?, 0, ?, ?, ?, ?, 0, NULL)',
        args: [accountId, 'propose', '[]', 2, 3],
      });
      const created = await this.db.execute({
        sql: 'SELECT * FROM ai_agent_configs WHERE account_id = ?',
        args: [accountId],
      });
      return this.mapConfigRow(created.rows[0]);
    }
    return this.mapConfigRow(existing.rows[0]);
  }

  async updateConfig(accountId: string, dto: UpdateAiConfigDto): Promise<AiAgentConfig> {
    await this.getConfig(accountId);
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];

    if (dto.enabled !== undefined) {
      assignments.push('enabled = ?');
      values.push(dto.enabled ? 1 : 0);
    }
    if (dto.mode !== undefined) {
      assignments.push('mode = ?');
      values.push(dto.mode);
    }
    if (dto.watchedSymbols !== undefined) {
      assignments.push('watched_symbols = ?');
      values.push(JSON.stringify(dto.watchedSymbols.map((s) => s.toUpperCase())));
    }
    if (dto.maxPositionSizePercent !== undefined) {
      assignments.push('max_position_size_percent = ?');
      values.push(dto.maxPositionSizePercent);
    }
    if (dto.dailyLossLimitPercent !== undefined) {
      assignments.push('daily_loss_limit_percent = ?');
      values.push(dto.dailyLossLimitPercent);
    }
    if (dto.resetCircuitBreaker === true) {
      assignments.push('circuit_breaker_active = 0');
      assignments.push('circuit_breaker_reason = NULL');
    }

    if (assignments.length > 0) {
      await this.db.execute({
        sql: `UPDATE ai_agent_configs SET ${assignments.join(', ')} WHERE account_id = ?`,
        args: [...values, accountId],
      });
    }
    return this.getConfig(accountId);
  }

  async listDecisions(accountId: string, limit: number): Promise<AiDecision[]> {
    const result = await this.db.execute({
      sql: `SELECT d.*, (SELECT o.order_id FROM ai_decision_outcomes o WHERE o.decision_id = d.id ORDER BY o.created_at DESC LIMIT 1) AS outcome_order_id
            FROM ai_decisions d WHERE d.account_id = ? ORDER BY d.created_at DESC LIMIT ?`,
      args: [accountId, limit],
    });
    return result.rows.map((row) => this.mapDecisionRow(row));
  }

  async getDecision(accountId: string, decisionId: string): Promise<AiDecision> {
    const result = await this.db.execute({
      sql: `SELECT d.*, (SELECT o.order_id FROM ai_decision_outcomes o WHERE o.decision_id = d.id ORDER BY o.created_at DESC LIMIT 1) AS outcome_order_id
            FROM ai_decisions d WHERE d.id = ? AND d.account_id = ?`,
      args: [decisionId, accountId],
    });
    if (result.rows.length === 0) {
      throw ApiErrors.notFound('AI decision');
    }
    return this.mapDecisionRow(result.rows[0]);
  }

  async getRawDecision(
    accountId: string,
    decisionId: string,
  ): Promise<{ id: string; context: unknown; rawResponse: unknown; createdAt: string }> {
    const result = await this.db.execute({
      sql: 'SELECT id, context_json, raw_response, created_at FROM ai_decisions WHERE id = ? AND account_id = ?',
      args: [decisionId, accountId],
    });
    if (result.rows.length === 0) {
      throw ApiErrors.notFound('AI decision');
    }
    const row = result.rows[0];
    return {
      id: String(row.id),
      context: safelyParse(String(row.context_json)),
      rawResponse: safelyParse(String(row.raw_response)),
      createdAt: String(row.created_at),
    };
  }

  async approveDecision(accountId: string, decisionId: string): Promise<AiDecision> {
    const decision = await this.getDecision(accountId, decisionId);
    await this.assertNoOutcome(decisionId);
    if (!decision.validationPassed || decision.action === 'HOLD') {
      throw ApiErrors.notApprovable();
    }

    const order = await this.orders.createOrder(
      accountId,
      decisionToOrderDto({
        symbol: decision.symbol,
        side: decision.action === 'BUY' ? 'buy' : 'sell',
        quantity: decision.proposedQuantity ?? 0,
        stopLoss: decision.proposedStopLoss,
        takeProfit: decision.proposedTakeProfit,
      }),
      'ai_agent',
    );

    await this.db.execute({
      sql: 'INSERT INTO ai_decision_outcomes (id, decision_id, account_id, outcome, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [randomUUID(), decisionId, accountId, 'approved', order.id, new Date().toISOString()],
    });
    return this.getDecision(accountId, decisionId);
  }

  async rejectDecision(accountId: string, decisionId: string): Promise<AiDecision> {
    await this.getDecision(accountId, decisionId);
    await this.assertNoOutcome(decisionId);
    await this.db.execute({
      sql: 'INSERT INTO ai_decision_outcomes (id, decision_id, account_id, outcome, order_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
      args: [randomUUID(), decisionId, accountId, 'rejected', new Date().toISOString()],
    });
    return this.getDecision(accountId, decisionId);
  }

  private async assertNoOutcome(decisionId: string): Promise<void> {
    const existing = await this.db.execute({
      sql: 'SELECT id FROM ai_decision_outcomes WHERE decision_id = ? LIMIT 1',
      args: [decisionId],
    });
    if (existing.rows.length > 0) {
      throw ApiErrors.alreadyProcessed();
    }
  }

  private mapConfigRow(row: Record<string, unknown>): AiAgentConfig {
    let watchedSymbols: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(row.watched_symbols));
      if (Array.isArray(parsed)) {
        watchedSymbols = parsed.filter((s): s is string => typeof s === 'string');
      }
    } catch {
      watchedSymbols = [];
    }
    return {
      accountId: String(row.account_id),
      enabled: Number(row.enabled) === 1,
      mode: String(row.mode) === 'autonomous' ? 'autonomous' : 'propose',
      watchedSymbols,
      maxPositionSizePercent: Number(row.max_position_size_percent),
      dailyLossLimitPercent: Number(row.daily_loss_limit_percent),
      circuitBreakerActive: Number(row.circuit_breaker_active) === 1,
      circuitBreakerReason:
        row.circuit_breaker_reason === null || row.circuit_breaker_reason === undefined
          ? null
          : String(row.circuit_breaker_reason),
    };
  }

  private mapDecisionRow(row: Record<string, unknown>): AiDecision {
    let keyFactors: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(row.key_factors));
      if (Array.isArray(parsed)) {
        keyFactors = parsed.filter((f): f is string => typeof f === 'string');
      }
    } catch {
      keyFactors = [];
    }
    let validationErrors: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(row.validation_errors));
      if (Array.isArray(parsed)) {
        validationErrors = parsed.filter((f): f is string => typeof f === 'string');
      }
    } catch {
      validationErrors = [];
    }
    const resultingOrderId =
      row.resulting_order_id !== null && row.resulting_order_id !== undefined
        ? String(row.resulting_order_id)
        : row.outcome_order_id !== null && row.outcome_order_id !== undefined
          ? String(row.outcome_order_id)
          : null;

    return {
      id: String(row.id),
      accountId: String(row.account_id),
      symbol: String(row.symbol),
      action: String(row.action) as 'BUY' | 'SELL' | 'HOLD',
      confidenceScore: Number(row.confidence_score),
      proposedQuantity: row.proposed_quantity === null || row.proposed_quantity === undefined ? null : Number(row.proposed_quantity),
      proposedStopLoss: row.proposed_stop_loss === null || row.proposed_stop_loss === undefined ? null : Number(row.proposed_stop_loss),
      proposedTakeProfit: row.proposed_take_profit === null || row.proposed_take_profit === undefined ? null : Number(row.proposed_take_profit),
      fullReasoning: String(row.full_reasoning),
      reasoningSummary: String(row.reasoning_summary),
      keyFactors,
      validationPassed: Number(row.validation_passed) === 1,
      validationErrors,
      resultingOrderId,
      modelUsed: String(row.model_used) === 'gemini-3.6-flash' ? 'gemini-3.6-flash' : 'gemini-3.7-flash',
      thinkingLevel:
        String(row.thinking_level) === 'high' ? 'high' : String(row.thinking_level) === 'low' ? 'low' : 'medium',
      createdAt: String(row.created_at),
    };
  }
}

function safelyParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
