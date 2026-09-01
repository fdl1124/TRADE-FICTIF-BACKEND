import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThinkingLevel } from './context-engine.service';
import { GeminiKeyRing } from './gemini-key-ring';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const GEMINI_PRIMARY_MODEL = process.env.GEMINI_PRIMARY_MODEL || 'gemini-3.7-flash';
export const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';
export const GEMINI_SECONDARY_FALLBACK_MODEL = process.env.GEMINI_SECONDARY_FALLBACK_MODEL || 'gemini-2.5-flash';
export const GEMINI_DECISION_MODEL = process.env.GEMINI_DECISION_MODEL || 'gemini-3.6-flash';
const PRIMARY_TIMEOUT_MS = 60_000;
const FALLBACK_TIMEOUT_MS = 30_000;
const MAX_KEYS = 10;
const KEY_FAILURE_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);
const STREAM_IDLE_TIMEOUT_MS = 90_000;

interface StreamWireEvent {
  event_type?: string;
  status?: string;
  index?: number;
  step?: { type?: string; name?: string; id?: string };
  delta?: {
    type?: string;
    text?: string;
    arguments_json?: string;
    json?: string;
  };
  interaction?: { id?: string };
  interaction_id?: string;
  error?: { message?: string; code?: string };
}

export type GeminiModelName = string;

export interface GeminiDecisionRequest {
  systemInstruction: string;
  userPrompt: string;
  thinkingLevel: ThinkingLevel;
  tools?: unknown[];
}

export interface GeminiStreamRequest {
  systemInstruction: string;
  input:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'inline_data'; mime_type: string; data: string }
        | {
            type: 'function_result';
            name: string;
            call_id: string;
            result: Array<{ type: 'text'; text: string }>;
          }
      >;
  thinkingLevel: ThinkingLevel;
  tools?: unknown[];
  previousInteractionId?: string;
}

