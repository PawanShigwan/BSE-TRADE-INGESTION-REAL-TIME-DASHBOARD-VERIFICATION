/**
 * Mongoose Model: Trade
 * Stores ingested BSE trades.
 */

const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  tradeId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  client: {
    type: String,
    required: true,
    index: true
  },
  symbol: {
    type: String,
    required: true,
    index: true
  },
  quantity: {
    type: Number,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  orderType: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true
  },
  exchange: {
    type: String,
    default: 'BSE'
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  jobId: {
    type: String,
    index: true
  },
  chunkIndex: {
    type: Number
  },
  pulledAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for fast queries and analytics
tradeSchema.index({ symbol: 1, timestamp: -1 });
tradeSchema.index({ client: 1, timestamp: -1 });

module.exports = mongoose.model('Trade', tradeSchema);
