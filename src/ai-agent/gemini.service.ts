import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThinkingLevel } from './context-engine.service';
import { GeminiKeyRing } from './gemini-key-ring';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const GEMINI_PRIMARY_MODEL = 'gemini-3.7-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.6-flash';
const PRIMARY_TIMEOUT_MS = 2_000;
const FALLBACK_TIMEOUT_MS = 8_000;
const MAX_KEYS = 10;
const KEY_FAILURE_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);

export type GeminiModelName = typeof GEMINI_PRIMARY_MODEL | typeof GEMINI_FALLBACK_MODEL;

export interface GeminiDecisionRequest {
  systemInstruction: string;
  userPrompt: string;
  thinkingLevel: ThinkingLevel;
}

export interface GeminiDecisionResult {
  ok: boolean;
  parsed: Record<string, unknown> | null;
  fullReasoning: string;
  raw: unknown;
  modelUsed: GeminiModelName;
  error?: string;
}

interface TextContent {
  type?: string;
  text?: string;
}

interface InteractionStep {
  type?: string;
  signature?: string;
  summary?: TextContent[] | TextContent;
  content?: TextContent[];
}

interface InteractionResponse {
  id?: string;
  status?: string;
  steps?: InteractionStep[];
}

class GeminiHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const DECISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['BUY', 'SELL', 'HOLD'] },
    ticker: { type: 'string' },
    confidence_score: { type: 'number' },
    proposed_quantity: { type: ['number', 'null'] },
    proposed_stop_loss: { type: ['number', 'null'] },
    proposed_take_profit: { type: ['number', 'null'] },
    reasoning_summary: { type: 'string' },
    key_factors: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'action',
    'ticker',
    'confidence_score',
    'proposed_quantity',
    'proposed_stop_loss',
    'proposed_take_profit',
    'reasoning_summary',
    'key_factors',
  ],
} as const;

function asTextContentArray(value: TextContent[] | TextContent | undefined): TextContent[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function safelyParseJson(text: string): Record<string, unknown> | null {
  if (text.trim().length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function keyFailureReason(status: number): 'auth' | 'quota' {
  return status === 429 ? 'quota' : 'auth';
}

function describeFailure(model: string, keyIndex: number, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${model} key#${keyIndex + 1}: ${message}`;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly ring: GeminiKeyRing;

  constructor(config: ConfigService) {
    const multi = (config.get<string>('GEMINI_API_KEYS') ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    const single = (config.get<string>('GEMINI_API_KEY') ?? '').trim();
    const keys = multi.length > 0 ? multi : single.length > 0 ? [single] : [];
    this.ring = new GeminiKeyRing(keys.slice(0, MAX_KEYS));
    if (this.ring.size === 0) {
      throw new Error('GEMINI_API_KEYS or GEMINI_API_KEY is required');
    }
    this.logger.log(`Gemini client initialized with ${this.ring.size} API key(s)`);
  }

  async decide(request: GeminiDecisionRequest): Promise<GeminiDecisionResult> {
    const failures: string[] = [];
    const attempts: Array<{ model: GeminiModelName; timeoutMs: number }> = [
      { model: GEMINI_PRIMARY_MODEL, timeoutMs: PRIMARY_TIMEOUT_MS },
      { model: GEMINI_FALLBACK_MODEL, timeoutMs: FALLBACK_TIMEOUT_MS },
    ];

    for (const attempt of attempts) {
      let keyTries = 0;
      let onlyKeyFailures = true;

      while (keyTries < this.ring.size) {
        const keyIndex = this.ring.currentIndexValue();
        try {
          return await this.callModel(attempt.model, request, attempt.timeoutMs);
        } catch (error) {
          failures.push(describeFailure(attempt.model, keyIndex, error));
          if (error instanceof GeminiHttpError && KEY_FAILURE_STATUSES.has(error.status)) {
            this.ring.markFailed(keyIndex, keyFailureReason(error.status));
            if (this.ring.size > 1 && this.ring.rotateToNextAvailable()) {
              this.logger.warn(
                `Gemini key #${keyIndex + 1} rejected (HTTP ${error.status}) on ${attempt.model}, rotating to key #${this.ring.currentIndexValue() + 1}`,
              );
            }
            keyTries += 1;
            continue;
          }
          onlyKeyFailures = false;
          this.logger.warn(
            `${attempt.model} failed on key #${keyIndex + 1}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          break;
        }
      }

      if (onlyKeyFailures && this.ring.size > 0 && keyTries >= this.ring.size) {
        this.logger.error('Every Gemini API key failed, giving up');
        return {
          ok: false,
          parsed: null,
          fullReasoning: '',
          raw: { failures },
          modelUsed: GEMINI_PRIMARY_MODEL,
          error: 'GEMINI_KEYS_EXHAUSTED',
        };
      }
    }

    return {
      ok: false,
      parsed: null,
      fullReasoning: '',
      raw: { failures },
      modelUsed: GEMINI_PRIMARY_MODEL,
      error: 'GEMINI_UNAVAILABLE',
    };
  }

  private async callModel(
    model: GeminiModelName,
    request: GeminiDecisionRequest,
    timeoutMs: number,
  ): Promise<GeminiDecisionResult> {
    const apiKey = this.ring.currentKey();
    if (apiKey === null) {
      throw new Error('no Gemini API key configured');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(GEMINI_INTERACTIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model,
          input: request.userPrompt,
          system_instruction: request.systemInstruction,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: DECISION_JSON_SCHEMA,
          },
          generation_config: {
            thinking_level: request.thinkingLevel,
            thinking_summaries: 'auto',
          },
          store: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new GeminiHttpError(response.status);
      }
      const json = (await response.json()) as InteractionResponse;
      return this.extractResult(model, json);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractResult(model: GeminiModelName, json: InteractionResponse): GeminiDecisionResult {
    if (json.status !== 'completed') {
      throw new Error(`interaction status ${json.status ?? 'unknown'}`);
    }

    const steps = Array.isArray(json.steps) ? json.steps : [];
    const thoughtTexts: string[] = [];
    for (const step of steps) {
      if (step.type !== 'thought') {
        continue;
      }
      const texts = asTextContentArray(step.summary)
        .map((content) => (typeof content.text === 'string' ? content.text : ''))
        .filter((text) => text.length > 0);
      thoughtTexts.push(texts.join('\n'));
    }
    const fullReasoning = thoughtTexts.filter((text) => text.length > 0).join('\n\n');

    const outputText = steps
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => asTextContentArray(step.content))
      .map((content) => (typeof content.text === 'string' ? content.text : ''))
      .join('');

    const parsed = safelyParseJson(outputText);
    if (parsed === null) {
      return {
        ok: false,
        parsed: null,
        fullReasoning,
        raw: json,
        modelUsed: model,
        error: 'MALFORMED_JSON',
      };
    }

    return {
      ok: true,
      parsed,
      fullReasoning,
      raw: json,
      modelUsed: model,
    };
  }
}
