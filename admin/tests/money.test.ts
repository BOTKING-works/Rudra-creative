import { describe, expect, it } from 'vitest';
import { formatINR } from '../src/api';
describe('admin monetary display', () => { it('formats INR values from integer paise', () => { expect(formatINR(9900)).toContain('99'); }); });
