import { describe, it, expect, vi, afterEach } from 'vitest';
import { cryptoRandomInt } from './stats.component';

/** Feed `crypto.getRandomValues` a fixed sequence of u32 draws. */
function draws(...values: number[]) {
  const queue = [...values];
  return vi.spyOn(crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint32Array)[0] = queue.shift() as number;
      return array;
    });
}

describe('cryptoRandomInt — unbiased CSPRNG integer (CodeQL js/biased-cryptographic-random)', () => {
  afterEach(() => vi.restoreAllMocks());

  // n = 41: the largest multiple of 41 not above 2^32 (2^32 % 41 = 37).
  const LIMIT = 2 ** 32 - (2 ** 32 % 41);

  it('maps accepted draws onto exactly [min, max]', () => {
    draws(0);
    expect(cryptoRandomInt(20, 60)).toBe(20);
    draws(40);
    expect(cryptoRandomInt(20, 60)).toBe(60);
    draws(41);
    expect(cryptoRandomInt(20, 60)).toBe(20);
    draws(LIMIT - 1); // the largest accepted draw: a multiple of 41, minus one → 40
    expect(cryptoRandomInt(20, 60)).toBe(60);
  });

  // The bias lives in the top partial block; those draws must be redrawn,
  // never folded onto the low values by the modulo.
  it('rejects draws in the partial top block and redraws', () => {
    const spy = draws(LIMIT, 2 ** 32 - 1, 5);
    expect(cryptoRandomInt(20, 60)).toBe(25);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('stays in range on real CSPRNG draws', () => {
    for (let i = 0; i < 500; i++) {
      const value = cryptoRandomInt(20, 60);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(20);
      expect(value).toBeLessThanOrEqual(60);
    }
  });
});
