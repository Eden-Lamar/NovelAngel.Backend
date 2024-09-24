const express = require('express');
const { registerUser, loginUser, getProfile, updateProfile, getUserBookmarks, getReadingHistory } = require('../../controllers/userController');
const { protect } = require('../../middlewares/authMiddleware');

const router = express.Router();

// Public routes
router.post('/register', registerUser); // Register user
router.post('/login', loginUser);       // Login user

// Protected routes (requires login)
router.get('/profile', protect, getProfile);       // Get user profile
router.put('/profile', protect, updateProfile);    // Update user profile
router.get('/bookmarks', protect, getUserBookmarks);    // Get the list of bookmarked books by the logged-in user
router.get('/history', protect, getReadingHistory);    // Get a user's reading history

module.exports = router;
