import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { Response } from 'express';
import { LIBSQL_CLIENT } from '../database/libsql-token';
import { AccountService } from '../portfolio/account.service';
import { PositionsService } from '../portfolio/positions.service';
import { OrdersService } from '../orders/orders.service';
import { MarketDataService } from '../market-data/market-data.service';
import { ContextEngineService } from '../ai-agent/context-engine.service';
import { GeminiService } from '../ai-agent/gemini.service';
import { ApiErrors } from '../common/api-error';
import { PLATFORM_TOOL_DECLARATIONS, PlatformToolExecutor, OrderProposal } from './chat-tools';

const HISTORY_WINDOW = 20;
const MAX_FUNCTION_LOOPS = 5;
const DEFAULT_TITLE = 'Nouvelle conversation';
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface ConversationSummary {
  id: string;
  accountId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageView {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: Array<{ name: string; mimeType: string }>;
  toolSteps: Array<{ name: string; summary: string }>;
  thinking: string;
  sources: string[];
  orderProposal: OrderProposal | null;
  createdAt: string;
}

interface SendMessageOptions {
  content: string;
  attachments: Array<{ name: string; mimeType: string; dataBase64: string }>;
  thinkingEnabled: boolean;
}

type FunctionResultBlock = {
  type: 'function_result';
  name: string;
  call_id: string;
  result: Array<{ type: 'text'; text: string }>;
};

function safelyParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(LIBSQL_CLIENT) private readonly db: Client,
    private readonly accounts: AccountService,
    private readonly positions: PositionsService,
    private readonly orders: OrdersService,
    private readonly marketData: MarketDataService,
    private readonly contextEngine: ContextEngineService,
    private readonly gemini: GeminiService,
  ) {}

  async listConversations(
    accountId: string,
  ): Promise<Array<{ id: string; title: string; createdAt: string; updatedAt: string }>> {
    const result = await this.db.execute({
      sql: 'SELECT id, title, created_at, updated_at FROM chat_conversations WHERE account_id = ? ORDER BY updated_at DESC',
      args: [accountId],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  async createConversation(accountId: string, title?: string): Promise<ConversationSummary> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.execute({
      sql: 'INSERT INTO chat_conversations (id, account_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [id, accountId, title?.trim() || DEFAULT_TITLE, now, now],
    });
    return { id, accountId, title: title?.trim() || DEFAULT_TITLE, createdAt: now, updatedAt: now };
  }

  async deleteConversation(accountId: string, conversationId: string): Promise<void> {
    await this.assertOwnership(accountId, conversationId);
    await this.db.execute({
      sql: 'DELETE FROM chat_messages WHERE conversation_id = ?',
      args: [conversationId],
    });
    await this.db.execute({
      sql: 'DELETE FROM chat_conversations WHERE id = ? AND account_id = ?',
      args: [conversationId, accountId],
    });
  }

  async listMessages(accountId: string, conversationId: string): Promise<ChatMessageView[]> {
    await this.assertOwnership(accountId, conversationId);
    const result = await this.db.execute({
      sql: 'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      args: [conversationId],
    });
    return result.rows.map((row) => this.mapMessageRow(row));
  }

  private buildSystemInstruction(): string {
    return `You are the AI assistant embedded in Ledger, a simulated trading platform for stocks and crypto where all money is fictional.
Current date: ${new Date().toISOString().slice(0, 10)}.
You have tools to read the user's portfolio, positions, order history, live asset snapshots and to search the web. Use them whenever they help you give a precise, data-driven answer instead of guessing numbers.
When the user wants to trade, use the propose_order tool: it only creates a proposal that the user confirms in the UI. Never tell the user an order was executed unless they confirmed it and told you so.
Answer in the same language as the user (French if they write in French). Be concise, structured and factual. You may format answers with Markdown.`;
  }

  private async buildHistoryInput(
    conversationId: string,
    newContent: string,
    attachmentNames: string[],
  ): Promise<string> {
    const history = await this.db.execute({
      sql: 'SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [conversationId, HISTORY_WINDOW],
    });
    const turns = history.rows.reverse().map((row) => ({
      role: String(row.role),
      content: String(row.content).slice(0, 4000),
    }));
    let input = '';
    if (turns.length > 0) {
      input += 'Previous conversation:\n';
      for (const turn of turns) {
        input += `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}\n`;
      }
      input += '\n';
    }
    input += `New user message: ${newContent}`;
    if (attachmentNames.length > 0) {
      input += `\nThe user attached ${attachmentNames.length} file(s): ${attachmentNames.join(', ')}. Their contents are provided with this request.`;
    }
    return input;
  }

  async sendMessageStream(
    accountId: string,
    conversationId: string,
    options: SendMessageOptions,
    response: Response,
  ): Promise<void> {
    await this.assertOwnership(accountId, conversationId);

    const attachmentBytes = options.attachments.reduce(
      (sum, a) => sum + Math.ceil((a.dataBase64.length * 3) / 4),
      0,
    );
    if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
      throw ApiErrors.validation({ message: 'Attachments exceed the 15 MB total limit' });
    }

    const userMessageId = randomUUID();
    await this.db.execute({
      sql: "INSERT INTO chat_messages (id, conversation_id, role, content, attachments, tool_steps, thinking, sources, order_proposal, created_at) VALUES (?, ?, 'user', ?, ?, NULL, NULL, NULL, NULL, ?)",
      args: [
        userMessageId,
        conversationId,
        options.content,
        JSON.stringify(options.attachments.map((a) => ({ name: a.name, mimeType: a.mimeType }))),
        new Date().toISOString(),
      ],
    });

    const titleRow = await this.db.execute({
      sql: 'SELECT title FROM chat_conversations WHERE id = ? AND account_id = ?',
      args: [conversationId, accountId],
    });
    const currentTitle = String(titleRow.rows[0]?.title ?? '');
    if (currentTitle === DEFAULT_TITLE && options.content.trim().length > 0) {
      await this.db.execute({
        sql: 'UPDATE chat_conversations SET title = ? WHERE id = ?',
        args: [options.content.trim().slice(0, 60), conversationId],
      });
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const send = (eventName: string, data: unknown): void => {
      response.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('user_saved', { messageId: userMessageId });

    const executor = new PlatformToolExecutor(
      accountId,
      this.accounts,
      this.positions,
      this.orders,
      this.marketData,
      this.contextEngine,
    );

    const thinkingLevel = options.thinkingEnabled ? ('high' as const) : ('low' as const);
    const systemInstruction = this.buildSystemInstruction();
    const firstInput = await this.buildHistoryInput(
      conversationId,
      options.content,
      options.attachments.map((a) => a.name),
    );

    const orderedCopies: Array<{ type: 'inline_data'; mime_type: string; data: string }> =
      options.attachments.length > 0
        ? options.attachments.map((attachment) => ({
            type: 'inline_data' as const,
            mime_type: attachment.mimeType,
            data: attachment.dataBase64,
          }))
        : [];

    const geminiInput =
      orderedCopies.length > 0
        ? [{ type: 'text', text: firstInput }, ...orderedCopies]
        : firstInput;

    let answerText = '';
    let interactionId: string | undefined;
    let input: string | Array<{ type: string; name?: string; call_id?: string; result?: Array<{ type: string; text: string }>; text?: string; inline_data?: unknown }> =
      geminiInput;
    const thinkingParts: string[] = [];
    const toolSteps: Array<{ name: string; summary: string }> = [];
    const sourceUrls = new Set<string>();
    let orderProposal: OrderProposal | null = null;
    let failureMessage: string | null = null;

    try {
      for (let loop = 0; loop <= MAX_FUNCTION_LOOPS; loop++) {
        let pendingCall: { callId: string; name: string; argumentsJson: string } | null = null;
        let gotCompleted = false;

        for await (const event of this.gemini.streamInteraction({
          systemInstruction,
          input,
          thinkingLevel,
          tools: [...PLATFORM_TOOL_DECLARATIONS, { type: 'google_search' }, { type: 'url_context' }],
          previousInteractionId: loop === 0 ? undefined : interactionId,
        })) {
          switch (event.kind) {
            case 'step_started': {
              if (event.stepType === 'google_search_call') {
                send('status', { label: 'Recherche web…' });
              } else if (event.stepType === 'url_context_call') {
                send('status', { label: 'Analyse du lien…' });
              } else if (event.stepType === 'function_call') {
                send('status', { label: 'Consultation des données…' });
              } else if (event.stepType === 'thought') {
                send('status', { label: 'Réflexion…' });
              }
              break;
            }
            case 'text_delta': {
              answerText += event.text;
              send('delta', { text: event.text });
              break;
            }
            case 'thought_delta': {
              thinkingParts.push(event.text);
              send('thinking_delta', { text: event.text });
              break;
            }
            case 'function_call': {
              pendingCall = {
                callId: event.callId,
                name: event.name,
                argumentsJson: event.argumentsJson,
              };
              break;
            }
            case 'completed': {
              gotCompleted = true;
              if (event.interactionId) {
                interactionId = event.interactionId;
              }
              break;
            }
            case 'failed': {
              failureMessage = event.message;
              break;
            }
          }
          if (pendingCall || failureMessage) {
            break;
          }
        }

        if (failureMessage) {
          this.logger.warn(`Chat stream failed: ${failureMessage}`);
          send('error', { message: 'La génération a échoué. Réessayez.' });
          break;
        }

        if (!pendingCall || gotCompleted) {
          break;
        }

        toolSteps.push({ name: pendingCall.name, summary: pendingCall.argumentsJson.slice(0, 200) });
        const execution = await executor.execute(pendingCall.name, pendingCall.argumentsJson);
        if (execution.orderProposal) {
          orderProposal = execution.orderProposal;
        }
        send('tool_done', { name: pendingCall.name });

        if (!interactionId) {
          this.logger.warn('Cannot continue function calling without an interaction id');
          send('error', { message: 'La chaîne d’outils a été interrompue. Réessayez.' });
          break;
        }
        input = [
          {
            type: 'function_result',
            name: pendingCall.name,
            call_id: pendingCall.callId,
            result: [{ type: 'text', text: JSON.stringify(execution.result) }],
          },
        ];
      }
    } catch (error) {
      this.logger.error(
        `Chat streaming error: ${error instanceof Error ? error.message : String(error)}`,
      );
      send('error', { message: 'Erreur pendant la génération.' });
    }

    for (const match of answerText.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)) {
      sourceUrls.add(match[2]);
    }

    const assistantMessageId = randomUUID();
    const now = new Date().toISOString();
    await this.db.execute({
      sql: "INSERT INTO chat_messages (id, conversation_id, role, content, attachments, tool_steps, thinking, sources, order_proposal, created_at) VALUES (?, ?, 'assistant', ?, NULL, ?, ?, ?, ?, ?)",
      args: [
        assistantMessageId,
        conversationId,
        answerText,
        JSON.stringify(toolSteps),
        thinkingParts.join('\n\n'),
        JSON.stringify(Array.from(sourceUrls)),
        orderProposal ? JSON.stringify(orderProposal) : null,
        now,
      ],
    });
    await this.db.execute({
      sql: 'UPDATE chat_conversations SET updated_at = ? WHERE id = ?',
      args: [now, conversationId],
    });

    send('done', {
      messageId: assistantMessageId,
      orderProposal,
      sources: Array.from(sourceUrls),
      failure: failureMessage,
    });
    response.end();
  }

  private async assertOwnership(accountId: string, conversationId: string): Promise<void> {
    const existing = await this.db.execute({
      sql: 'SELECT account_id FROM chat_conversations WHERE id = ?',
      args: [conversationId],
    });
    if (existing.rows.length === 0) {
      throw ApiErrors.notFound('Conversation');
    }
    if (String(existing.rows[0].account_id) !== accountId) {
      throw ApiErrors.forbidden();
    }
  }

  private mapMessageRow(row: Record<string, unknown>): ChatMessageView {
    const parseArray = (value: unknown): unknown[] => {
      if (value === null || value === undefined) {
        return [];
      }
      const parsed = safelyParse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    };
    const attachments = parseArray(row.attachments).filter(
      (a): a is { name: string; mimeType: string } =>
        !!a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string',
    );
    const toolSteps = parseArray(row.tool_steps).filter(
      (t): t is { name: string; summary: string } =>
        !!t && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string',
    );
    const sources = parseArray(row.sources).filter((s): s is string => typeof s === 'string');
    const proposalRaw =
      row.order_proposal === null || row.order_proposal === undefined
        ? null
        : safelyParse(String(row.order_proposal));
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      role: String(row.role) === 'assistant' ? 'assistant' : 'user',
      content: String(row.content ?? ''),
      attachments,
      toolSteps,
      thinking: row.thinking === null || row.thinking === undefined ? '' : String(row.thinking),
      sources,
      orderProposal:
        proposalRaw && typeof proposalRaw === 'object'
          ? (proposalRaw as OrderProposal)
          : null,
      createdAt: String(row.created_at),
    };
  }
}
