/**
 * Test Suite: BSE Mock API & Seed Data Validation
 */

const test = require('node:test');
const assert = require('node:assert');
const { generateTrades } = require('../bse-mock-api/seedData');
const app = require('../bse-mock-api/server');

test('BSE Seed Data Generator generates valid trade records', () => {
  const trades = generateTrades(100);
  assert.strictEqual(trades.length, 100);

  const sample = trades[0];
  assert.ok(sample.tradeId.startsWith('BSE-'), 'Trade ID should have BSE prefix');
  assert.ok(typeof sample.client === 'string' && sample.client.length > 0);
  assert.ok(typeof sample.symbol === 'string' && sample.symbol.length > 0);
  assert.ok(sample.quantity > 0, 'Quantity should be positive');
  assert.ok(sample.price > 0, 'Price should be positive');
  assert.ok(['BUY', 'SELL'].includes(sample.orderType));
  assert.strictEqual(sample.exchange, 'BSE');
  assert.ok(!isNaN(Date.parse(sample.timestamp)), 'Timestamp should be valid ISO string');
});

test('BSE Mock API /getTrades returns chunked data with valid cursor & limit', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const startTime = Date.now();
    // Test with limit=100, delay=100ms
    const res = await fetch(`http://localhost:${port}/getTrades?cursor=0&limit=100&delayPerChunk=100`);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.status, 'SUCCESS');
    assert.strictEqual(json.data.trades.length, 100);
    assert.strictEqual(json.data.cursor, 0);
    assert.strictEqual(json.data.nextCursor, 100);
    assert.strictEqual(json.data.hasMore, true);
    assert.ok(json.data.totalRecords >= 5000);

    const duration = Date.now() - startTime;
    // Verify response time is well below the 30-second network kill threshold
    assert.ok(duration < 5000, `Expected duration < 5000ms, got ${duration}ms (comfortably under 30s)`);
  } finally {
    server.close();
  }
});

test('BSE Mock API handles last chunk pagination boundary gracefully', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/getTrades?cursor=4900&limit=200&delayPerChunk=50`);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.data.hasMore, false);
    assert.strictEqual(json.data.nextCursor, null);
    assert.ok(json.data.trades.length <= 100);
  } finally {
    server.close();
  }
});
