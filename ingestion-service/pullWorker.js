/**
 * BSE Trade Ingestion Pull Worker
 * 
 * Orchestrates chunked ingestion from the BSE Mock API into MongoDB.
 * Key Architectural Guarantees:
 * 1. Sub-30s Connections: Pulls in discrete, paginated batches so no single HTTP
 *    request exceeds the 30-second network termination limit.
 * 2. Resilient Resumption: Persists cursor state in MongoDB (`pullJobs`).
 *    If the worker is paused, interrupted, or restarted, it resumes from `nextCursor`
 *    without re-pulling earlier chunks.
 * 3. Idempotent Upsert: Trades are upserted by `tradeId` into MongoDB.
 * 4. Real-time WebSocket Push: Emits events on chunk arrival and pull completion.
 */

const Trade = require('./models/Trade');
const PullJob = require('./models/PullJob');
const wsManager = require('./wsServer');
const config = require('./config');

class PullWorker {
  constructor() {
    this.activeJobId = null;
    this.isPaused = false;
    this.isWorkerRunning = false;
  }

  /**
   * Starts a new pull job or resumes an existing incomplete job from MongoDB.
   * @param {Object} options Options like delayPerChunkMs, limit, forceNew
   */
  async startOrResume(options = {}) {
    if (this.isWorkerRunning) {
      throw new Error('A pull job is already running');
    }

    const {
      delayPerChunkMs = config.DEFAULT_DELAY_PER_CHUNK_MS,
      limit = config.CHUNK_LIMIT,
      forceNew = false
    } = options;

    let job = null;

    if (!forceNew) {
      // Look for any paused or interrupted job in MongoDB
      job = await PullJob.findOne({
        status: { $in: ['RUNNING', 'PAUSED'] }
      }).sort({ updatedAt: -1 });
    }

    if (job) {
      console.log(`[PullWorker] Resuming existing job ${job.jobId} from cursor ${job.nextCursor}`);
      job.status = 'RUNNING';
      job.delayPerChunkMs = delayPerChunkMs;
      job.updatedAt = new Date();
      await job.save();
    } else {
      // Create new job
      const jobId = `job_${Date.now()}`;
      console.log(`[PullWorker] Creating new pull job ${jobId}`);
      job = await PullJob.create({
        jobId,
        status: 'RUNNING',
        nextCursor: 0,
        recordsPulled: 0,
        totalRecords: 0,
        currentChunk: 0,
        totalChunks: 0,
        delayPerChunkMs,
        startedAt: new Date(),
        updatedAt: new Date()
      });
    }

    this.activeJobId = job.jobId;
    this.isPaused = false;
    this.isWorkerRunning = true;

    wsManager.broadcast('PULL_STARTED', {
      jobId: job.jobId,
      resumingFromCursor: job.nextCursor,
      recordsPulledSoFar: job.recordsPulled,
      delayPerChunkMs: job.delayPerChunkMs
    });

    // Run asynchronous processing loop
    this.runIngestionLoop(job.jobId, limit).catch(async (err) => {
      console.error(`[PullWorker] Fatal error during ingestion loop: ${err.message}`);
      await PullJob.findOneAndUpdate(
        { jobId: job.jobId },
        { status: 'FAILED', error: err.message, updatedAt: new Date() }
      );
      wsManager.broadcast('JOB_STATUS_CHANGED', {
        jobId: job.jobId,
        status: 'FAILED',
        error: err.message
      });
      this.isWorkerRunning = false;
    });

    return job;
  }

  /**
   * Main asynchronous chunk ingestion loop.
   */
  async runIngestionLoop(jobId, limit) {
    console.log(`[PullWorker] Starting ingestion loop for jobId: ${jobId}`);

    while (this.isWorkerRunning) {
      // Fetch latest job state from MongoDB
      const job = await PullJob.findOne({ jobId });
      if (!job) {
        console.error(`[PullWorker] Job ${jobId} not found in MongoDB`);
        this.isWorkerRunning = false;
        break;
      }

      if (this.isPaused || job.status === 'PAUSED') {
        console.log(`[PullWorker] Ingestion paused at cursor ${job.nextCursor}`);
        await PullJob.findOneAndUpdate({ jobId }, { status: 'PAUSED', updatedAt: new Date() });
        wsManager.broadcast('JOB_STATUS_CHANGED', {
          jobId,
          status: 'PAUSED',
          nextCursor: job.nextCursor,
          recordsPulled: job.recordsPulled
        });
        this.isWorkerRunning = false;
        break;
      }

      const cursor = job.nextCursor;
      const delay = job.delayPerChunkMs;

      // Construct Mock BSE API URL for chunk
      const url = `${config.BSE_API_URL}/getTrades?cursor=${cursor}&limit=${limit}&delayPerChunk=${delay}`;
      console.log(`[PullWorker] Fetching chunk: cursor=${cursor}, limit=${limit}, delay=${delay}ms`);

      const startTime = Date.now();
      let responseData = null;

      try {
        // Enforce strict abort timeout (28s) to ensure connection never exceeds 30s
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.CHUNK_TIMEOUT_MS);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`BSE API returned HTTP ${res.status}: ${res.statusText}`);
        }

