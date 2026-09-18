const { join } = require('path');

module.exports = {
  // Directs Puppeteer to store Chrome inside your project folder on Render
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};