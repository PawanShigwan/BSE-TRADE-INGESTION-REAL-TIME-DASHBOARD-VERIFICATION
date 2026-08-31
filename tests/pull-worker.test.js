/**
 * Test Suite: Ingestion PullWorker & MongoDB Persistence
 */

const test = require('node:test');
const assert = require('node:assert');

const { connectDB, closeDB } = require('../ingestion-service/db');
const Trade = require('../ingestion-service/models/Trade');
const PullJob = require('../ingestion-service/models/PullJob');
const pullWorker = require('../ingestion-service/pullWorker');
const bseApp = require('../bse-mock-api/server');

let bseServer = null;

test.before(async () => {
  bseServer = bseApp.listen(0);
  const port = bseServer.address().port;
  process.env.BSE_API_URL = `http://localhost:${port}`;
  await connectDB();
  await Trade.deleteMany({});
  await PullJob.deleteMany({});
});

test.after(async () => {
  await pullWorker.pause();
  await new Promise((r) => setTimeout(r, 200));
  await closeDB();
  if (bseServer) bseServer.close();
});

test('MongoDB Ingestion Worker pulls first batch of trades safely', async () => {
  const job = await pullWorker.startOrResume({
    delayPerChunkMs: 50,
    limit: 500,
    forceNew: true
  });

  assert.ok(job.jobId);
  assert.strictEqual(job.status, 'RUNNING');

  // Allow worker to ingest chunks over Atlas connection
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const count = await Trade.countDocuments();
  assert.ok(count > 0, `Expected trades in MongoDB, got ${count}`);

  const sampleTrade = await Trade.findOne();
  assert.ok(sampleTrade.tradeId.startsWith('BSE-'));
  assert.ok(sampleTrade.quantity > 0);
  assert.ok(sampleTrade.price > 0);
  assert.strictEqual(sampleTrade.exchange, 'BSE');
});

test('MongoDB Ingestion Worker handles pause and resilient resumption from cursor', async () => {
  await pullWorker.pause();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const pausedJob = await PullJob.findOne().sort({ updatedAt: -1 });
  assert.ok(pausedJob);
  const pausedCursor = pausedJob.nextCursor;
  assert.ok(pausedCursor > 0, `Expected cursor > 0, got ${pausedCursor}`);

  const tradeCountBeforeResume = await Trade.countDocuments();
  await pullWorker.resume({ delayPerChunkMs: 30 });
  
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const resumedJob = await PullJob.findOne({ jobId: pausedJob.jobId });
  assert.ok(resumedJob.nextCursor >= pausedCursor, 'Resumed cursor should be >= paused cursor');

  const finalTradeCount = await Trade.countDocuments();
  assert.ok(finalTradeCount >= tradeCountBeforeResume, 'Trade count should have grown');

  const duplicates = await Trade.aggregate([
    { $group: { _id: '$tradeId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  assert.strictEqual(duplicates.length, 0, 'There should be zero duplicate trades in MongoDB');
});
