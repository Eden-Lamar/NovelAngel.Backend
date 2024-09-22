const express = require('express');
const { searchBooks, getBookById, getChapterById } = require('../../controllers/bookController');

const router = express.Router();

// Search and filter books based on query parameters
router.get('/books/search', searchBooks);
router.get('/books/:id', getBookById);
router.get('/books/:bookId/chapters/:chapterId', getChapterById);

module.exports = router;
