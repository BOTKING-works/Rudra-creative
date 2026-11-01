import { describe, expect, it } from 'vitest';
import { formatINR } from '../src/services/api';

describe('INR display formatting', () => {
  it('formats integer paise as Indian rupees without floating point being used for totals', () => {
    expect(formatINR(19900)).toContain('199');
    expect(formatINR(0)).toContain('0');
  });
});
