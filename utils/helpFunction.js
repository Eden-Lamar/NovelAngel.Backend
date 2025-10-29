const jwt = require('jsonwebtoken');

const calculateTimeAgo = (date) => {
	const now = Date.now();
	const difference = now - new Date(date).getTime();

	const minutes = Math.floor(difference / (1000 * 60));
	const hours = Math.floor(difference / (1000 * 60 * 60));
	const days = Math.floor(difference / (1000 * 60 * 60 * 24));
	const weeks = Math.floor(days / 7);
	const months = Math.floor(days / 30);
	const years = Math.floor(days / 365);

	if (minutes <= 0) return "just now";
	if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
	if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
	if (weeks <= 4) return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
	if (months >= 1 && months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
	return `${years} year${years > 1 ? "s" : ""} ago`;
};

// Generate JWT token
const generateToken = (id) => {
	return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '20d' });
};

module.exports = {
	calculateTimeAgo,
	generateToken
};
