const jwt = require("jsonwebtoken");
require("dotenv").config();
const User = require("../models/User");

const protect = async (req, res, next) => {
	const token = req.header("Authorization")?.split(" ")[1];

	if (!token) {
		return res.status(401).json({
			status: "fail",
			error: "Unauthorized. No token provided."
		});
	}

	try {
		const userId = jwt.verify(token, process.env.JWT_SECRET);
		// Attach user to request object
		req.user = await User.findById(userId.id).select("-password");

		if (!req.user) {
			return res.status(404).json({ status: "fail", error: "User not found" });
		}

		next();
	} catch (error) {
		if (error.name === "TokenExpiredError") {
			return res.status(401).json({
				status: "fail",
				error: "Token has expired. Please log in again."
			});
		} else if (error.name === "JsonWebTokenError") {
			return res.status(401).json({
				status: "fail",
				error: "Invalid token. Please log in or provide a valid token."
			});
		} else {
			return res.status(500).json({
				status: "fail",
				error: "Something went wrong with token verification."
			});
		}
	}
};

// Middleware to optionally authenticate users
const optionalAuthMiddleware = async (req, res, next) => {
	const authHeader = req.headers.authorization;

	if (authHeader && authHeader.startsWith('Bearer ')) {
		const token = authHeader.split(' ')[1];

		try {
			const decoded = jwt.verify(token, process.env.JWT_SECRET);
			const user = await User.findById(decoded.id).select('-password'); // Exclude password from user object

			if (user) {
				req.user = user; // Attach user object to request
			} else {
				return res.status(404).json({
					status: 'fail',
					message: 'User not found'
				});
			}
		} catch (error) {
			console.error('Error verifying token:', error);
			// Token is invalid, but we'll allow the request to continue as a guest
		}
	}
	// Proceed to next middleware regardless of authentication
	next();
};


// Middleware to verify admin role
const admin = (req, res, next) => {
	try {
		if (req.user && req.user.role === "admin") {
			next();
		} else {
			res.status(403).json({ status: "fail", error: "Access denied. Admin access required." });
		}
	} catch (error) {
		res.status(500).json({ status: "fail", error: "Authorization error" });
	}
};

module.exports = { protect, optionalAuthMiddleware, admin };
