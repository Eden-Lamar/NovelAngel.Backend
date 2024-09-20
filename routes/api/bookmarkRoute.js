const express = require('express');
const router = express.Router();
const { toggleBookmark } = require('../../controllers/bookmarkController');
const { protect } = require('../../middlewares/authMiddleware');

// Toggle bookmark on a book
router.post('/books/:bookId/toggle-bookmark', protect, toggleBookmark);

module.exports = router;
