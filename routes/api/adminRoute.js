const express = require('express');
const multer = require('multer');
const { addBook, updateBook, deleteBook, addChapter, updateChapter, deleteChapter } = require('../../controllers/adminController');
const { protect, admin } = require('../../middlewares/authMiddleware');

const router = express.Router();
const storage = multer.memoryStorage()
const upload = multer({
	storage,
	limits: { fileSize: 3 * 1024 * 1024 }, // 3MB file size limit
});


// Book Routes
router.post('/books', protect, admin, upload.single('bookImage'), addBook);             // Create new book
router.put('/books/:bookId', protect, admin, updateBook);   // Update a book
router.delete('/books/:bookId', protect, admin, deleteBook); // Delete a book

// Admin can upload chapters
router.post("/books/:bookId/chapters", protect, admin, addChapter); // Add a new chapter
router.put('/chapters/:chapterId', protect, admin, updateChapter);  // Update a chapter
router.delete('/books/:bookId/chapters/:chapterId', protect, admin, deleteChapter); // Delete a chapter

module.exports = router;
