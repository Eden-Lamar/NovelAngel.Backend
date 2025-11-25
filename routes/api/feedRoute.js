const express = require('express');
const { getRSSFeed } = require('../../controllers/feedController');

const router = express.Router();

// @route GET /api/v1/feed/rss
router.get('/rss', getRSSFeed);

module.exports = router;