        const json = await res.json();
        responseData = json.data;
      } catch (fetchErr) {
        console.error(`[PullWorker] Chunk fetch error at cursor ${cursor}: ${fetchErr.message}`);
        await PullJob.findOneAndUpdate(
          { jobId },
          { status: 'FAILED', error: fetchErr.message, updatedAt: new Date() }
        );
        wsManager.broadcast('JOB_STATUS_CHANGED', {
          jobId,
          status: 'FAILED',
          error: fetchErr.message,
          lastSuccessfulCursor: cursor
        });
        this.isWorkerRunning = false;
        break;
      }

      const fetchDurationMs = Date.now() - startTime;
      const { trades, nextCursor, hasMore, totalRecords, chunkIndex, totalChunks } = responseData;

      console.log(`[PullWorker] Received ${trades.length} trades in ${fetchDurationMs}ms (Chunk ${chunkIndex}/${totalChunks})`);

      // Idempotent bulk upsert into MongoDB trades collection
      if (trades && trades.length > 0) {
        const bulkOps = trades.map((t) => ({
          updateOne: {
            filter: { tradeId: t.tradeId },
            update: {
              $set: {
                tradeId: t.tradeId,
                client: t.client,
                symbol: t.symbol,
                quantity: t.quantity,
                price: t.price,
                orderType: t.orderType,
                exchange: t.exchange || 'BSE',
                timestamp: new Date(t.timestamp),
                jobId,
                chunkIndex,
                pulledAt: new Date()
              }
            },
            upsert: true
          }
        }));

        await Trade.bulkWrite(bulkOps, { ordered: false });
      }

      // Update PullJob state in MongoDB
      const totalPulled = (job.recordsPulled || 0) + trades.length;
      job.recordsPulled = totalPulled;
      job.totalRecords = totalRecords;
      job.currentChunk = chunkIndex;
      job.totalChunks = totalChunks;
      job.nextCursor = nextCursor !== null ? nextCursor : totalPulled;
      job.updatedAt = new Date();

      if (!hasMore || nextCursor === null) {
        // Complete pull
        job.status = 'COMPLETED';
        job.completedAt = new Date();
        await job.save();

        console.log(`[PullWorker] Pull job ${jobId} COMPLETED! Total records ingested: ${totalPulled}`);

        // Broadcast completion event to live dashboard
        wsManager.broadcast('PULL_COMPLETED', {
          jobId,
          totalRecordsPulled: totalPulled,
          totalChunks,
          completedAt: job.completedAt,
          summary: {
            totalIngested: totalPulled,
            lastChunkSize: trades.length
          }
        });

        this.isWorkerRunning = false;
        break;
      } else {
        await job.save();

        // Broadcast chunk arrival to live dashboard for progressive updates
        wsManager.broadcast('CHUNK_INGESTED', {
          jobId,
          chunkIndex,
          totalChunks,
          chunkSize: trades.length,
          recordsPulled: totalPulled,
          totalRecords,
          progressPercent: Math.min(100, Math.round((totalPulled / totalRecords) * 100)),
          fetchDurationMs,
          recentTrades: trades.slice(0, 10), // Send sample for instant animation
          nextCursor
        });
      }
    }
  }

  /**
   * Pauses the active pull job gracefully.
   */
  async pause() {
    if (!this.isWorkerRunning) {
      return { message: 'Worker is not currently running' };
    }
    this.isPaused = true;
    let attempts = 0;
    while (this.isWorkerRunning && attempts < 50) {
      await new Promise((r) => setTimeout(r, 50));
      attempts++;
    }
    return { message: 'Worker paused successfully' };
  }

  /**
   * Resumes a paused pull job.
   */
  async resume(options = {}) {
    if (this.isWorkerRunning) {
      throw new Error('Worker is already running');
    }
    this.isPaused = false;
    return this.startOrResume({ forceNew: false, ...options });
  }

  /**
   * Resets all trades and jobs in MongoDB.
   */
  async reset() {
    this.isPaused = true;
    this.isWorkerRunning = false;
    
    await Trade.deleteMany({});
    await PullJob.deleteMany({});

    wsManager.broadcast('SYSTEM_RESET', {
      message: 'Trades database and pull jobs have been reset'
    });

    console.log('[PullWorker] Reset all trades and jobs.');
    return { status: 'SUCCESS', message: 'All trades and pull job states have been reset.' };
  }

  /**
   * Retrieves the current pull job status.
   */
  async getStatus() {
    const latestJob = await PullJob.findOne().sort({ updatedAt: -1 });
    const totalTradesInDb = await Trade.countDocuments();

    return {
      isWorkerRunning: this.isWorkerRunning,
      isPaused: this.isPaused,
      activeJob: latestJob,
      totalTradesInDb
    };
  }
}

module.exports = new PullWorker();
