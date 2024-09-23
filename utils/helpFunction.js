const jwt = require('jsonwebtoken');

const calculateTimeAgo = (date) => {
	const now = Date.now();
	const difference = now - new Date(date).getTime();
	const minutes = Math.floor(difference / 1000 / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days} days ago`;
	if (hours > 0) return `${hours} hours ago`;
	return `${minutes} minutes ago`;
};

// Generate JWT token
const generateToken = (id) => {
	return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

module.exports = {
	calculateTimeAgo,
	generateToken
};
