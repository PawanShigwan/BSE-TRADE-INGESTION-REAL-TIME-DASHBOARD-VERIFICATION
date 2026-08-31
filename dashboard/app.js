/**
 * ARHAM Fintech - BSE Live Trades Dashboard Client
 * 
 * Features:
 * - Instant cache render from MongoDB on load.
 * - Reactive WebSocket event processing for real-time updates.
 * - Strictly ZERO page reloads, ZERO polling loops, ZERO cronjobs.
 * - Live telemetry display of discrete sub-30s HTTP chunk calls.
 */

// Application State
const state = {
  trades: [],
  currentPage: 1,
  totalPages: 1,
  limit: 50,
  selectedSymbol: '',
  selectedOrderType: '',
  searchQuery: '',
  ws: null,
  activeJob: null,
  isWorkerRunning: false
};

// DOM Elements
const elements = {
  wsDot: document.getElementById('wsDot'),
  wsStatusText: document.getElementById('wsStatusText'),
  metricTotalTrades: document.getElementById('metricTotalTrades'),
  metricTotalVolume: document.getElementById('metricTotalVolume'),
  metricVolumeRatio: document.getElementById('metricVolumeRatio'),
  jobStatusPill: document.getElementById('jobStatusPill'),
  metricJobCursor: document.getElementById('metricJobCursor'),
  
  speedModeSelect: document.getElementById('speedModeSelect'),
  btnStartPull: document.getElementById('btnStartPull'),
  btnPausePull: document.getElementById('btnPausePull'),
  btnResumePull: document.getElementById('btnResumePull'),
  btnResetDb: document.getElementById('btnResetDb'),
  
  progressStatusLabel: document.getElementById('progressStatusLabel'),
  progressPercentLabel: document.getElementById('progressPercentLabel'),
  progressBarFill: document.getElementById('progressBarFill'),
  chunkCounter: document.getElementById('chunkCounter'),
  recordCounter: document.getElementById('recordCounter'),
  resilienceNote: document.getElementById('resilienceNote'),
  chunkLogFeed: document.getElementById('chunkLogFeed'),
  
  tradesTableBody: document.getElementById('tradesTableBody'),
  tableSubtitle: document.getElementById('tableSubtitle'),
  searchInput: document.getElementById('searchInput'),
  symbolFilter: document.getElementById('symbolFilter'),
  orderPills: document.querySelectorAll('.order-filter-pills .pill'),
  
  pageInfoText: document.getElementById('pageInfoText'),
  btnPrevPage: document.getElementById('btnPrevPage'),
  btnNextPage: document.getElementById('btnNextPage'),
  pageNumberDisplay: document.getElementById('pageNumberDisplay')
};

/**
 * Format Currency (INR)
 */
function formatINR(val) {
  if (typeof val !== 'number') return '₹0';
  return '₹' + val.toLocaleString('en-IN');
}

/**
 * Format Timestamp to readable format
 */
function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-IN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/**
 * Update Ingestion Status Pill
 */
function setStatusPill(status) {
  elements.jobStatusPill.className = 'status-pill';
  switch (status) {
    case 'RUNNING':
      elements.jobStatusPill.classList.add('status-running');
      elements.jobStatusPill.textContent = 'INGESTING...';
      elements.btnStartPull.disabled = true;
      elements.btnPausePull.disabled = false;
      elements.btnResumePull.disabled = true;
      break;
    case 'PAUSED':
      elements.jobStatusPill.classList.add('status-paused');
      elements.jobStatusPill.textContent = 'PAUSED';
      elements.btnStartPull.disabled = true;
      elements.btnPausePull.disabled = true;
      elements.btnResumePull.disabled = false;
      break;
    case 'COMPLETED':
      elements.jobStatusPill.classList.add('status-completed');
      elements.jobStatusPill.textContent = 'COMPLETED';
      elements.btnStartPull.disabled = false;
      elements.btnPausePull.disabled = true;
      elements.btnResumePull.disabled = true;
      break;
    case 'FAILED':
      elements.jobStatusPill.classList.add('status-failed');
      elements.jobStatusPill.textContent = 'FAILED';
      elements.btnStartPull.disabled = false;
      elements.btnPausePull.disabled = true;
      elements.btnResumePull.disabled = false;
      break;
    default:
      elements.jobStatusPill.classList.add('status-idle');
      elements.jobStatusPill.textContent = 'IDLE';
      elements.btnStartPull.disabled = false;
      elements.btnPausePull.disabled = true;
      elements.btnResumePull.disabled = true;
      break;
  }
}

