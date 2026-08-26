import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Client } from '@libsql/client';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LIBSQL_CLIENT } from '../database/libsql-token';
import { AccountService } from '../portfolio/account.service';
import { OrdersService } from '../orders/orders.service';
import { AiDecision } from '../common/interfaces';
import { CreateAgentDto } from '../common/dto/create-agent.dto';
import { CreateOrderDto } from '../common/dto/create-order.dto';
import { UpdateAgentDto } from '../common/dto/update-agent.dto';
import { ApiErrors } from '../common/api-error';
import { ContextEngineService } from './context-engine.service';
import { GeminiService } from './gemini.service';
import { NormalizedDecision, RiskValidationService } from './risk-validation.service';

const AGENT_PROFILES = ['technical', 'news', 'risk', 'custom'] as const;
export type AgentProfile = (typeof AGENT_PROFILES)[number];

const MAX_SYMBOLS_PER_AGENT_RUN = 3;
const MAX_FUNCTION_LOOPS = 5;

const BASE_RULES = `Tu es un agent d'analyse de trading autonome pour un portefeuille simulé en argent fictif.
Tu reçois un contexte de marché JSON pour exactement un symbole : prix spot, indicateurs (RSI14, SMA20, SMA50, volatilité), position actuelle et liquidités.
Décide entre BUY, SELL et HOLD pour ce symbole uniquement.
Règles :
- Le champ ticker doit être exactement le symbole du contexte.
- confidence_score est entre 0.0 et 1.0.
- proposed_quantity est exprimé en unités de l'actif, seulement pour BUY et SELL, null pour HOLD.
- IMPORTANT : la valeur totale de la position (proposed_quantity × spotPrice) ne doit JAMAIS dépasser la limite de taille de position configurée. Reste en dessous.
- proposed_stop_loss et proposed_take_profit sont des prix absolus, seulement pour BUY, null sinon. Le stop loss doit être sous le prix spot et à moins de 10% de celui-ci. Le take profit doit être au-dessus du prix spot.
- SELL n'est possible que si currentPositionQuantity est supérieur à zéro.
- reasoning_summary est une seule phrase courte en français. key_factors est une liste de labels courts en français.
Réponds avec un seul objet JSON correspondant au schéma fourni et rien d'autre. Tout le texte (reasoning_summary, key_factors) doit être en français.`;

const PROFILE_PROMPTS: Record<AgentProfile, string> = {
  technical: `${BASE_RULES}\nSpecialty: pure technical analysis. Base your decision strictly on the provided indicators (RSI14, SMA20/50 crossovers, realized volatility) and price structure. Ignore any news considerations.`,
  news: `${BASE_RULES}\nSpecialty: market sentiment and recent events. A Google Search tool is available to check the latest news about the symbol before deciding: search first, then weigh sentiment against the technical context.`,
  risk: `${BASE_RULES}\nSpecialty: portfolio risk guardian. You are conservative by design: prefer HOLD unless the risk/reward is clearly favorable, flag excessive exposure and deteriorating conditions in key_factors.`,
  custom: BASE_RULES,
};

export interface AgentInstance {
  id: string;
  accountId: string;
  name: string;
  profile: AgentProfile;
  instructions: string | null;
  thinkingLevel: 'low' | 'medium' | 'high';
  watchedSymbols: string[];
  maxPositionSizePercent: number;
  dailyLossLimitPercent: number;
  enabled: boolean;
  mode: 'propose' | 'autonomous';
  circuitBreakerActive: boolean;
  circuitBreakerReason: string | null;
}

function safelyParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

@Injectable()
export class AiAgentsService {
  private readonly logger = new Logger(AiAgentsService.name);

  constructor(
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
    private readonly accounts: AccountService,
    private readonly orders: OrdersService,
    private readonly contextEngine: ContextEngineService,
    private readonly gemini: GeminiService,
    private readonly riskValidation: RiskValidationService,
  ) {}

