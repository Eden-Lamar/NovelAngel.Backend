const express = require('express');
const { bulkTranslateChapters, retryFailedChapters, getMissionStatus } = require('../../controllers/agentController');
const { protect, admin } = require('../../middlewares/authMiddleware');
const router = express.Router();

// Agent Routes
// router.post('/single', protect, admin, autoTranslateChapter); // Auto-translate and publish a chapter
router.post('/bulk-inngest', protect, admin, bulkTranslateChapters); // Auto-translate and publish a multiple chapters
router.get('/mission/:missionId', protect, admin, getMissionStatus); // Poll the mission status
router.post('/retry-failed', protect, admin, retryFailedChapters); // Retry failed chapters

module.exports = router;