const RSS = require('rss');
const Chapter = require('../models/Chapter');

// @description: Generate RSS Feed for Novel Updates/Aggregators
// @route GET /api/v1/feed/rss
// @access Public
const getRSSFeed = async (req, res) => {
	try {
		// 1. Initialize the RSS Feed Object
		const feed = new RSS({
			title: "Novel Angel Releases",
			description: "Latest translated chapters from Novel Angel",

			// 1. FEED_URL: This is your BACKEND (API) address
			// Bots visit this to read the XML
			feed_url: `${process.env.API_URL}/api/v1/feed/rss`,

			// 2. SITE_URL: This is your USER FRONTEND
			// If someone clicks the main site link
			site_url: process.env.FRONTEND_USER_URL,

			// image_url: `${process.env.FRONTEND_USER_URL}/logo.png`,
			language: 'en',
			pubDate: new Date(),
		});

		// 2. Query the DB for the latest chapters
		// We filter for isLocked: false because NU usually links to free chapters.
		const chapters = await Chapter.find({ isLocked: false })
			.sort({ createdAt: -1 }) // Sort by newest first
			.limit(20) // Limit to 20 items (standard for RSS)
			.populate('book', 'title author bookImage') // We need the Book title for the RSS item title
			.exec();

		// 3. Loop through chapters and add them to the feed
		chapters.forEach(chapter => {
			// Safety check: ensure the book document still exists
			if (chapter.book) {
				feed.item({
					// CRITICAL: Format must be "Novel Title - Chapter X" for NU bots to auto-parse it
					title: `${chapter.book.title} - Chapter ${chapter.chapterNo}`,

					// The description users see in RSS readers
					description: `Read ${chapter.book.title} Chapter ${chapter.chapterNo} - ${chapter.title || ''}`,

					// The link users click to read the chapter
					// Matches your frontend route: /book/:bookId/read?chapterId=...
					url: `${process.env.FRONTEND_USER_URL}/book/${chapter.book._id}/read?chapterId=${chapter._id}`,

					// Unique identifier for this item (prevents duplicate posts)
					guid: chapter._id.toString(),

					// Author name
					author: chapter.book.author,

					// Date published
					date: chapter.createdAt
				});
			}
		});

		// 4. Send the XML response
		res.set('Content-Type', 'text/xml');
		res.send(feed.xml());

	} catch (error) {
		console.error("RSS Feed Error:", error);
		res.status(500).send("Error generating feed");
	}
};

module.exports = { getRSSFeed };