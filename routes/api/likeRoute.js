const express = require('express');
const router = express.Router();
const { toggleLike } = require('../../controllers/likeController');
const { protect } = require('../../middlewares/authMiddleware');

// Toggle like on a book
router.post('/books/:bookId/toggle-like', protect, toggleLike);

module.exports = router;
