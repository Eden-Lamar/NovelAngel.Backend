const { join } = require('path');

const config = {};

// Render automatically sets process.env.RENDER to 'true'
// This ensures the custom cache path is ONLY used in production
if (process.env.RENDER || process.env.NODE_ENV === 'production') {
  config.cacheDirectory = join(__dirname, '.cache', 'puppeteer');
}

module.exports = config;