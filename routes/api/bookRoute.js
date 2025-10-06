const express = require('express');
const { searchBooks, getBookById, getChapterById, unlockChapter, getNewBooks, getLatestUpdatedBooks, getTrendingBooks, getBookRecommendations, getBookComments, getBookWithComments, getAllBooks } = require('../../controllers/bookController');
const { protect, optionalAuthMiddleware } = require("../../middlewares/authMiddleware")

const router = express.Router();

router.get('/books/search', searchBooks); // Search and filter books based on query parameters
router.get('/books/new', getNewBooks); // Get the 10 newest books added to the platform
router.get('/books/trending', getTrendingBooks); // Get the top 10 trending books
router.get('/books/latest-updates', getLatestUpdatedBooks); // Get latest updated books
router.get('/books/recommendations', optionalAuthMiddleware, getBookRecommendations); //Get random book recommendations


router.get('/books/:id', getBookById); // Get details of a specific book by ID
router.get('/books/:bookId/comments', getBookComments); // Get comments for a specific book by ID
router.get('/books/:id/comments/together', getBookWithComments); // Get comments for a specific book by ID
router.get('/books/:bookId/chapters/:chapterId', optionalAuthMiddleware, getChapterById); // Get details of a specific chapter by ID within a specific book
router.post('/books/:bookId/chapters/:chapterId/unlock', protect, unlockChapter); // Unlock a locked chapter using coins

router.get('/books/', getAllBooks); // Get all books with pagination 

module.exports = router;