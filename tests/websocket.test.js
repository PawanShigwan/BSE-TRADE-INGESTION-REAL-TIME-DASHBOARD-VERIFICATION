/**
 * Test Suite: WebSocket Broadcast & Real-Time Event Dispatching
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { WebSocket } = require('ws');

const wsManager = require('../ingestion-service/wsServer');

let server = null;
let port = 0;

test.before(async () => {
  server = http.createServer();
  wsManager.init(server);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

test.after(async () => {
  if (server) server.close();
});

test('WebSocket Manager initializes and broadcasts event frames to connected clients', async () => {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const receivedMessages = [];

  await new Promise((resolve) => {
    ws.on('open', () => {
      ws.on('message', (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
        if (receivedMessages.length >= 2) {
          ws.close();
          resolve();
        }
      });

      // Broadcast event frame
      setTimeout(() => {
        wsManager.broadcast('CHUNK_INGESTED', {
          jobId: 'test_job_1',
          chunkIndex: 1,
          totalChunks: 10,
          recordsPulled: 500
        });
      }, 100);
    });
  });

  assert.strictEqual(receivedMessages[0].type, 'CONNECTED');
  assert.strictEqual(receivedMessages[1].type, 'CHUNK_INGESTED');
  assert.strictEqual(receivedMessages[1].payload.jobId, 'test_job_1');
  assert.strictEqual(receivedMessages[1].payload.recordsPulled, 500);
});