/**
 * Append Log to Live Telemetry Feed
 */
function addTelemetryLog(message, isSafe = true) {
  const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span><span style="color: #64748b;">[${time}]</span> ${message}</span>
    ${isSafe ? '<span class="safe-tag">SAFE &lt;&lt; 30s LIMIT</span>' : ''}
  `;
  
  // Remove placeholder if present
  const placeholder = elements.chunkLogFeed.querySelector('.log-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  elements.chunkLogFeed.prepend(entry);
}

/**
 * Fetch and Render Stored Trades (Instant MongoDB Load)
 */
async function loadTrades() {
  try {
    const params = new URLSearchParams({
      page: state.currentPage,
      limit: state.limit,
      symbol: state.selectedSymbol,
      orderType: state.selectedOrderType,
      search: state.searchQuery
    });

    const res = await fetch(`/api/trades?${params.toString()}`);
    const json = await res.json();

    if (json.status === 'SUCCESS') {
      const { trades, pagination } = json.data;
      state.trades = trades;
      state.totalPages = pagination.totalPages;
      renderTradesTable(trades);
      renderPagination(pagination);
    }
  } catch (err) {
    console.error('Failed to load trades:', err);
  }
}

/**
 * Fetch and Render Dashboard Metrics
 */
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();

    if (json.status === 'SUCCESS') {
      const data = json.data;
      elements.metricTotalTrades.textContent = (data.totalTrades || 0).toLocaleString();
      elements.metricTotalVolume.textContent = formatINR(data.totalVolumeInr || 0);
      elements.metricVolumeRatio.textContent = `Buy: ${formatINR(data.buyVolumeInr || 0)} | Sell: ${formatINR(data.sellVolumeInr || 0)}`;
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

/**
 * Fetch Pull Job Status
 */
async function loadJobStatus() {
  try {
    const res = await fetch('/api/job-status');
    const json = await res.json();

    if (json.status === 'SUCCESS') {
      const { isWorkerRunning, activeJob } = json.data;
      state.isWorkerRunning = isWorkerRunning;
      state.activeJob = activeJob;

      if (activeJob) {
        setStatusPill(activeJob.status);
        updateProgressUI(activeJob);
      } else {
        setStatusPill('IDLE');
      }
    }
  } catch (err) {
    console.error('Failed to load job status:', err);
  }
}

/**
 * Update Progress Bar & Telemetry UI
 */
function updateProgressUI(job) {
  if (!job) return;

  const pulled = job.recordsPulled || 0;
  const total = job.totalRecords || 5000;
  const percent = total > 0 ? Math.min(100, Math.round((pulled / total) * 100)) : 0;

  elements.progressBarFill.style.width = `${percent}%`;
  elements.progressPercentLabel.textContent = `${percent}%`;
  elements.progressStatusLabel.textContent = `Ingestion: ${job.status} (${pulled.toLocaleString()} / ${total.toLocaleString()})`;
  elements.chunkCounter.textContent = `Chunk: ${job.currentChunk || 0} / ${job.totalChunks || 10}`;
  elements.recordCounter.textContent = `Records: ${pulled.toLocaleString()} / ${total.toLocaleString()}`;
  elements.metricJobCursor.textContent = `Cursor: ${job.nextCursor || 0} / ${total.toLocaleString()} records`;

  if (job.status === 'PAUSED') {
    elements.resilienceNote.textContent = `Resumption Cursor Stored: ${job.nextCursor}`;
  } else if (job.status === 'COMPLETED') {
    elements.resilienceNote.textContent = `Full Ingestion Completed in MongoDB`;
  } else {
    elements.resilienceNote.textContent = `Next Chunk Cursor: ${job.nextCursor || 0}`;
  }
}

/**
 * Render Trades Table
 */
function renderTradesTable(trades) {
  if (!trades || trades.length === 0) {
    elements.tradesTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="loading-cell">No trades found in MongoDB. Click "Start Full Pull" to ingest data.</td>
      </tr>
    `;
    elements.tableSubtitle.textContent = 'Showing 0 stored trades';
    return;
  }

  elements.tableSubtitle.textContent = `Showing ${trades.length} stored trades (Loaded instantly from MongoDB)`;

  const rowsHtml = trades.map((t) => {
    const totalVal = Math.round(t.quantity * t.price);
    const orderClass = t.orderType === 'BUY' ? 'buy' : 'sell';

    return `
      <tr id="trade-${t.tradeId}">
        <td style="font-family: var(--font-mono); font-weight: 600;">${t.tradeId}</td>
        <td>${t.client}</td>
        <td><strong style="color: #fff;">${t.symbol}</strong></td>
        <td><span class="badge-order ${orderClass}">${t.orderType}</span></td>
        <td class="num-col">${t.quantity.toLocaleString()}</td>
        <td class="num-col">₹${t.price.toFixed(2)}</td>
        <td class="num-col" style="color: var(--accent-cyan);">₹${totalVal.toLocaleString('en-IN')}</td>
        <td><span style="font-size: 11px; color: var(--text-muted);">${t.exchange || 'BSE'}</span></td>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);">${formatTime(t.timestamp)}</td>
      </tr>
    `;
  }).join('');

  elements.tradesTableBody.innerHTML = rowsHtml;
}

