import { GeminiKeyRing } from './gemini-key-ring';

describe('GeminiKeyRing', () => {
  it('filters empty and whitespace-only keys', () => {
    const ring = new GeminiKeyRing([' key-a ', '', '   ', 'key-b']);
    expect(ring.size).toBe(2);
    expect(ring.currentKey()).toBe('key-a');
  });

  it('rotates to the next key and wraps around', () => {
    const ring = new GeminiKeyRing(['a', 'b', 'c']);
    expect(ring.rotateToNextAvailable()).toBe(true);
    expect(ring.currentKey()).toBe('b');
    expect(ring.rotateToNextAvailable()).toBe(true);
    expect(ring.currentKey()).toBe('c');
    expect(ring.rotateToNextAvailable()).toBe(true);
    expect(ring.currentKey()).toBe('a');
  });

  it('does not rotate when a single key is configured', () => {
    const ring = new GeminiKeyRing(['only']);
    expect(ring.rotateToNextAvailable()).toBe(false);
    expect(ring.currentKey()).toBe('only');
  });

  it('skips keys under cooldown when rotating', () => {
    const ring = new GeminiKeyRing(['a', 'b']);
    ring.markFailed(0, 'quota');
    expect(ring.isKeyAvailable(0)).toBe(false);
    expect(ring.rotateToNextAvailable()).toBe(true);
    expect(ring.currentKey()).toBe('b');
    expect(ring.rotateToNextAvailable()).toBe(true);
    expect(ring.currentKey()).toBe('b');
  });

  it('falls back to the next index even when every key is cooling down', () => {
    const ring = new GeminiKeyRing(['a', 'b']);
    ring.markFailed(0, 'auth');
    ring.markFailed(1, 'auth');
    expect(ring.rotateToNextAvailable()).toBe(true);
    expect(ring.currentKey()).toBe('b');
  });

  it('uses a key again once its cooldown has expired', () => {
    jest.useFakeTimers();
    try {
      const ring = new GeminiKeyRing(['a', 'b']);
      ring.markFailed(0, 'unknown');
      jest.setSystemTime(Date.now() + 10_001);
      expect(ring.isKeyAvailable(0)).toBe(true);
      ring.rotateToNextAvailable();
      expect(ring.currentKey()).toBe('b');
      ring.rotateToNextAvailable();
      expect(ring.currentKey()).toBe('a');
    } finally {
      jest.useRealTimers();
    }
  });

  it('applies distinct cooldown durations per failure reason', () => {
    jest.useFakeTimers();
    try {
      const ring = new GeminiKeyRing(['quota-key', 'auth-key', 'unknown-key']);
      ring.markFailed(0, 'quota');
      ring.markFailed(1, 'auth');
      ring.markFailed(2, 'unknown');

      jest.setSystemTime(Date.now() + 10_001);
      expect(ring.isKeyAvailable(0)).toBe(false);
      expect(ring.isKeyAvailable(1)).toBe(false);
      expect(ring.isKeyAvailable(2)).toBe(true);

      jest.setSystemTime(Date.now() + 60_000);
      expect(ring.isKeyAvailable(0)).toBe(true);
      expect(ring.isKeyAvailable(1)).toBe(false);

      jest.setSystemTime(Date.now() + 3_600_000);
      expect(ring.isKeyAvailable(1)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
