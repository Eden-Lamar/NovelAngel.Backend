const jwt = require("jsonwebtoken");
require("dotenv").config();

const protect = (req, res, next) => {
	const token = req.header("Authorization")?.split(" ")[1];

	if (!token) {
		return res.status(401).json({
			status: "fail",
			error: "Unauthorized. No token provided."
		});
	}

	try {
		const userId = jwt.verify(token, process.env.JWT_SECRET);
		req.user = userId; // Save the decoded user data to the request object
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

module.exports = { protect };