/**
 * Prepend New Chunk Trades to Table with Glow Flash Animation
 */
function prependNewTrades(recentTrades) {
  if (!recentTrades || recentTrades.length === 0) return;

  const currentFirstTr = elements.tradesTableBody.querySelector('tr');
  if (currentFirstTr && currentFirstTr.querySelector('.loading-cell')) {
    elements.tradesTableBody.innerHTML = '';
  }

  // Prepend up to 10 newest items to give instant visual feedback
  const rows = recentTrades.slice(0, 5).map((t) => {
    const totalVal = Math.round(t.quantity * t.price);
    const orderClass = t.orderType === 'BUY' ? 'buy' : 'sell';

    return `
      <tr id="trade-${t.tradeId}" class="trade-row-new">
        <td style="font-family: var(--font-mono); font-weight: 600;">${t.tradeId}</td>
        <td>${t.client}</td>
        <td><strong style="color: #fff;">${t.symbol}</strong></td>
        <td><span class="badge-order ${orderClass}">${t.orderType}</span></td>
        <td class="num-col">${t.quantity.toLocaleString()}</td>
        <td class="num-col">₹${Number(t.price).toFixed(2)}</td>
        <td class="num-col" style="color: var(--accent-cyan);">₹${totalVal.toLocaleString('en-IN')}</td>
        <td><span style="font-size: 11px; color: var(--text-muted);">${t.exchange || 'BSE'}</span></td>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);">${formatTime(t.timestamp)}</td>
      </tr>
    `;
  }).join('');

  elements.tradesTableBody.insertAdjacentHTML('afterbegin', rows);

  // Limit table view size if on page 1
  if (state.currentPage === 1) {
    const allRows = elements.tradesTableBody.querySelectorAll('tr');
    if (allRows.length > state.limit) {
      for (let i = state.limit; i < allRows.length; i++) {
        allRows[i].remove();
      }
    }
  }
}

/**
 * Render Pagination Info and Button States
 */
function renderPagination(pagination) {
  elements.pageInfoText.textContent = `Showing Page ${pagination.page} of ${pagination.totalPages} (${pagination.totalRecords.toLocaleString()} total trades)`;
  elements.pageNumberDisplay.textContent = `Page ${pagination.page} / ${pagination.totalPages}`;
  elements.btnPrevPage.disabled = pagination.page <= 1;
  elements.btnNextPage.disabled = pagination.page >= pagination.totalPages;
}

/**
 * Establish WebSocket Connection (Zero Polling Live Feed)
 */
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  console.log(`[WebSocket] Connecting to ${wsUrl}`);
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    elements.wsDot.className = 'status-dot connected';
    elements.wsStatusText.textContent = 'Live Feed Connected';
  };

  state.ws.onclose = () => {
    elements.wsDot.className = 'status-dot disconnected';
    elements.wsStatusText.textContent = 'Disconnected (Reconnecting...)';
    setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = (err) => {
    console.error('[WebSocket] Error:', err);
    elements.wsDot.className = 'status-dot disconnected';
  };

  // Real-Time Event Dispatcher
  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  };
}

/**
 * Process Reactive WebSocket Messages
 */
