const express = require('express');
const { previewTranslation, publishChapter } = require('../../controllers/agentController');
const { protect, admin } = require('../../middlewares/authMiddleware');
const router = express.Router();

// Agent Routes
router.post('/preview', protect, admin, previewTranslation);
router.post('/publish', protect, admin, publishChapter);

module.exports = router;