export type GeminiStreamEvent =
  | { kind: 'step_started'; stepType: string; name?: string }
  | { kind: 'text_delta'; text: string }
  | { kind: 'thought_delta'; text: string }
  | { kind: 'function_call'; callId: string; name: string; argumentsJson: string }
  | { kind: 'requires_action' }
  | { kind: 'completed'; interactionId: string }
  | { kind: 'failed'; message: string };

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
  body: string;
  constructor(readonly status: number, body = '') {
    super(`HTTP ${status}`);
    this.body = body.slice(0, 300);
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

function normalizeThinkingLevel(model: string, level: ThinkingLevel): ThinkingLevel {
  if (level === 'medium' && model.startsWith('gemini-2.5')) return 'low';
  return level;
}

function describeFailure(model: string, keyIndex: number, error: unknown): string {
  const message =
    error instanceof GeminiHttpError && error.body
      ? `${error.message} ${error.body}`
      : error instanceof Error
        ? error.message
        : String(error);
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
      { model: GEMINI_DECISION_MODEL, timeoutMs: FALLBACK_TIMEOUT_MS },
      { model: GEMINI_SECONDARY_FALLBACK_MODEL, timeoutMs: FALLBACK_TIMEOUT_MS },
      { model: GEMINI_PRIMARY_MODEL, timeoutMs: PRIMARY_TIMEOUT_MS },
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
            if (error.status === 429) {
              this.logger.warn(
                `${attempt.model} surcharge (HTTP 429) sur la clé #${keyIndex + 1}, bascule sur le modele de repli`,
              );
              onlyKeyFailures = false;
              break;
            }
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
          this.logger.warn(`${attempt.model} failed on key #${keyIndex + 1}: ${describeFailure(attempt.model, keyIndex, error)}`);
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
            thinking_level: normalizeThinkingLevel(attempt.model, request.thinkingLevel),
            thinking_summaries: 'auto',
          },
          store: false,
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new GeminiHttpError(response.status, errBody);
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

  async *streamInteraction(request: GeminiStreamRequest): AsyncGenerator<GeminiStreamEvent> {
    const attempts = [GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_SECONDARY_FALLBACK_MODEL];
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
      const model = attempts[attemptIndex];
      let retried = false;
      let attempt = 0;
      while (attempt <= this.ring.size && !retried) {
        const keyIndex = this.ring.currentIndexValue();
        const apiKey = this.ring.currentKey();
        if (apiKey === null) {
          yield { kind: 'failed', message: 'no Gemini API key configured' };
          return;
        }
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
        const rearmTimer = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
        };
        try {
          const response = await fetch(GEMINI_INTERACTIONS_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              model,
              input: request.input,
              system_instruction: request.systemInstruction,
              generation_config: {
                thinking_level: normalizeThinkingLevel(model, request.thinkingLevel),
                thinking_summaries: 'auto',
              },
              store: false,
              stream: true,
              ...(request.previousInteractionId
                ? { previous_interaction_id: request.previousInteractionId }
                : {}),
              ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
            }),
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            const errBody = await response.text().catch(() => '');
            throw new GeminiHttpError(response.status, errBody);
          }
          const decoder = new TextDecoder();
          let buffer = '';
          let sawRequiresAction = false;
          let currentStep: { index: number; type: string; name?: string; callId?: string } | null = null;
          let argumentBuffer = '';
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            rearmTimer();
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) {
                continue;
              }
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === '[DONE]') {
                continue;
              }
              let event: StreamWireEvent;
              try {
                event = JSON.parse(payload) as StreamWireEvent;
              } catch {
                continue;
              }
              const eventType = event.event_type ?? '';
              if (eventType === 'step.start') {
                currentStep = {
                  index: Number(event.index ?? 0),
                  type: String(event.step?.type ?? ''),
                  name: typeof event.step?.name === 'string' ? event.step.name : undefined,
                  callId: typeof event.step?.id === 'string' ? event.step.id : undefined,
                };
                argumentBuffer = '';
                yield { kind: 'step_started', stepType: currentStep.type, name: currentStep.name };
              } else if (eventType === 'step.delta' && event.delta) {
                const delta = event.delta;
                if (delta.type === 'text' && typeof delta.text === 'string') {
                  yield { kind: 'text_delta', text: delta.text };
                } else if (delta.type === 'thought_summary' && typeof delta.text === 'string') {
                  yield { kind: 'thought_delta', text: delta.text };
                } else if (delta.type === 'arguments_delta') {
                  const fragment =
                    typeof delta.arguments_json === 'string'
                      ? delta.arguments_json
                      : typeof delta.json === 'string'
                        ? delta.json
                        : '';
                  argumentBuffer += fragment;
                }
              } else if (eventType === 'step.stop' && currentStep?.type === 'function_call') {
                yield {
                  kind: 'function_call',
                  callId: currentStep.callId ?? String(currentStep.index),
                  name: currentStep.name ?? '',
                  argumentsJson: argumentBuffer || '{}',
                };
                currentStep = null;
                argumentBuffer = '';
              } else if (eventType === 'interaction.status_update' && event.status === 'requires_action') {
                sawRequiresAction = true;
                yield { kind: 'requires_action' };
              } else if (eventType === 'interaction.completed') {
                const interactionId =
                  event.interaction && typeof event.interaction.id === 'string'
                    ? event.interaction.id
                    : typeof event.interaction_id === 'string'
                      ? event.interaction_id
                      : '';
                yield { kind: 'completed', interactionId };
                return;
              } else if (eventType === 'error') {
                const message =
                  event.error && typeof event.error.message === 'string' ? event.error.message : 'stream error';
                throw new Error(message);
              }
            }
          }
          if (!sawRequiresAction) {
            yield { kind: 'completed', interactionId: '' };
          }
          return;
        } catch (error) {
          if (timer) clearTimeout(timer);
          timer = null;
          const message =
            error instanceof GeminiHttpError && error.body
              ? `${error.message} ${error.body}`
              : error instanceof Error
                ? error.message
                : String(error);
          if (error instanceof GeminiHttpError && KEY_FAILURE_STATUSES.has(error.status)) {
            if (error.status === 429) {
              this.logger.warn(`${model} surcharge (HTTP 429) pendant le stream sur la clé #${keyIndex + 1}`);
              if (attemptIndex < attempts.length - 1) {
                break;
              }
              yield { kind: 'failed', message: 'Modele Gemini en forte demande, reessaie dans un instant' };
              return;
            }
            this.ring.markFailed(keyIndex, keyFailureReason(error.status));
            if (this.ring.size > 1 && this.ring.rotateToNextAvailable()) {
              this.logger.warn(
                `Gemini key #${keyIndex + 1} rejected during stream (HTTP ${error.status}), rotating to key #${this.ring.currentIndexValue() + 1}`,
              );
              continue;
            }
          }
          if (attemptIndex < attempts.length - 1) {
            this.logger.warn(`Streaming with ${model} failed: ${message}, trying next model`);
            break;
          }
          yield { kind: 'failed', message };
          return;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
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