function handleWebSocketMessage(msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'PULL_STARTED':
      setStatusPill('RUNNING');
      addTelemetryLog(`Initiated chunked pull (${payload.jobId}). Resuming at cursor ${payload.resumingFromCursor}.`);
      break;

    case 'CHUNK_INGESTED':
      setStatusPill('RUNNING');
      updateProgressUI({
        recordsPulled: payload.recordsPulled,
        totalRecords: payload.totalRecords,
        currentChunk: payload.chunkIndex,
        totalChunks: payload.totalChunks,
        nextCursor: payload.nextCursor,
        status: 'RUNNING'
      });
      
      addTelemetryLog(
        `Chunk ${payload.chunkIndex}/${payload.totalChunks}: +${payload.chunkSize} trades ingested in ${payload.fetchDurationMs}ms (HTTP open: ${(payload.fetchDurationMs / 1000).toFixed(1)}s)`
      );

      // Prepend trades into live UI without page refresh
      prependNewTrades(payload.recentTrades);
      loadStats();
      break;

    case 'PULL_COMPLETED':
      setStatusPill('COMPLETED');
      updateProgressUI({
        recordsPulled: payload.totalRecordsPulled,
        totalRecords: payload.totalRecordsPulled,
        currentChunk: payload.totalChunks,
        totalChunks: payload.totalChunks,
        nextCursor: payload.totalRecordsPulled,
        status: 'COMPLETED'
      });
      
      addTelemetryLog(`PULL COMPLETED: ${payload.totalRecordsPulled.toLocaleString()} total BSE trades safely ingested into MongoDB.`);
      loadStats();
      loadTrades();
      break;

    case 'JOB_STATUS_CHANGED':
      setStatusPill(payload.status);
      if (payload.status === 'PAUSED') {
        addTelemetryLog(`Ingestion PAUSED at cursor ${payload.nextCursor}. State preserved in MongoDB.`);
      } else if (payload.status === 'FAILED') {
        addTelemetryLog(`Ingestion error: ${payload.error}`, false);
      }
      break;

    case 'SYSTEM_RESET':
      setStatusPill('IDLE');
      updateProgressUI({
        recordsPulled: 0,
        totalRecords: 0,
        currentChunk: 0,
        totalChunks: 0,
        nextCursor: 0,
        status: 'IDLE'
      });
      addTelemetryLog(`Database reset. All trades cleared.`);
      loadStats();
      loadTrades();
      break;

    default:
      break;
  }
}

/**
 * Attach UI Event Listeners
 */
function setupEventListeners() {
  // Start Pull
  elements.btnStartPull.addEventListener('click', async () => {
    try {
      const delayPerChunkMs = parseInt(elements.speedModeSelect.value, 10);
      const res = await fetch('/api/pull/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delayPerChunkMs, forceNew: true })
      });
      const data = await res.json();
      if (data.status === 'SUCCESS') {
        setStatusPill('RUNNING');
      }
    } catch (e) {
      alert('Error starting pull: ' + e.message);
    }
  });

  // Pause Pull
  elements.btnPausePull.addEventListener('click', async () => {
    try {
      await fetch('/api/pull/pause', { method: 'POST' });
    } catch (e) {
      console.error('Error pausing pull:', e);
    }
  });

  // Resume Pull
  elements.btnResumePull.addEventListener('click', async () => {
    try {
      const delayPerChunkMs = parseInt(elements.speedModeSelect.value, 10);
      await fetch('/api/pull/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delayPerChunkMs })
      });
    } catch (e) {
      console.error('Error resuming pull:', e);
    }
  });

  // Reset DB
  elements.btnResetDb.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all stored trades and jobs in MongoDB?')) {
      try {
        await fetch('/api/pull/reset', { method: 'POST' });
      } catch (e) {
        console.error('Error resetting DB:', e);
      }
    }
  });

  // Search Filter
  let searchTimeout = null;
  elements.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      state.currentPage = 1;
      loadTrades();
    }, 250);
  });

  // Symbol Filter
  elements.symbolFilter.addEventListener('change', (e) => {
    state.selectedSymbol = e.target.value;
    state.currentPage = 1;
    loadTrades();
  });

  // Order Type Pills
  elements.orderPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      elements.orderPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.selectedOrderType = pill.dataset.order;
      state.currentPage = 1;
      loadTrades();
    });
  });

  // Pagination
  elements.btnPrevPage.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      loadTrades();
    }
  });

  elements.btnNextPage.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) {
      state.currentPage++;
      loadTrades();
    }
  });
}

// Initial Bootstrapping
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  connectWebSocket();
  
  // Instant Loads from MongoDB
  loadTrades();
  loadStats();
  loadJobStatus();
});
