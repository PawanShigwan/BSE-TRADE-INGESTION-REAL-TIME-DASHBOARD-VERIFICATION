/**
 * Ingestion Service & Dashboard Web Server
 * 
 * Serves REST APIs for trade inspection, statistics, and pull orchestration,
 * hosts the WebSocket server for real-time zero-polling updates,
 * and serves the frontend Trades Dashboard.
 */

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const { connectDB } = require('./db');
const Trade = require('./models/Trade');
const PullJob = require('./models/PullJob');
const pullWorker = require('./pullWorker');
const wsManager = require('./wsServer');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Serve static frontend dashboard
app.use(express.static(path.join(__dirname, '../dashboard')));

/**
 * GET /api/trades
 * Retrieves stored trades from MongoDB with filtering, searching, and pagination.
 * Instant response even during ongoing background pulls.
 */
app.get('/api/trades', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const { symbol, client, orderType, search, sortBy = 'timestamp', sortOrder = 'desc' } = req.query;

    const query = {};

    if (symbol) {
      query.symbol = symbol.toUpperCase();
    }
    if (client) {
      query.client = new RegExp(client, 'i');
    }
    if (orderType) {
      query.orderType = orderType.toUpperCase();
    }
    if (search) {
      query.$or = [
        { tradeId: new RegExp(search, 'i') },
        { symbol: new RegExp(search, 'i') },
        { client: new RegExp(search, 'i') }
      ];
    }

    const sortOption = {};
    sortOption[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const totalRecords = await Trade.countDocuments(query);
    const totalPages = Math.ceil(totalRecords / limit) || 1;
    const trades = await Trade.find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      status: 'SUCCESS',
      data: {
        trades,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages
        }
      }
    });
  } catch (err) {
    console.error(`[API] Error fetching trades: ${err.message}`);
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

/**
 * GET /api/stats
 * Aggregate dashboard statistics calculated from MongoDB.
 */
app.get('/api/stats', async (req, res) => {
  try {
    const totalTrades = await Trade.countDocuments();

    if (totalTrades === 0) {
      return res.json({
        status: 'SUCCESS',
        data: {
          totalTrades: 0,
          totalVolumeInr: 0,
          buyVolumeInr: 0,
          sellVolumeInr: 0,
          uniqueSymbolsCount: 0,
          topSymbols: [],
          topClients: []
        }
      });
    }

    const [volumeAgg, symbolAgg, clientAgg] = await Promise.all([
      Trade.aggregate([
        {
          $group: {
            _id: '$orderType',
            totalVolume: { $sum: { $multiply: ['$quantity', '$price'] } },
            count: { $sum: 1 }
          }
        }
      ]),
      Trade.aggregate([
        {
          $group: {
            _id: '$symbol',
            totalVolume: { $sum: { $multiply: ['$quantity', '$price'] } },
            tradeCount: { $sum: 1 }
          }
        },
        { $sort: { totalVolume: -1 } },
        { $limit: 6 }
      ]),
      Trade.aggregate([
        {
          $group: {
            _id: '$client',
            totalTrades: { $sum: 1 },
            totalVolume: { $sum: { $multiply: ['$quantity', '$price'] } }
          }
        },
        { $sort: { totalTrades: -1 } },
        { $limit: 5 }
      ])
    ]);

    let buyVolumeInr = 0;
    let sellVolumeInr = 0;
    let totalVolumeInr = 0;

    for (const v of volumeAgg) {
      if (v._id === 'BUY') buyVolumeInr = v.totalVolume;
      if (v._id === 'SELL') sellVolumeInr = v.totalVolume;
      totalVolumeInr += v.totalVolume;
    }

    res.json({
      status: 'SUCCESS',
      data: {
        totalTrades,
        totalVolumeInr: Math.round(totalVolumeInr),
        buyVolumeInr: Math.round(buyVolumeInr),
        sellVolumeInr: Math.round(sellVolumeInr),
        topSymbols: symbolAgg.map((s) => ({
          symbol: s._id,
          volume: Math.round(s.totalVolume),
          count: s.tradeCount
        })),
        topClients: clientAgg.map((c) => ({
          client: c._id,
          tradeCount: c.totalTrades,
          volume: Math.round(c.totalVolume)
        }))
      }
    });
  } catch (err) {
    console.error(`[API] Error generating stats: ${err.message}`);
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

/**
 * GET /api/job-status
 * Retrieves status of active/latest pull job from MongoDB.
 */
app.get('/api/job-status', async (req, res) => {
  try {
    const status = await pullWorker.getStatus();
    res.json({ status: 'SUCCESS', data: status });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

/**
 * POST /api/pull/start
 * Starts or triggers a new ingestion job.
 */
app.post('/api/pull/start', async (req, res) => {
  try {
    const { delayPerChunkMs, forceNew } = req.body;
    const job = await pullWorker.startOrResume({
      delayPerChunkMs: typeof delayPerChunkMs === 'number' ? delayPerChunkMs : undefined,
      forceNew: Boolean(forceNew)
    });
    res.json({ status: 'SUCCESS', data: job });
  } catch (err) {
    res.status(400).json({ status: 'ERROR', message: err.message });
  }
});

/**
 * POST /api/pull/pause
 * Pauses currently running pull worker.
 */
app.post('/api/pull/pause', async (req, res) => {
  try {
    const result = await pullWorker.pause();
    res.json({ status: 'SUCCESS', data: result });
  } catch (err) {
    res.status(400).json({ status: 'ERROR', message: err.message });
  }
});

/**
 * POST /api/pull/resume
 * Resumes pull worker from last MongoDB cursor.
 */
app.post('/api/pull/resume', async (req, res) => {
  try {
    const { delayPerChunkMs } = req.body;
    const job = await pullWorker.resume({
      delayPerChunkMs: typeof delayPerChunkMs === 'number' ? delayPerChunkMs : undefined
    });
    res.json({ status: 'SUCCESS', data: job });
  } catch (err) {
    res.status(400).json({ status: 'ERROR', message: err.message });
  }
});

/**
 * POST /api/pull/reset
 * Resets MongoDB trades and jobs.
 */
app.post('/api/pull/reset', async (req, res) => {
  try {
    const result = await pullWorker.reset();
    res.json(result);
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

/**
 * Bootstraps DB connection, WebSocket manager, and starts HTTP server.
 */
async function startServer() {
  await connectDB();
  wsManager.init(server);

  server.listen(config.PORT, () => {
    console.log(`[Ingestion Server] Running on http://localhost:${config.PORT}`);
    console.log(`[Dashboard UI] Available at http://localhost:${config.PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { app, server, startServer };