  async list(accountId: string): Promise<AgentInstance[]> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM ai_agents WHERE account_id = ? ORDER BY created_at ASC',
      args: [accountId],
    });
    return result.rows.map((row) => this.mapRow(row));
  }

  async getOne(accountId: string, agentId: string): Promise<AgentInstance> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM ai_agents WHERE id = ? AND account_id = ?',
      args: [agentId, accountId],
    });
    if (result.rows.length === 0) {
      throw ApiErrors.notFound('AI agent');
    }
    return this.mapRow(result.rows[0]);
  }

  async create(accountId: string, dto: CreateAgentDto): Promise<AgentInstance> {
    const agentId = randomUUID();
    const profile = dto.profile ?? 'custom';
    await this.db.execute({
      sql: `INSERT INTO ai_agents (id, account_id, name, profile, instructions, thinking_level, watched_symbols, max_position_size_percent, daily_loss_limit_percent, enabled, mode, circuit_breaker_active, circuit_breaker_reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
      args: [
        agentId,
        accountId,
        dto.name?.trim() || `Agent ${profile}`,
        profile,
        dto.instructions ?? null,
        dto.thinkingLevel ?? 'medium',
        JSON.stringify((dto.watchedSymbols ?? []).map((s) => s.toUpperCase())),
        dto.maxPositionSizePercent ?? 2,
        dto.dailyLossLimitPercent ?? 3,
        dto.enabled ? 1 : 0,
        dto.mode ?? 'propose',
        new Date().toISOString(),
      ],
    });
    return this.getOne(accountId, agentId);
  }

  async update(accountId: string, agentId: string, dto: UpdateAgentDto): Promise<AgentInstance> {
    await this.getOne(accountId, agentId);
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    if (dto.name !== undefined) {
      assignments.push('name = ?');
      values.push(dto.name.trim());
    }
    if (dto.profile !== undefined) {
      assignments.push('profile = ?');
      values.push(dto.profile);
    }
    if (dto.instructions !== undefined) {
      assignments.push('instructions = ?');
      values.push(dto.instructions);
    }
    if (dto.thinkingLevel !== undefined) {
      assignments.push('thinking_level = ?');
      values.push(dto.thinkingLevel);
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
    if (dto.enabled !== undefined) {
      assignments.push('enabled = ?');
      values.push(dto.enabled ? 1 : 0);
    }
    if (dto.mode !== undefined) {
      assignments.push('mode = ?');
      values.push(dto.mode);
    }
    if (dto.resetCircuitBreaker === true) {
      assignments.push('circuit_breaker_active = 0');
      assignments.push('circuit_breaker_reason = NULL');
    }
    if (assignments.length > 0) {
      await this.db.execute({
        sql: `UPDATE ai_agents SET ${assignments.join(', ')} WHERE id = ? AND account_id = ?`,
        args: [...values, agentId, accountId],
      });
    }
    return this.getOne(accountId, agentId);
  }

  async remove(accountId: string, agentId: string): Promise<void> {
    await this.getOne(accountId, agentId);
    await this.db.execute({
      sql: 'DELETE FROM ai_agents WHERE id = ? AND account_id = ?',
      args: [agentId, accountId],
    });
  }

  async runCycleForAllAgents(): Promise<number> {
    const rows = await this.db.execute({
      sql: 'SELECT * FROM ai_agents WHERE enabled = 1 AND circuit_breaker_active = 0',
      args: [],
    });
    let processed = 0;
    for (const row of rows.rows) {
      try {
        await this.runCycleForAgent(this.mapRow(row));
        processed += 1;
      } catch (error) {
        this.logger.warn(
          `Agent cycle failed for ${String(row.id)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return processed;
  }

  async runAgentNow(accountId: string, agentId: string): Promise<AiDecision[]> {
    const agent = await this.getOne(accountId, agentId);
    if (agent.circuitBreakerActive) {
      throw ApiErrors.dailyLossLimitReached(0, 0);
    }
    const decisions: AiDecision[] = [];
    const dailyPnl = await this.accounts.getDailyPnl(accountId);
    for (const symbol of agent.watchedSymbols.slice(0, MAX_SYMBOLS_PER_AGENT_RUN)) {
      const decision = await this.runDecision(agent, symbol, dailyPnl);
      if (decision) {
        decisions.push(decision);
      }
    }
    return decisions;
  }

  private async runCycleForAgent(agent: AgentInstance): Promise<void> {
    const { startingBalance } = await this.accounts.getBalanceAndStarting(agent.accountId);
    const dailyPnl = await this.accounts.getDailyPnl(agent.accountId);
    const lossThreshold = (startingBalance * agent.dailyLossLimitPercent) / 100;
    if (dailyPnl <= -lossThreshold) {
      await this.db.execute({
        sql: 'UPDATE ai_agents SET circuit_breaker_active = 1, circuit_breaker_reason = ? WHERE id = ?',
        args: [
          `Daily PnL ${dailyPnl.toFixed(2)} reached the configured loss limit of ${lossThreshold.toFixed(2)}`,
          agent.id,
        ],
      });
      this.logger.warn(`Circuit breaker tripped for agent ${agent.name} (${agent.accountId})`);
      return;
    }
    for (const symbol of agent.watchedSymbols.slice(0, MAX_SYMBOLS_PER_AGENT_RUN)) {
      try {
        await this.runDecision(agent, symbol, dailyPnl);
      } catch (error) {
        this.logger.warn(
          `Decision for ${symbol} by agent ${agent.name} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async runDecision(
    agent: AgentInstance,
    symbol: string,
    dailyPnl: number,
  ): Promise<AiDecision | null> {
    const build = await this.contextEngine.build(agent.accountId, symbol);
    if (!build.ok || !build.context) {
      this.logger.log(
        `Skipping ${symbol} for agent ${agent.name}: ${build.reason ?? 'unknown'}`,
      );
      return null;
    }
    const marketContext = build.context;
    const thinkingLevel = agent.profile === 'news' && build.thinkingLevel === 'medium' ? 'high' : build.thinkingLevel;

    const geminiResult = await this.gemini.decide({
      systemInstruction: this.buildSystemInstruction(agent),
      userPrompt: JSON.stringify(marketContext),
      thinkingLevel,
      tools: agent.profile === 'news' ? [{ type: 'google_search' }] : undefined,
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
        maxPositionSizePercent: agent.maxPositionSizePercent,
        dailyLossLimitPercent: agent.dailyLossLimitPercent,
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
      if (agent.mode === 'autonomous') {
        try {
          const order = await this.orders.createOrder(
            agent.accountId,
            decisionToOrderDto(marketContext.symbol, normalized),
            'ai_agent',
          );
          resultingOrderId = order.id;
        } catch (error) {
          const code =
            error instanceof HttpException
              ? ((error.getResponse() as { error?: string }).error ?? 'ORDER_REJECTED')
              : 'ORDER_REJECTED';
          validationErrors.push(code);
        }
      }
    }

    const decisionId = randomUUID();
    await this.db.execute({
      sql: `INSERT INTO ai_decisions (id, account_id, agent_id, agent_name, symbol, action, confidence_score, proposed_quantity, proposed_stop_loss, proposed_take_profit, full_reasoning, reasoning_summary, key_factors, validation_passed, validation_errors, resulting_order_id, model_used, thinking_level, context_json, raw_response, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        decisionId,
        agent.accountId,
        agent.id,
        agent.name,
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
        thinkingLevel,
        JSON.stringify(marketContext),
        JSON.stringify(geminiResult.raw),
        new Date().toISOString(),
      ],
    });

    return this.readDecision(agent.accountId, decisionId);
  }

  private buildSystemInstruction(agent: AgentInstance): string {
    const base = PROFILE_PROMPTS[agent.profile] ?? PROFILE_PROMPTS.custom;
    const maxPositionValue = `Limite stricte : la valeur totale de la position (proposed_quantity × spotPrice) ne doit pas dépasser ${agent.maxPositionSizePercent}% du capital total. Calcule proposed_quantity en conséquence.`;
    if (agent.profile === 'custom' && agent.instructions && agent.instructions.trim().length > 0) {
      return `${base}\n${maxPositionValue}\nInstructions personnalisées du propriétaire :\n${agent.instructions.trim()}`;
    }
    if (agent.profile !== 'custom' && agent.instructions && agent.instructions.trim().length > 0) {
      return `${base}\n${maxPositionValue}\nInstructions supplémentaires :\n${agent.instructions.trim()}`;
    }
    return `${base}\n${maxPositionValue}`;
  }

  private async readDecision(accountId: string, decisionId: string): Promise<AiDecision> {
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

  private mapDecisionRow(row: Record<string, unknown>): AiDecision {
    const parseArray = (value: unknown): string[] => {
      try {
        const parsed: unknown = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : [];
      } catch {
        return [];
      }
    };
    const nullableNumber = (value: unknown): number | null =>
      value === null || value === undefined ? null : Number(value);
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
      proposedQuantity: nullableNumber(row.proposed_quantity),
      proposedStopLoss: nullableNumber(row.proposed_stop_loss),
      proposedTakeProfit: nullableNumber(row.proposed_take_profit),
      fullReasoning: String(row.full_reasoning),
      reasoningSummary: String(row.reasoning_summary),
      keyFactors: parseArray(row.key_factors),
      validationPassed: Number(row.validation_passed) === 1,
      validationErrors: parseArray(row.validation_errors),
      resultingOrderId,
      modelUsed: String(row.model_used) === 'gemini-3.6-flash' ? 'gemini-3.6-flash' : 'gemini-3.7-flash',
      thinkingLevel:
        String(row.thinking_level) === 'high'
          ? 'high'
          : String(row.thinking_level) === 'low'
            ? 'low'
            : 'medium',
      createdAt: String(row.created_at),
    };
  }

  private mapRow(row: Record<string, unknown>): AgentInstance {
    let watchedSymbols: string[] = [];
    try {
      const parsed = safelyParse(String(row.watched_symbols));
      if (Array.isArray(parsed)) {
        watchedSymbols = parsed.filter((s): s is string => typeof s === 'string');
      }
    } catch {
      watchedSymbols = [];
    }
    const profileValue = String(row.profile);
    const profile: AgentProfile = (AGENT_PROFILES as readonly string[]).includes(profileValue)
      ? (profileValue as AgentProfile)
      : 'custom';
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      name: String(row.name),
      profile,
      instructions: row.instructions === null || row.instructions === undefined ? null : String(row.instructions),
      thinkingLevel: String(row.thinking_level) === 'high' ? 'high' : String(row.thinking_level) === 'low' ? 'low' : 'medium',
      watchedSymbols,
      maxPositionSizePercent: Number(row.max_position_size_percent),
      dailyLossLimitPercent: Number(row.daily_loss_limit_percent),
      enabled: Number(row.enabled) === 1,
      mode: String(row.mode) === 'autonomous' ? 'autonomous' : 'propose',
      circuitBreakerActive: Number(row.circuit_breaker_active) === 1,
      circuitBreakerReason:
        row.circuit_breaker_reason === null || row.circuit_breaker_reason === undefined
          ? null
          : String(row.circuit_breaker_reason),
    };
  }
}

function decisionToOrderDto(symbol: string, normalized: NormalizedDecision): CreateOrderDto {
  const dto = new CreateOrderDto();
  dto.symbol = symbol;
  dto.type = 'market';
  dto.side = normalized.action === 'BUY' ? 'buy' : 'sell';
  dto.quantity = normalized.proposedQuantity ?? 0;
  dto.limitPrice = undefined;
  dto.stopLoss = normalized.proposedStopLoss ?? undefined;
  dto.takeProfit = normalized.proposedTakeProfit ?? undefined;
  return dto;
}
