const express = require('express');
const { registerUser, loginUser, getProfile, updateProfile, getUserBookmarks } = require('../../controllers/userController');
const { protect } = require('../../middlewares/authMiddleware');

const router = express.Router();

// Public routes
router.post('/register', registerUser); // Register user
router.post('/login', loginUser);       // Login user

// Protected routes (requires login)
router.get('/profile', protect, getProfile);       // Get user profile
router.put('/profile', protect, updateProfile);    // Update user profile
router.get('/bookmarks', protect, getUserBookmarks);    // Get the list of bookmarked books by the logged-in user

module.exports = router;
