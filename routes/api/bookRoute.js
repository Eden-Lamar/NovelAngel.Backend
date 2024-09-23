const express = require('express');
const { searchBooks, getBookById, getChapterById, getNewBooks, getLatestUpdatedBooks } = require('../../controllers/bookController');

const router = express.Router();

router.get('/books/search', searchBooks); // Search and filter books based on query parameters
router.get('/books/new', getNewBooks); // Get the 10 newest books added to the platform
router.get('/books/latest-updates', getLatestUpdatedBooks); // Get latest updated books
router.get('/books/:id', getBookById); // Get details of a specific book by ID
router.get('/books/:bookId/chapters/:chapterId', getChapterById); // Get details of a specific chapter by ID within a specific book

module.exports = router;
