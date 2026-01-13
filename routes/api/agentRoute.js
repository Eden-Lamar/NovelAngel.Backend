const express = require('express');
const { autoTranslateChapter, bulkTranslateChapters } = require('../../controllers/agentController');
const { protect, admin } = require('../../middlewares/authMiddleware');
const router = express.Router();

// Agent Routes
router.post('/single', protect, admin, autoTranslateChapter); // Auto-translate and publish a chapter
router.post('/bulk', protect, admin, bulkTranslateChapters); // Auto-translate and publish a multiple chapters

module.exports = router;