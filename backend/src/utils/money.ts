export type LineItem = { unitPricePaise: number; quantity: number };

export function lineTotalPaise(item: LineItem): number {
  if (!Number.isSafeInteger(item.unitPricePaise) || item.unitPricePaise < 0) throw new Error('Unit price must be a non-negative safe integer in paise.');
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) throw new Error('Quantity must be a positive bounded integer.');
  const total = item.unitPricePaise * item.quantity;
  if (!Number.isSafeInteger(total)) throw new Error('Line total exceeds safe integer precision.');
  return total;
}

export function subtotalPaise(items: LineItem[]): number {
  const sum = items.reduce((acc, item) => acc + lineTotalPaise(item), 0);
  if (!Number.isSafeInteger(sum)) throw new Error('Subtotal exceeds safe integer precision.');
  return sum;
}

export function calculateTaxPaise(taxableAmountPaise: number, rateBasisPoints: number, inclusive: boolean): { taxPaise: number; totalPaise: number } {
  if (!Number.isSafeInteger(taxableAmountPaise) || taxableAmountPaise < 0) throw new Error('Taxable amount must be non-negative paise.');
  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10000) throw new Error('Rate must be between 0 and 10000 basis points.');
  const product = taxableAmountPaise * rateBasisPoints;
  if (!Number.isSafeInteger(product)) throw new Error('Tax calculation exceeds safe integer precision.');
  if (inclusive) {
    const totalPaise = taxableAmountPaise;
    const taxPaise = Math.round((taxableAmountPaise * rateBasisPoints) / (10000 + rateBasisPoints));
    return { taxPaise, totalPaise };
  }
  const taxPaise = Math.round((taxableAmountPaise * rateBasisPoints) / 10000);
  const totalPaise = taxableAmountPaise + taxPaise;
  if (!Number.isSafeInteger(totalPaise)) throw new Error('Total exceeds safe integer precision.');
  return { taxPaise, totalPaise };
}
