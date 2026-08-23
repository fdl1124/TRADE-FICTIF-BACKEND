export type KeyFailureReason = 'auth' | 'quota' | 'unknown';

const COOLDOWN_MS: Record<KeyFailureReason, number> = {
  auth: 3_600_000,
  quota: 60_000,
  unknown: 10_000,
};

export class GeminiKeyRing {
  private readonly keys: string[];
  private currentIndex = 0;
  private readonly cooldownUntil = new Map<number, number>();

  constructor(keys: string[]) {
    this.keys = keys.map((key) => key.trim()).filter((key) => key.length > 0);
  }

  get size(): number {
    return this.keys.length;
  }

  currentKey(): string | null {
    return this.keys.length > 0 ? this.keys[this.currentIndex] : null;
  }

  currentIndexValue(): number {
    return this.currentIndex;
  }

  isKeyAvailable(index: number): boolean {
    const until = this.cooldownUntil.get(index);
    return until === undefined || Date.now() >= until;
  }

  markFailed(index: number, reason: KeyFailureReason): void {
    this.cooldownUntil.set(index, Date.now() + COOLDOWN_MS[reason]);
  }

  rotateToNextAvailable(): boolean {
    if (this.keys.length <= 1) {
      return false;
    }
    for (let step = 1; step <= this.keys.length; step++) {
      const candidate = (this.currentIndex + step) % this.keys.length;
      if (this.isKeyAvailable(candidate)) {
        this.currentIndex = candidate;
        return true;
      }
    }
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return true;
  }
}
