/**
 * Ingestion Service Configuration
 */

module.exports = {
  PORT: process.env.PORT || 4000,
  get BSE_API_URL() {
    return process.env.BSE_API_URL || 'http://localhost:3001';
  },
  MONGODB_URI: process.env.MONGODB_URI, // Set MONGODB_URI in your .env file (see .env.example)
  CHUNK_LIMIT: parseInt(process.env.CHUNK_LIMIT, 10) || 500,
  DEFAULT_DELAY_PER_CHUNK_MS: parseInt(process.env.DEFAULT_DELAY_PER_CHUNK_MS, 10) || 1500,
  // Strict timeout guard to ensure no single connection exceeds 28s (under the 30s network limit)
  CHUNK_TIMEOUT_MS: 28000
};
