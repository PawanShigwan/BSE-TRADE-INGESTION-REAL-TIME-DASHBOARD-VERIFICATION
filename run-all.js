/**
 * Unified Process Orchestrator
 * Starts both the BSE Mock Exchange API (port 3001) and Ingestion/Dashboard Server (port 4000).
 */

const { fork } = require('child_process');
const path = require('path');

console.log('===============================================================');
console.log('  ARHAM FINTECH - BSE TRADE INGESTION & LIVE DASHBOARD SYSTEM  ');
console.log('===============================================================');
console.log('Starting services...\n');

const bseProcess = fork(path.join(__dirname, 'bse-mock-api/server.js'), [], {
  env: { ...process.env, BSE_PORT: '3001' }
});

let ingestionProcess = null;

// Give BSE mock server 500ms head start
setTimeout(() => {
  ingestionProcess = fork(path.join(__dirname, 'ingestion-service/server.js'), [], {
    env: { ...process.env, PORT: '4000', BSE_API_URL: 'http://localhost:3001' }
  });

  ingestionProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[Process] Ingestion service exited with code ${code}`);
    }
  });
}, 600);

bseProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[Process] BSE Mock API exited with code ${code}`);
  }
});

function gracefulShutdown() {
  console.log('\n[Process] Terminating services cleanly...');
  if (bseProcess) bseProcess.kill('SIGINT');
  if (ingestionProcess) ingestionProcess.kill('SIGINT');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
