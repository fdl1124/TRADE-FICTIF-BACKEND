import { HttpException } from '@nestjs/common';

export class ApiErrorCodeException extends HttpException {
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ error: code, message, details: details ?? undefined }, status);
    this.code = code;
    this.details = details;
  }
}

export const ApiErrors = {
  unauthorized: (message = 'Valid Firebase authentication required') =>
    new ApiErrorCodeException(401, 'UNAUTHORIZED', message),
  forbidden: () =>
    new ApiErrorCodeException(403, 'FORBIDDEN', 'Resource does not belong to the authenticated user'),
  notFound: (what: string) => new ApiErrorCodeException(404, 'NOT_FOUND', `${what} not found`),
  invalidSymbol: (symbol: string) =>
    new ApiErrorCodeException(400, 'INVALID_SYMBOL', `Symbol ${symbol} is not a tradable asset`),
  marketClosed: (symbol: string) =>
    new ApiErrorCodeException(
      400,
      'MARKET_CLOSED',
      `Market is closed for ${symbol}: US stocks trade 09:30-16:00 ET, Monday to Friday, excluding NYSE holidays`,
    ),
  stalePrice: (symbol: string) =>
    new ApiErrorCodeException(
      503,
      'STALE_PRICE_DATA',
      `No price fresher than 500ms available for ${symbol}, order refused`,
    ),
  insufficientBalance: (needed: number, available: number) =>
    new ApiErrorCodeException(
      400,
      'INSUFFICIENT_BALANCE',
      `Order requires approximately $${needed.toFixed(2)} but balance is $${available.toFixed(2)}`,
    ),
  insufficientPosition: (symbol: string, requested: number, held: number) =>
    new ApiErrorCodeException(
      400,
      'INSUFFICIENT_POSITION',
      `Cannot sell ${requested} ${symbol}: only ${held} held and short selling is not supported`,
    ),
  positionSizeExceeded: (cost: number, maxAllowed: number) =>
    new ApiErrorCodeException(
      400,
      'POSITION_SIZE_EXCEEDED',
      `Position cost $${cost.toFixed(2)} exceeds the maximum allowed $${maxAllowed.toFixed(2)} for this account`,
    ),
  dailyLossLimitReached: (loss: number, limit: number) =>
    new ApiErrorCodeException(
      400,
      'DAILY_LOSS_LIMIT_REACHED',
      `Daily loss $${loss.toFixed(2)} reached the configured limit of $${limit.toFixed(2)}, AI agent is halted by the circuit breaker`,
    ),
  notPendingOrder: (status: string) =>
    new ApiErrorCodeException(
      400,
      'ORDER_NOT_CANCELLABLE',
      `Only pending orders can be cancelled, this order is ${status}`,
    ),
  alreadyProcessed: () =>
    new ApiErrorCodeException(400, 'ALREADY_PROCESSED', 'This AI decision has already been approved or rejected'),
  notApprovable: () =>
    new ApiErrorCodeException(
      400,
      'DECISION_NOT_APPROVABLE',
      'Only validated BUY or SELL decisions pending in propose mode can be approved',
    ),
  limitPriceRequired: () =>
    new ApiErrorCodeException(400, 'LIMIT_PRICE_REQUIRED', 'limitPrice is required when order type is limit'),
};
