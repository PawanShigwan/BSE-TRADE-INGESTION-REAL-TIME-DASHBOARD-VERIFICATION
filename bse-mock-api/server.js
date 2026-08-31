/**
 * Mock BSE Exchange API Server
 * 
 * Simulates the Bombay Stock Exchange (BSE) Trade API.
 * In a real-world scenario, pulling the full trade dataset takes up to 15 minutes.
 * Since network infrastructure terminates HTTP connections open > 30 seconds,
 * this API serves trade data in paginated chunks (cursor-based), allowing callers
 * to safely ingest the full dataset across multiple discrete sub-30s HTTP requests.
 */

const express = require('express');
const cors = require('cors');
const { getOrSeedTrades } = require('./seedData');

const app = express();
const PORT = process.env.BSE_PORT || 3001;

app.use(cors());
app.use(express.json());

// Seed initial dataset (5,000 trades)
const TOTAL_DEFAULT_TRADES = 5000;
let allTrades = getOrSeedTrades(TOTAL_DEFAULT_TRADES);

// Configurable global simulation settings
let globalConfig = {
  defaultDelayPerChunkMs: 1500, // 1.5 seconds per chunk
  maxAllowedChunkDelayMs: 25000 // Guarantee always strictly under 30s
};

/**
 * GET /getTrades
 * 
 * Query Parameters:
 * - cursor: Start index (default: 0)
 * - limit: Number of trades per chunk (default: 500)
 * - delayPerChunk: Simulated delay for this chunk in ms (default: 1500ms)
 * - totalRecords: Optional total dataset size override (default: 5000)
 */
app.get('/getTrades', async (req, res) => {
  const startTime = Date.now();
  
  const cursor = parseInt(req.query.cursor, 10) || 0;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
  
  // Enforce simulated chunk delay safely under 30 seconds
  let delay = parseInt(req.query.delayPerChunk, 10);
  if (isNaN(delay)) {
    delay = globalConfig.defaultDelayPerChunkMs;
  }
  // Safety clamp: keep chunk delay under 25s so HTTP connection never exceeds 30s
  delay = Math.min(Math.max(delay, 0), globalConfig.maxAllowedChunkDelayMs);

  const total = allTrades.length;
  
  // Calculate slice
  const startIndex = Math.min(cursor, total);
  const endIndex = Math.min(startIndex + limit, total);
  const chunkTrades = allTrades.slice(startIndex, endIndex);
  
  const hasMore = endIndex < total;
  const nextCursor = hasMore ? endIndex : null;
  const totalChunks = Math.ceil(total / limit);
  const chunkIndex = Math.floor(startIndex / limit) + 1;

  // Simulate network / exchange extraction delay for this chunk
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const executionTimeMs = Date.now() - startTime;

  return res.status(200).json({
    status: 'SUCCESS',
    timestamp: new Date().toISOString(),
    data: {
      trades: chunkTrades,
      cursor: startIndex,
      nextCursor,
      hasMore,
      limit,
      totalRecords: total,
      chunkIndex,
      totalChunks,
      chunkExecutionTimeMs: executionTimeMs,
      warningTimeoutLimitSec: 30
    }
  });
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'Mock BSE Exchange API',
    totalSeededTrades: allTrades.length,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /config
 * Update mock simulation parameters
 */
app.post('/config', (req, res) => {
  const { defaultDelayPerChunkMs } = req.body;
  if (typeof defaultDelayPerChunkMs === 'number') {
    globalConfig.defaultDelayPerChunkMs = Math.min(Math.max(defaultDelayPerChunkMs, 0), 25000);
  }
  res.json({ status: 'SUCCESS', config: globalConfig });
});

/**
 * POST /reset
 * Re-seed trade records
 */
app.post('/reset', (req, res) => {
  const count = parseInt(req.body.count, 10) || TOTAL_DEFAULT_TRADES;
  allTrades = getOrSeedTrades(count);
  res.json({
    status: 'SUCCESS',
    message: `Reseeded ${allTrades.length} BSE trade records`,
    totalTrades: allTrades.length
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[BSE Mock API] Running on http://localhost:${PORT}`);
    console.log(`[BSE Mock API] Seeded ${allTrades.length} trades. Ready for chunked pulls.`);
  });
}

module.exports = app;
