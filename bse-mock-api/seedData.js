/**
 * BSE Trade Data Seeder
 * Generates 5,000+ realistic Indian Stock Exchange (BSE) trade records.
 */

const SYMBOLS = [
  { symbol: 'RELIANCE', basePrice: 2980.50, volatility: 25.0 },
  { symbol: 'TCS', basePrice: 4120.00, volatility: 35.0 },
  { symbol: 'HDFCBANK', basePrice: 1640.25, volatility: 15.0 },
  { symbol: 'INFY', basePrice: 1850.75, volatility: 20.0 },
  { symbol: 'ICICIBANK', basePrice: 1210.30, volatility: 12.0 },
  { symbol: 'SBIN', basePrice: 825.60, volatility: 10.0 },
  { symbol: 'BHARTIARTL', basePrice: 1480.00, volatility: 18.0 },
  { symbol: 'ITC', basePrice: 495.40, volatility: 5.0 },
  { symbol: 'KOTAKBANK', basePrice: 1780.00, volatility: 16.0 },
  { symbol: 'LT', basePrice: 3620.00, volatility: 30.0 },
  { symbol: 'AXISBANK', basePrice: 1190.50, volatility: 14.0 },
  { symbol: 'TATAMOTORS', basePrice: 1060.80, volatility: 15.0 },
  { symbol: 'MARUTI', basePrice: 12450.00, volatility: 80.0 },
  { symbol: 'BAJFINANCE', basePrice: 7150.00, volatility: 60.0 },
  { symbol: 'SUNPHARMA', basePrice: 1720.00, volatility: 18.0 },
  { symbol: 'TITAN', basePrice: 3540.00, volatility: 28.0 },
  { symbol: 'ADANIENT', basePrice: 3120.00, volatility: 45.0 },
  { symbol: 'NTPC', basePrice: 395.20, volatility: 6.0 },
  { symbol: 'ULTRACEMCO', basePrice: 11200.00, volatility: 90.0 },
  { symbol: 'WIPRO', basePrice: 540.10, volatility: 8.0 }
];

const CLIENTS = [
  'Zerodha Broking Ltd',
  'Groww Invest Tech',
  'HDFC Securities',
  'ICICI Direct Markets',
  'Kotak Securities',
  'Angel One Limited',
  'Upstox Securities',
  'Motilal Oswal Financial',
  'Axis Direct Trading',
  'Sharekhan Financial'
];

const ORDER_TYPES = ['BUY', 'SELL'];
const QUANTITIES = [10, 25, 50, 75, 100, 150, 200, 500, 1000, 2500];

/**
 * Generates N realistic BSE trade records.
 * @param {number} count Total number of records to generate (default: 5000)
 * @returns {Array<Object>} Array of seeded trade objects
 */
function generateTrades(count = 5000) {
  const trades = [];
  const baseTime = Date.now() - (count * 120); // Distributed over recent timeframe

  for (let i = 0; i < count; i++) {
    const stock = SYMBOLS[i % SYMBOLS.length];
    const client = CLIENTS[i % CLIENTS.length];
    const orderType = ORDER_TYPES[Math.floor(Math.random() * ORDER_TYPES.length)];
    const quantity = QUANTITIES[Math.floor(Math.random() * QUANTITIES.length)];
    
    // Price with minor random fluctuation around base price
    const delta = (Math.random() - 0.5) * 2 * stock.volatility;
    const price = parseFloat((stock.basePrice + delta).toFixed(2));
    
    const tradeTimestamp = new Date(baseTime + (i * 120)).toISOString();
    const tradeId = `BSE-${String(i + 1).padStart(6, '0')}`;

    trades.push({
      tradeId,
      client,
      symbol: stock.symbol,
      quantity,
      price,
      orderType,
      exchange: 'BSE',
      timestamp: tradeTimestamp
    });
  }

  return trades;
}

// Cached in memory for the mock server lifecycle
let cachedTrades = null;

function getOrSeedTrades(count = 5000) {
  if (!cachedTrades || cachedTrades.length !== count) {
    cachedTrades = generateTrades(count);
  }
  return cachedTrades;
}

module.exports = {
  generateTrades,
  getOrSeedTrades
};
