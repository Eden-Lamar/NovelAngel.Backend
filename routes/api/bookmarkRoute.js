const express = require('express');
const router = express.Router();
const { toggleBookmark, getBookmarkStatus } = require('../../controllers/bookmarkController');
const { protect } = require('../../middlewares/authMiddleware');

// Toggle bookmark on a book
router.post('/books/:bookId/toggle-bookmark', protect, toggleBookmark);

// Check if a user has bookmarked a book
router.get('/books/:bookId/bookmark-status', protect, getBookmarkStatus);

module.exports = router;
