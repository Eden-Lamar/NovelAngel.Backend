const express = require('express');
const multer = require('multer');
const { registerUser, loginUser, getProfile, updateProfile, getUserBookmarks, getReadingHistory, getContinueReading, getAllCustomers } = require('../../controllers/userController');
const { protect, admin } = require('../../middlewares/authMiddleware');
const { generateToken } = require('../../utils/helpFunction');
const passport = require('passport');
const router = express.Router();
const storage = multer.memoryStorage()
const upload = multer({
	storage,
	limits: { fileSize: 3 * 1024 * 1024 }, // 3MB file size limit
});
require('../../config/passport');  // make sure passport is initialized

// Google OAuth route
router.get(
	"/auth/google",
	passport.authenticate("google", { scope: ["profile", "email"] })
);


// Google callback
router.get(
	"/auth/google/callback",
	passport.authenticate("google", { session: false }),
	(req, res) => {
		const token = generateToken(req.user._id);
		// Redirect to frontend with JWT
		res.redirect(`${process.env.FRONTEND_USER_URL}/login?token=${token}`);
	}
);

// Public routes
router.post('/register', registerUser); // Register user
router.post('/login', loginUser);       // Login user

// Protected routes (requires login)
router.get('/profile', protect, getProfile);       // Get user profile
router.put('/profile', protect, upload.single('avatar'), updateProfile);    // Update user profile
router.get('/bookmarks', protect, getUserBookmarks);    // Get the list of bookmarked books by the logged-in user
router.get('/history', protect, getReadingHistory);    // Get a user's reading history
router.get('/continue-reading', protect, getContinueReading);    // Get a user list of book and chapters they read last
router.get('/customers', protect, admin, getAllCustomers);    // Get all customers (users with role 'user')


module.exports = router;
