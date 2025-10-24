const express = require('express');
const multer = require('multer');
const { registerUser, loginUser, getProfile, updateProfile, getUserBookmarks, getReadingHistory, getContinueReading } = require('../../controllers/userController');
const { protect } = require('../../middlewares/authMiddleware');

const router = express.Router();
const storage = multer.memoryStorage()
const upload = multer({
	storage,
	limits: { fileSize: 3 * 1024 * 1024 }, // 3MB file size limit
});


// Public routes
router.post('/register', registerUser); // Register user
router.post('/login', loginUser);       // Login user

// Protected routes (requires login)
router.get('/profile', protect, getProfile);       // Get user profile
router.put('/profile', protect, upload.single('avatar'), updateProfile);    // Update user profile
router.get('/bookmarks', protect, getUserBookmarks);    // Get the list of bookmarked books by the logged-in user
router.get('/history', protect, getReadingHistory);    // Get a user's reading history
router.get('/continue-reading', protect, getContinueReading);    // Get a user list of book and chapters they read last

module.exports = router;
