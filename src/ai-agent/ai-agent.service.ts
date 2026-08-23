import { HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { LIBSQL_CLIENT } from '../database/database.module';
import { AccountService } from '../portfolio/account.service';
import { OrdersService } from '../orders/orders.service';
import { AiAgentConfig, AiDecision, ApiError } from '../common/interfaces';
import { CreateOrderDto } from '../common/dto/create-order.dto';
import { UpdateAiConfigDto } from '../common/dto/update-ai-config.dto';
import { ApiErrors } from '../common/api-error';
import { ContextEngineService } from './context-engine.service';
import { GeminiService } from './gemini.service';
import { NormalizedDecision, RiskValidationService } from './risk-validation.service';

const AGENT_SYSTEM_INSTRUCTION = `You are a prudent trading agent managing a simulated portfolio with fictional money.
You receive a JSON market context for exactly one symbol: spot price, indicators (RSI14, SMA20, SMA50, volatility), current position and cash.
Decide between BUY, SELL and HOLD for that symbol only.
Rules:
- The ticker field must be exactly the symbol from the context.
- confidence_score is between 0.0 and 1.0.
- proposed_quantity is expressed in units of the asset, only for BUY and SELL, null for HOLD.
- proposed_stop_loss and proposed_take_profit are absolute prices, only meaningful for BUY, null otherwise. Stop loss must be below spot price and within 10% of it. Take profit must be above spot price.
- Never propose a position costing more than 2% of total equity unless the context says otherwise.
- SELL is only possible when currentPositionQuantity is greater than zero.
- reasoning_summary is a single short sentence. key_factors is a list of short factor labels.
Answer with a single JSON object matching the provided schema and nothing else.`;

const MAX_SYMBOLS_PER_CYCLE = 5;
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
    private readonly contextEngine: ContextEngineService,
    private readonly gemini: GeminiService,
    private readonly riskValidation: RiskValidationService,
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
    const rows = await this.db.execute({
      sql: 'SELECT account_id FROM ai_agent_configs WHERE enabled = 1 AND circuit_breaker_active = 0',
      args: [],
    });
    let processed = 0;
    for (const row of rows.rows) {
      await this.runCycleForAccount(String(row.account_id));
      processed += 1;
    }
    return processed;
  }

  private async runCycleForAccount(accountId: string): Promise<void> {
    const agentConfig = await this.getConfig(accountId);
    if (!agentConfig.enabled || agentConfig.circuitBreakerActive) {
      return;
    }

    const { startingBalance } = await this.accounts.getBalanceAndStarting(accountId);
    const dailyPnl = await this.accounts.getDailyPnl(accountId);
    const lossThreshold = (startingBalance * agentConfig.dailyLossLimitPercent) / 100;
    if (dailyPnl <= -lossThreshold) {
      await this.db.execute({
        sql: 'UPDATE ai_agent_configs SET circuit_breaker_active = 1, circuit_breaker_reason = ? WHERE account_id = ?',
        args: [
          `Daily PnL ${dailyPnl.toFixed(2)} reached the configured loss limit of ${lossThreshold.toFixed(2)}`,
          accountId,
        ],
      });
      this.logger.warn(`Circuit breaker tripped for account ${accountId}`);
      return;
    }

    for (const symbol of agentConfig.watchedSymbols.slice(0, MAX_SYMBOLS_PER_CYCLE)) {
      try {
        await this.runDecision(accountId, symbol, agentConfig, dailyPnl);
      } catch (error) {
        this.logger.warn(
          `AI decision for ${symbol} on account ${accountId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async runDecision(
    accountId: string,
    symbol: string,
    agentConfig: AiAgentConfig,
    dailyPnl: number,
  ): Promise<AiDecision | null> {
    const build = await this.contextEngine.build(accountId, symbol);
    if (!build.ok || !build.context) {
      this.logger.log(`Skipping ${symbol} for account ${accountId}: ${build.reason ?? 'unknown'}`);
      return null;
    }
    const marketContext = build.context;

    const geminiResult = await this.gemini.decide({
      systemInstruction: AGENT_SYSTEM_INSTRUCTION,
      userPrompt: JSON.stringify(marketContext),
      thinkingLevel: build.thinkingLevel,
    });

    let validationErrors: string[] = [];
    let normalized: NormalizedDecision | null = null;

    if (geminiResult.ok && geminiResult.parsed) {
      const validation = this.riskValidation.validate(geminiResult.parsed, {
        symbol: marketContext.symbol,
        spotPrice: marketContext.spotPrice,
        assetType: marketContext.assetType,
        marketOpen: marketContext.marketOpen,
        volatilityPct: marketContext.volatilityPct ?? 0,
        change24hPct: marketContext.change24hPct,
        cashBalance: marketContext.cashBalance,
        totalEquity: marketContext.totalEquity,
        startingBalance: marketContext.startingBalance,
        heldQuantity: marketContext.currentPositionQuantity,
        maxPositionSizePercent: agentConfig.maxPositionSizePercent,
        dailyLossLimitPercent: agentConfig.dailyLossLimitPercent,
        dailyPnl,
      });
      validationErrors = validation.errors;
      normalized = validation.normalized;
    } else {
      validationErrors = [geminiResult.error ?? 'GEMINI_UNAVAILABLE'];
    }

    let resultingOrderId: string | null = null;
    if (
      validationErrors.length === 0 &&
      normalized &&
      (normalized.action === 'BUY' || normalized.action === 'SELL')
    ) {
      if (agentConfig.mode === 'autonomous') {
        try {
          const order = await this.orders.createOrder(
            accountId,
            decisionToOrderDto({
              symbol: marketContext.symbol,
              side: normalized.action === 'BUY' ? 'buy' : 'sell',
              quantity: normalized.proposedQuantity ?? 0,
              stopLoss: normalized.proposedStopLoss,
              takeProfit: normalized.proposedTakeProfit,
            }),
            'ai_agent',
          );
          resultingOrderId = order.id;
        } catch (error) {
          const code =
            error instanceof HttpException
              ? ((error.getResponse() as ApiError).error ?? 'ORDER_REJECTED')
              : 'ORDER_REJECTED';
          validationErrors.push(code);
        }
      }
    }

    const decisionId = randomUUID();
    await this.db.execute({
      sql: `INSERT INTO ai_decisions (id, account_id, symbol, action, confidence_score, proposed_quantity, proposed_stop_loss, proposed_take_profit, full_reasoning, reasoning_summary, key_factors, validation_passed, validation_errors, resulting_order_id, model_used, thinking_level, context_json, raw_response, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        decisionId,
        accountId,
        marketContext.symbol,
        normalized?.action ?? 'HOLD',
        normalized?.confidenceScore ?? 0,
        normalized?.proposedQuantity ?? null,
        normalized?.proposedStopLoss ?? null,
        normalized?.proposedTakeProfit ?? null,
        geminiResult.fullReasoning,
        normalized?.reasoningSummary ?? '',
        JSON.stringify(normalized?.keyFactors ?? []),
        validationErrors.length === 0 ? 1 : 0,
        JSON.stringify(validationErrors),
        resultingOrderId,
        geminiResult.modelUsed,
        build.thinkingLevel,
        JSON.stringify(marketContext),
        JSON.stringify(geminiResult.raw),
        new Date().toISOString(),
      ],
    });

    return this.getDecision(accountId, decisionId);
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
