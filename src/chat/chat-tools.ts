import { AccountService } from '../portfolio/account.service';
import { PositionsService } from '../portfolio/positions.service';
import { OrdersService } from '../orders/orders.service';
import { MarketDataService } from '../market-data/market-data.service';
import { ContextEngineService } from '../ai-agent/context-engine.service';
import { ASSETS } from '../common/constants/assets';
import { ListOrdersQueryDto } from '../common/dto/query-dtos';

export const PLATFORM_TOOL_DECLARATIONS: unknown[] = [
  {
    type: 'function',
    name: 'get_portfolio_summary',
    description:
      'Get the user simulated portfolio summary: cash balance, open positions value, total PnL and PnL percentage.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'get_positions',
    description:
      'List every open position of the user with quantity, entry price, current price and unrealized PnL.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'get_asset_snapshot',
    description:
      'Get a live market snapshot for one tradable asset: spot price, 24h change, RSI14, SMA20/50, volatility.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Tradable symbol, e.g. BTCUSDT or AAPL' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'get_order_history',
    description: 'Get the recent order history of the user, newest first.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of orders to return (default 20, max 100)' },
        status: { type: 'string', description: 'Optional filter: pending, filled, rejected or cancelled' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'search_assets',
    description: 'Search the list of tradable assets by symbol or name keyword.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword such as BTC, Apple or Tesla' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'propose_order',
    description:
      'Propose a trade for the user. It is NEVER executed automatically: the proposal is shown to the user who must confirm it in the UI before anything happens.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Tradable symbol' },
        side: { type: 'string', description: '"buy" or "sell"' },
        quantity: { type: 'number', description: 'Quantity in units of the asset' },
        order_type: { type: 'string', description: '"market" or "limit"' },
        limit_price: { type: 'number', description: 'Required when order_type is limit' },
        rationale: { type: 'string', description: 'One short sentence explaining the trade' },
      },
      required: ['symbol', 'side', 'quantity', 'order_type'],
    },
  },
];

export interface OrderProposal {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  type: 'market' | 'limit';
  limitPrice: number | null;
  rationale: string | null;
}

interface ToolArgs {
  symbol?: string;
  query?: string;
  limit?: number;
  status?: string;
  side?: string;
  quantity?: number;
  order_type?: string;
  limit_price?: number;
  rationale?: string;
}

export class PlatformToolExecutor {
  constructor(
    private readonly accountId: string,
    private readonly accounts: AccountService,
    private readonly positions: PositionsService,
    private readonly orders: OrdersService,
    private readonly marketData: MarketDataService,
    private readonly contextEngine: ContextEngineService,
  ) {}

  async execute(
    name: string,
    argumentsJson: string,
  ): Promise<{ result: unknown; orderProposal?: OrderProposal }> {
    let args: ToolArgs = {};
    try {
      const parsed: unknown = JSON.parse(argumentsJson || '{}');
      if (parsed && typeof parsed === 'object') {
        args = parsed as ToolArgs;
      }
    } catch {
      args = {};
    }

    switch (name) {
      case 'get_portfolio_summary': {
        const account = await this.accounts.getAccount(this.accountId);
        const summary = await this.accounts.getSummary(this.accountId);
        return {
          result: {
            cashBalance: account.balance,
            startingBalance: account.startingBalance,
            positionsValue: summary.totalPositionsValue,
            totalPnl: summary.totalPnl,
            totalPnlPercent: summary.totalPnlPercent,
          },
        };
      }
      case 'get_positions': {
        const list = await this.positions.list(this.accountId);
        return {
          result: list.map((p) => ({
            symbol: p.symbol,
            quantity: p.quantity,
            avgEntryPrice: p.avgEntryPrice,
            currentPrice: p.currentPrice,
            unrealizedPnl: p.unrealizedPnl,
            unrealizedPnlPercent: p.unrealizedPnlPercent,
          })),
        };
      }
      case 'get_asset_snapshot': {
        const symbol = String(args.symbol ?? '').toUpperCase();
        const snapshot = await this.contextEngine.buildMarketSnapshot(symbol);
        if (!snapshot || snapshot.symbol !== symbol) {
          return { result: { error: `Unknown symbol or unavailable data for ${symbol}` } };
        }
        return {
          result: {
            symbol: snapshot.symbol,
            type: snapshot.assetType,
            exchange: snapshot.exchange,
            marketOpen: snapshot.marketOpen,
            spotPrice: snapshot.spotPrice,
            change24hPercent: snapshot.change24hPct,
            rsi14: snapshot.rsi14,
            sma20: snapshot.sma20,
            sma50: snapshot.sma50,
            volatilityPercent: snapshot.volatilityPct,
          },
        };
      }
      case 'get_order_history': {
        const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 100);
        const status = ['pending', 'filled', 'rejected', 'cancelled'].includes(String(args.status))
          ? (String(args.status) as 'pending' | 'filled' | 'rejected' | 'cancelled')
          : undefined;
        const query = new ListOrdersQueryDto();
        query.limit = limit;
        query.status = status;
        const list = await this.orders.list(this.accountId, query);
        return {
          result: list.map((o) => ({
            side: o.side,
            symbol: o.symbol,
            type: o.type,
            quantity: o.quantity,
            requestedPrice: o.requestedPrice,
            filledPrice: o.filledPrice,
            slippagePercent: o.slippage,
            status: o.status,
            source: o.source,
            createdAt: o.createdAt,
          })),
        };
      }
      case 'search_assets': {
        const q = String(args.query ?? '').toLowerCase();
        return {
          result: ASSETS.filter((a) => `${a.symbol} ${a.name}`.toLowerCase().includes(q)).map((a) => ({
            symbol: a.symbol,
            name: a.name,
            type: a.type,
            exchange: a.exchange,
          })),
        };
      }
      case 'propose_order': {
        const symbol = String(args.symbol ?? '').toUpperCase();
        const side = String(args.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy';
        const quantity = Number(args.quantity ?? 0);
        const type = String(args.order_type ?? '') === 'limit' ? 'limit' : 'market';
        const limitPrice = Number.isFinite(Number(args.limit_price)) ? Number(args.limit_price) : null;
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return { result: { error: 'quantity must be a positive number' } };
        }
        if (type === 'limit' && (limitPrice === null || limitPrice <= 0)) {
          return { result: { error: 'limit orders require a positive limit_price' } };
        }
        const proposal: OrderProposal = {
          symbol,
          side,
          quantity,
          type,
          limitPrice,
          rationale: typeof args.rationale === 'string' ? args.rationale : null,
        };
        return {
          result: {
            proposalCreated: true,
            note: 'The proposal was created and shown to the user. Nothing is executed until the user confirms it in the UI.',
            proposal,
          },
          orderProposal: proposal,
        };
      }
      default:
        return { result: { error: `Unknown tool ${name}` } };
    }
  }
}
