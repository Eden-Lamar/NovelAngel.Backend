const express = require('express');
const router = express.Router();
const { toggleLike, getLikeStatus } = require('../../controllers/likeController');
const { protect } = require('../../middlewares/authMiddleware');

// Toggle like on a book
router.post('/books/:bookId/toggle-like', protect, toggleLike);

// Get like status for a book
router.get('/books/:bookId/like-status', protect, getLikeStatus);

module.exports = router;
