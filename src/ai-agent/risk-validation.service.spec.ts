import { RiskValidationService, ValidationContext } from './risk-validation.service';

describe('RiskValidationService', () => {
  let service: RiskValidationService;

  const baseContext: ValidationContext = {
    symbol: 'BTCUSDT',
    spotPrice: 50_000,
    assetType: 'crypto',
    marketOpen: true,
    volatilityPct: 1,
    change24hPct: 2,
    cashBalance: 10_000,
    totalEquity: 10_000,
    startingBalance: 10_000,
    heldQuantity: 0.2,
    maxPositionSizePercent: 2,
    dailyLossLimitPercent: 3,
    dailyPnl: 0,
  };

  const validBuy = {
    action: 'BUY',
    ticker: 'BTCUSDT',
    confidence_score: 0.8,
    proposed_quantity: 0.001,
    proposed_stop_loss: 47_500,
    proposed_take_profit: 55_000,
    reasoning_summary: 'RSI oversold with bullish divergence',
    key_factors: ['RSI oversold', 'Volume spike'],
  };

  beforeAll(() => {
    service = new RiskValidationService();
  });

  const ctx = (overrides: Partial<ValidationContext> = {}): ValidationContext => ({
    ...baseContext,
    ...overrides,
  });

  describe('malformed payloads', () => {
    it('rejects null payload', () => {
      const result = service.validate(null, ctx());
      expect(result.passed).toBe(false);
      expect(result.errors).toEqual(['MALFORMED_DECISION']);
      expect(result.normalized).toBeNull();
    });

    it('rejects string payload', () => {
      const result = service.validate('BUY BTC', ctx());
      expect(result.errors).toEqual(['MALFORMED_DECISION']);
    });

    it('rejects array payload', () => {
      const result = service.validate([validBuy], ctx());
      expect(result.errors).toEqual(['MALFORMED_DECISION']);
    });

    it('rejects invalid action', () => {
      const result = service.validate({ ...validBuy, action: 'YOLO' }, ctx());
      expect(result.errors).toEqual(['MALFORMED_DECISION']);
    });

    it('rejects missing action', () => {
      const { action: _action, ...withoutAction } = validBuy;
      const result = service.validate(withoutAction, ctx());
      expect(result.errors).toEqual(['MALFORMED_DECISION']);
    });

    it('rejects non-numeric stop loss', () => {
      const result = service.validate({ ...validBuy, proposed_stop_loss: 'very low' }, ctx());
      expect(result.errors).toEqual(['MALFORMED_DECISION']);
    });
  });

  describe('ticker validation', () => {
    it('rejects hallucinated ticker', () => {
      const result = service.validate({ ...validBuy, ticker: 'FAKEUSDT' }, ctx());
      expect(result.errors).toContain('INVALID_SYMBOL');
    });

    it('rejects ticker that does not match the analyzed symbol', () => {
      const result = service.validate({ ...validBuy, ticker: 'ETHUSDT' }, ctx());
      expect(result.errors).toContain('INVALID_SYMBOL');
    });

    it('accepts ticker with different casing matching the symbol', () => {
      const result = service.validate({ ...validBuy, ticker: 'btcusdt' }, ctx());
      expect(result.passed).toBe(true);
    });
  });

  describe('confidence bounds', () => {
    it('rejects confidence below 0', () => {
      const result = service.validate({ ...validBuy, confidence_score: -0.01 }, ctx());
      expect(result.errors).toContain('CONFIDENCE_OUT_OF_RANGE');
    });

    it('rejects confidence above 1', () => {
      const result = service.validate({ ...validBuy, confidence_score: 1.01 }, ctx());
      expect(result.errors).toContain('CONFIDENCE_OUT_OF_RANGE');
    });

    it('accepts exact boundary values 0 and 1', () => {
      expect(service.validate({ ...validBuy, confidence_score: 0 }, ctx()).passed).toBe(true);
      expect(service.validate({ ...validBuy, confidence_score: 1 }, ctx()).passed).toBe(true);
    });
  });

  describe('position size boundary', () => {
    it('accepts cost exactly equal to max position size', () => {
      const quantity = 200 / 50_000;
      const result = service.validate({ ...validBuy, proposed_quantity: quantity }, ctx());
      expect(result.passed).toBe(true);
    });

    it('rejects cost just above max position size', () => {
      const quantity = 200 / 50_000 + 0.0000001;
      const result = service.validate({ ...validBuy, proposed_quantity: quantity }, ctx());
      expect(result.errors).toContain('POSITION_SIZE_EXCEEDED');
    });

    it('rejects buy larger than cash balance', () => {
      const result = service.validate(
        { ...validBuy, proposed_quantity: 0.001 },
        ctx({ totalEquity: 1_000_000, cashBalance: 40 }),
      );
      expect(result.errors).toContain('INSUFFICIENT_BALANCE');
    });
  });

  describe('stop loss distance', () => {
    it('accepts stop loss at exactly 10 percent below spot', () => {
      const result = service.validate({ ...validBuy, proposed_stop_loss: 45_000 }, ctx());
      expect(result.passed).toBe(true);
    });

    it('rejects stop loss just beyond 10 percent below spot in calm market', () => {
      const result = service.validate({ ...validBuy, proposed_stop_loss: 44_999 }, ctx());
      expect(result.errors).toContain('STOP_LOSS_TOO_FAR');
    });

    it('accepts stop loss up to 20 percent when volatility is unusual', () => {
      const volatile = ctx({ change24hPct: 9 });
      expect(service.validate({ ...validBuy, proposed_stop_loss: 40_000 }, volatile).passed).toBe(true);
      expect(
        service.validate({ ...validBuy, proposed_stop_loss: 44_999 }, volatile).passed,
      ).toBe(true);
    });

    it('rejects stop loss beyond 20 percent even in unusual volatility', () => {
      const volatile = ctx({ change24hPct: 9 });
      const result = service.validate({ ...validBuy, proposed_stop_loss: 39_999 }, volatile);
      expect(result.errors).toContain('STOP_LOSS_TOO_FAR');
    });

    it('rejects stop loss above spot price', () => {
      const result = service.validate({ ...validBuy, proposed_stop_loss: 50_001 }, ctx());
      expect(result.errors).toContain('INVALID_STOP_LOSS');
    });

    it('rejects take profit at or below spot price', () => {
      const result = service.validate({ ...validBuy, proposed_take_profit: 50_000 }, ctx());
      expect(result.errors).toContain('INVALID_TAKE_PROFIT');
    });
  });

  describe('sell validation', () => {
    it('accepts sell of exactly the held quantity', () => {
      const decision = {
        action: 'SELL',
        ticker: 'BTCUSDT',
        confidence_score: 0.7,
        proposed_quantity: 0.2,
        proposed_stop_loss: null,
        proposed_take_profit: null,
        reasoning_summary: 'Taking profit',
        key_factors: ['Target reached'],
      };
      const result = service.validate(decision, ctx());
      expect(result.passed).toBe(true);
    });

    it('rejects sell of more than held quantity', () => {
      const decision = {
        action: 'SELL',
        ticker: 'BTCUSDT',
        confidence_score: 0.7,
        proposed_quantity: 0.201,
        proposed_stop_loss: null,
        proposed_take_profit: null,
        reasoning_summary: 'Overexposed',
        key_factors: [],
      };
      const result = service.validate(decision, ctx());
      expect(result.errors).toContain('INSUFFICIENT_POSITION');
    });

    it('drops stop loss and take profit on sell', () => {
      const decision = {
        action: 'SELL',
        ticker: 'BTCUSDT',
        confidence_score: 0.7,
        proposed_quantity: 0.1,
        proposed_stop_loss: 1,
        proposed_take_profit: 999_999,
        reasoning_summary: 'Partial exit',
        key_factors: [],
      };
      const result = service.validate(decision, ctx());
      expect(result.passed).toBe(true);
      expect(result.normalized?.proposedStopLoss).toBeNull();
      expect(result.normalized?.proposedTakeProfit).toBeNull();
    });
  });

  describe('hold validation', () => {
    it('accepts hold and nullifies execution fields', () => {
      const decision = {
        action: 'HOLD',
        ticker: 'BTCUSDT',
        confidence_score: 0.4,
        proposed_quantity: 5,
        proposed_stop_loss: 1,
        proposed_take_profit: 1,
        reasoning_summary: 'No clear signal',
        key_factors: ['Mixed indicators'],
      };
      const result = service.validate(decision, ctx());
      expect(result.passed).toBe(true);
      expect(result.normalized?.proposedQuantity).toBeNull();
      expect(result.normalized?.proposedStopLoss).toBeNull();
    });
  });

  describe('market and circuit breaker states', () => {
    it('rejects when market is closed', () => {
      const result = service.validate(validBuy, ctx({ marketOpen: false }));
      expect(result.errors).toContain('MARKET_CLOSED');
    });

    it('rejects when daily loss limit is exactly reached', () => {
      const result = service.validate(validBuy, ctx({ dailyPnl: -300 }));
      expect(result.errors).toContain('DAILY_LOSS_LIMIT_REACHED');
    });

    it('accepts when daily loss is just above the limit threshold', () => {
      const result = service.validate(validBuy, ctx({ dailyPnl: -299.99 }));
      expect(result.passed).toBe(true);
    });
  });

  describe('invalid quantities', () => {
    it('rejects zero quantity', () => {
      const result = service.validate({ ...validBuy, proposed_quantity: 0 }, ctx());
      expect(result.errors).toContain('INVALID_QUANTITY');
    });

    it('rejects negative quantity', () => {
      const result = service.validate({ ...validBuy, proposed_quantity: -0.001 }, ctx());
      expect(result.errors).toContain('INVALID_QUANTITY');
    });

    it('rejects string quantity', () => {
      const result = service.validate({ ...validBuy, proposed_quantity: 'all in' }, ctx());
      expect(result.errors).toContain('INVALID_QUANTITY');
    });
  });

  describe('normalization tolerance', () => {
    it('defaults reasoning summary to empty string and key factors to empty array', () => {
      const decision = {
        action: 'BUY',
        ticker: 'BTCUSDT',
        confidence_score: 0.9,
        proposed_quantity: 0.001,
        proposed_stop_loss: null,
        proposed_take_profit: null,
      };
      const result = service.validate(decision, ctx());
      expect(result.passed).toBe(true);
      expect(result.normalized?.reasoningSummary).toBe('');
      expect(result.normalized?.keyFactors).toEqual([]);
    });

    it('clamps confidence into range when building normalized output', () => {
      const result = service.validate({ ...validBuy, confidence_score: 7 }, ctx());
      expect(result.errors).toContain('CONFIDENCE_OUT_OF_RANGE');
      expect(result.normalized?.confidenceScore).toBe(1);
    });
  });
});
