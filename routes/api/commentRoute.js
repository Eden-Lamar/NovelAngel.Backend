const express = require('express');
const router = express.Router();
const { addComment, deleteComment } = require('../../controllers/commentController');
const { protect } = require('../../middlewares/authMiddleware');

// Add a comment to a book
router.post('/books/:bookId/comments', protect, addComment);

// Delete a comment
router.delete('/comments/:commentId', protect, deleteComment);

module.exports = router;
