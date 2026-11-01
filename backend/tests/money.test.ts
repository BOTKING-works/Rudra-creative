import { describe, expect, it } from 'vitest';
import { calculateTaxPaise, lineTotalPaise, subtotalPaise } from '../src/utils/money.js';

describe('money helpers', () => {
  it('calculates integer minor-unit line and subtotal totals', () => {
    expect(lineTotalPaise({ unitPricePaise: 19900, quantity: 3 })).toBe(59700);
    expect(subtotalPaise([{ unitPricePaise: 19900, quantity: 3 }, { unitPricePaise: 125, quantity: 2 }])).toBe(59950);
  });
  it('rejects floats, negative amounts, invalid quantities, and overflow', () => {
    expect(() => lineTotalPaise({ unitPricePaise: 1.5, quantity: 1 })).toThrow();
    expect(() => lineTotalPaise({ unitPricePaise: -1, quantity: 1 })).toThrow();
    expect(() => lineTotalPaise({ unitPricePaise: 10, quantity: 0 })).toThrow();
    expect(() => lineTotalPaise({ unitPricePaise: Number.MAX_SAFE_INTEGER, quantity: 2 })).toThrow();
  });
  it('applies configurable tax rates in basis points with explicit inclusive mode', () => {
    expect(calculateTaxPaise(10000, 1800, false)).toEqual({ taxPaise: 1800, totalPaise: 11800 });
    expect(calculateTaxPaise(11800, 1800, true)).toEqual({ taxPaise: 1800, totalPaise: 11800 });
    expect(() => calculateTaxPaise(10000, 20001, false)).toThrow();
  });
});
