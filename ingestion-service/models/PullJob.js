/**
 * Mongoose Model: PullJob
 * Tracks pull state in MongoDB for resilient resumption across pauses/restarts.
 */

const mongoose = require('mongoose');

const pullJobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['IDLE', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED'],
    default: 'IDLE',
    index: true
  },
  nextCursor: {
    type: Number,
    default: 0
  },
  recordsPulled: {
    type: Number,
    default: 0
  },
  totalRecords: {
    type: Number,
    default: 0
  },
  currentChunk: {
    type: Number,
    default: 0
  },
  totalChunks: {
    type: Number,
    default: 0
  },
  delayPerChunkMs: {
    type: Number,
    default: 1500
  },
  error: {
    type: String,
    default: null
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PullJob', pullJobSchema);
