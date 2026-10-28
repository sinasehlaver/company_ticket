import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchema, formatSchema, tiers, PriceError, hallRows, rowPricesFromBody, readPrices, MAX_PRICE } from './pricing.js';

const SEATS = { all: [{ a: ['1', '2', '-1', '3'] }, { '-': [] }, { b: ['1', '2'] }, { c: ['1'] }] };

// --- PricingTests (ticketsystem/tests.py) 1:1 ---
test('roundtrip', () => {
  assert.deepEqual(parseSchema('a-c:75, d:60'), { a: 75, b: 75, c: 75, d: 60 });
  assert.equal(formatSchema(parseSchema('a-c:75,d:60,e-f:60')), 'a-c:75,d-f:60');
});

test('rejects junk', () => {
  for (const bad of ['a-c', 'c-a:5', 'a:99999', 'a;b:5', '1-2:5']) assert.throws(() => parseSchema(bad), PriceError, bad);
});

test('tiers highest first', () => {
  const t = tiers({ a: 75, b: 60, c: 60 });
  assert.equal(t.get(75)[0], 1);
  assert.equal(t.get(60)[0], 2);
  assert.equal(tiers({ a: 5 }).get(5)[0], 1); // single tier used to divide by zero
});

// --- edge cases ---
test('parse: messages match Django', () => {
  assert.throws(() => parseSchema('a-c'), { message: 'Anlaşılmayan parça: "a-c" (beklenen: a-f:75)' });
  assert.throws(() => parseSchema('c-a:5'), { message: 'Aralık ters: "c-a:5"' });
  assert.throws(() => parseSchema('a:99999'), { message: 'Fiyat çok büyük: 99999' });
  assert.throws(() => parseSchema('a:123456'), /Anlaşılmayan parça/); // >5 digits fails the regex
});

test('parse: empty, blanks, case, overlaps (later wins)', () => {
  assert.deepEqual(parseSchema(''), {});
  assert.deepEqual(parseSchema(null), {});
  assert.deepEqual(parseSchema(' , ,'), {});
  assert.deepEqual(parseSchema('A-B:5'), { a: 5, b: 5 });
  assert.deepEqual(parseSchema('a-c:5,b:9'), { a: 5, b: 9, c: 5 });
  assert.deepEqual(parseSchema(`a:${MAX_PRICE}`), { a: MAX_PRICE });
  assert.throws(() => parseSchema(`a:${MAX_PRICE + 1}`), PriceError);
  assert.deepEqual(parseSchema('a:0'), { a: 0 });
});

test('format: sorted, non-adjacent equal prices stay apart, empty', () => {
  assert.equal(formatSchema({ c: 5, a: 5 }), 'a:5,c:5');
  assert.equal(formatSchema({ b: 1, a: 1, c: 2 }), 'a-b:1,c:2');
  assert.equal(formatSchema({}), '');
});

test('tiers: hue spread 150..360 with Python half-even rounding', () => {
  const t3 = tiers({ a: 3, b: 2, c: 1 });
  assert.deepEqual([...t3.entries()], [[3, [1, 360]], [2, [2, 255]], [1, [3, 150]]]);
  assert.deepEqual(tiers({ a: 5 }).get(5), [1, 200]);
  // n=5: 210*k/4 -> 52.5 rounds to 52 and 157.5 to 158 in Python
  const t5 = tiers({ a: 5, b: 4, c: 3, d: 2, e: 1 });
  assert.deepEqual([...t5.values()].map((v) => v[1]), [360, 308, 255, 202, 150]);
});

test('hallRows skips aisles; count hall has none', () => {
  assert.deepEqual(hallRows({ seats: SEATS }), ['a', 'b', 'c']);
  assert.deepEqual(hallRows({ seats: JSON.stringify(SEATS) }), ['a', 'b', 'c']);
  assert.deepEqual(hallRows({ seats: { count: 4 } }), []);
});

test('rowPricesFromBody: every row required, 0..MAX, digits only', () => {
  const rows = ['a', 'b'];
  assert.deepEqual(rowPricesFromBody({ a: 90, b: '60' }, rows), { a: 90, b: 60 });
  assert.deepEqual(rowPricesFromBody({ a: ' 0 ', b: 1 }, rows), { a: 0, b: 1 });
  for (const bad of [{ a: 1 }, { a: 1, b: -5 }, { a: 1, b: 1.5 }, { a: 1, b: 'x' }, { a: 1, b: MAX_PRICE + 1 }, { a: 1, b: true }, { a: 1, b: null }, { a: 1, b: '' }]) {
    assert.throws(() => rowPricesFromBody(bad, rows), /sırası için geçerli bir fiyat girin/, JSON.stringify(bad));
  }
  assert.throws(() => rowPricesFromBody({ a: 1 }, rows), { message: '"B" sırası için geçerli bir fiyat girin' });
  assert.throws(() => rowPricesFromBody(null, rows), PriceError);
  assert.throws(() => rowPricesFromBody(Object.create({ a: 1, b: 1 }), rows), PriceError); // inherited keys ignored
});

test('readPrices: count hall single price, seated schema', () => {
  assert.deepEqual(readPrices({ seats: { count: 4 } }, { price: '55' }), { prices: {}, schema: '55' });
  assert.deepEqual(readPrices({ seats: { count: 4 } }, { price: 0 }), { prices: {}, schema: '0' });
  assert.deepEqual(readPrices({ seats: { count: 4 } }, { price: '055' }), { prices: {}, schema: '55' });
  assert.deepEqual(readPrices({ seats: { count: 4 } }, { price: ' 000 ' }), { prices: {}, schema: '0' });
  for (const bad of [{}, { price: -1 }, { price: 'x' }, { price: MAX_PRICE + 1 }]) {
    assert.throws(() => readPrices({ seats: { count: 4 } }, bad), { message: 'Geçerli bir fiyat girin' });
  }
  assert.deepEqual(readPrices({ seats: SEATS }, { prices: { a: 10, b: 10, c: 5 } }).schema, 'a-b:10,c:5');
});
