const Book = require('../models/Book');
const User = require('../models/User');

async function getRecommendedBooks(userId = null, limit = 10) {
	let recommendations = [];

	if (userId) {
		// Registered user: Use personalized recommendations
		const user = await User.findById(userId).populate('readingHistory.book', 'category tags').select('readingHistory.book');

		// Get categories and tags from user's reading history
		const userCategories = new Set();
		const userTags = new Set();
		const readBookIds = new Set();

		user.readingHistory.forEach(history => {
			if (history.book) {
				readBookIds.add(history.book?._id.toString());
				userCategories.add(history.book.category);
				history.book.tags.forEach(tag => userTags.add(tag));
			}
		});

		// Build a query based on user's preferences
		const baseQuery = { _id: { $nin: Array.from(readBookIds) } }; // Exclude already read books
		const preferenceQuery = {
			...baseQuery,
			$or: [
				{ category: { $in: Array.from(userCategories) } },
				{ tags: { $in: Array.from(userTags) } }
			]
		};

		// Calculate balanced limits for each category
		const preferredLimit = Math.floor(limit * 0.4); // The limit parameter is set to 40% of the total limit
		const popularLimit = Math.floor(limit * 0.3); // The limit parameter is set to 30% of the total limit
		const randomLimit = limit - preferredLimit - popularLimit; // The limit parameter is set to 30% of the total limit

		// Get a mix of books: some based on user preferences, some popular, some random
		const [preferredBooks, popularBooks, randomBooks] = await Promise.all([
			Book.find(preferenceQuery).limit(preferredLimit),
			Book.find(baseQuery).sort({ views: -1, likeCount: -1 }).limit(popularLimit),
			Book.aggregate([{ $match: baseQuery }, { $sample: { size: randomLimit } }])
		]);

		// Combine all fetched books
		recommendations = [...preferredBooks, ...popularBooks, ...randomBooks];
	} else {
		// Calculate balanced limits for each category
		const popularLimit = Math.floor(limit * 0.4); // The limit parameter is set to 40% of the total limit
		const recentLimit = Math.floor(limit * 0.4); // The limit parameter is set to 40% of the total limit
		const randomLimit = limit - popularLimit - recentLimit; // The limit parameter is set to 20% of the total limit


		// Guest user: Use a mix of popular, recent, and random books
		const [popularBooks, recentBooks, randomBooks] = await Promise.all([
			Book.find().sort({ views: -1, likeCount: -1 }).limit(popularLimit),
			Book.find().sort({ createdAt: -1 }).limit(recentLimit),
			Book.aggregate([{ $sample: { size: randomLimit } }])
		]);

		recommendations = [...popularBooks, ...recentBooks, ...randomBooks];
	}

	// Shuffle the recommendations using Fisher-Yates shuffle algorithm, also known as the Knuth shuffle. This algorithm efficiently randomizes the order of elements in an array.
	for (let i = recommendations.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[recommendations[i], recommendations[j]] = [recommendations[j], recommendations[i]];
	}

	// Remove any potential duplicates (in case of overlaps between categories)
	const uniqueRecommendations = Array.from(
		new Map(recommendations.map(book => [book._id.toString(), book]))
	).map(([_, book]) => book);

	return uniqueRecommendations.slice(0, limit);
}

module.exports = { getRecommendedBooks };