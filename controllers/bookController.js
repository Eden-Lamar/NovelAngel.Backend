// Import the Book model
const Book = require('../models/Book');
const Chapter = require('../models/Chapter');
const User = require('../models/User');
const Comment = require('../models/Comment');
const { calculateTimeAgo } = require("../utils/helpFunction")
const { getRecommendedBooks } = require("../utils/bookRecommendations")


// @description: Search and filter books based on query parameters
// @route GET /api/v1/books/search
// @access public

const searchBooks = async (req, res) => {
	try {
		// 1. Extract query parameters from the request
		const { keyword, category, tags, status, page = 1, limit = 10 } = req.query;

		// 2. Initialize the query object
		let query = {};

		// 3. Keyword Search on Title and Author
		if (keyword) {
			// Using MongoDB's $regex operator for case-insensitive search on title and author
			query.$or = [
				{ title: { $regex: keyword, $options: 'i' } }, // Case-insensitive search on title
				{ author: { $regex: keyword, $options: 'i' } } // Case-insensitive search on author
			];
		}

		// 4. Filter by Category (Exact Match)
		if (category) {
			const decodedCategory = decodeURIComponent(category.trim()).replace(/\+/g, " ").trim(); // convert + → space
			query.category = { $regex: `^${decodedCategory}$`, $options: 'i' };
		}

		// 5. Filter by Tags (All Specified Tags Must Match)
		if (tags) {
			// Split the comma-separated tags into an array and trim whitespace
			const tagsArray = tags.split(',').map(tag => tag.trim());
			query.tags = { $all: tagsArray.map(tag => new RegExp(`^${tag}$`, 'i')) };
		}

		// filter by status (Exact Match)
		if (status) {
			query.status = { $regex: `^${status}$`, $options: 'i' };
		}

		// 7. Pagination Calculations
		const pageNumber = parseInt(page, 10) || 1; // Current page number
		const limitNumber = parseInt(limit, 10) || 10; // Number of books per page
		const skip = (pageNumber - 1) * limitNumber; // Number of books to skip
		console.log(query);
		// 8. Execute the Query with Filters, Sorting, and Pagination
		const booksPromise = Book.find(query)
			.select('title author description category chapters bookImage tags status likeCount country views')
			.sort({ createdAt: -1 }) // Apply sorting
			.skip(skip) // Skip books for pagination
			.limit(limitNumber) // Limit the number of books returned

		// 9. Get the total count of books matching the query for pagination metadata
		const countPromise = Book.countDocuments(query);

		// Execute both promises in parallel
		const [books, total] = await Promise.all([booksPromise, countPromise]);

		// 10. Calculate total pages
		const totalPages = Math.ceil(total / limitNumber);

		// 11. Send the response
		res.status(200).json({
			status: 'success',
			results: books.length, // Number of books returned in this response
			data: books, // Array of book objects
			pagination: {
				total, // Total number of books matching the query
				currentPage: pageNumber, // Current page number
				totalPages // Total number of pages
			}
		});
	} catch (error) {
		res.status(500).json({
			status: 'fail',
			error: error.message || 'Server Error'
		});
	}
};


// @description: Get details of a specific book by ID
// @route GET /api/v1/books/:id
// @access public

const getBookById = async (req, res) => {
	try {
		const { id } = req.params;

		// Find the book by ID and populate the uploadedBy field with user details
		const book = await Book.findById(id)
			.populate({
				path: 'uploadedBy',
				select: 'username -_id'
			})
			.populate({
				path: 'chapters',
				select: 'title chapterNo isLocked createdAt coinCost', // Select specific fields from chapters
				options: { sort: { chapterNo: 1 } } // Optional: Sort chapters by chapter number in asce order
			});

		if (!book) {
			return res.status(404).json({
				status: 'fail',
				message: 'Book not found'
			});
		}

		res.status(200).json({
			status: 'success',
			data: book
		});
	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};


// @description: Get comments for a specific book
// @route GET /api/v1/books/:bookId/comments
// @access public
const getBookComments = async (req, res) => {
	try {
		const { bookId } = req.params;
		const page = parseInt(req.query.page, 10) || 1; // Default to page 1
		const limit = parseInt(req.query.limit, 10) || 10; // Default to 10 comments per page
		const skip = (page - 1) * limit;

		// Verify that the book exists
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: 'fail',
				message: 'Book not found',
			});
		}

		// Get the total count of comments for the book
		const totalComments = await Comment.countDocuments({ book: bookId });

		// Fetch the comments, sorted by newest first
		const comments = await Comment.find({ book: bookId })
			.sort({ createdAt: -1 }) // Sort by latest
			.skip(skip)
			.limit(limit)
			.populate('user', 'username avatar'); // Populate user info (assuming you have user references)

		res.status(200).json({
			status: 'success',
			results: comments.length,
			total: totalComments,
			page,
			totalPages: Math.ceil(totalComments / limit),
			data: comments,
		});
	} catch (error) {
		console.error('Error in getBookComments:', error);
		res.status(500).json({
			status: 'fail',
			message: 'Server Error',
		});
	}
};

// @description:  Get details of a specific book together with it's comments
// @route GET /api/v1/books/:id/comments/together
// @access public
const getBookWithComments = async (req, res) => {
	try {
		const { id } = req.params;
		const page = parseInt(req.query.page, 10) || 1;
		const limit = parseInt(req.query.limit, 10) || 10;
		const skip = (page - 1) * limit;

		const [book, comments, totalComments] = await Promise.all([
			Book.findById(id)
				.populate('uploadedBy', 'username -_id')
				.populate('chapters', 'title chapterNo'),
			Comment.find({ book: id })
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate('user', 'username avatar'),
			Comment.countDocuments({ book: id })
		]);

		if (!book) {
			return res.status(404).json({
				status: 'fail',
				message: 'Book not found'
			});
		}

		res.status(200).json({
			status: 'success',
			data: {
				book,
				comments: {
					results: comments.length,
					total: totalComments,
					page,
					totalPages: Math.ceil(totalComments / limit),
					data: comments
				}
			}
		});
	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};

//  @description: Get details of a specific chapter by ID within a specific book
//  @route GET /api/v1/books/:bookId/chapters/:chapterId
//  @access public (Optional)
const getChapterById = async (req, res) => {
	try {
		const { bookId, chapterId } = req.params;
		const userId = req.user ? req.user._id : null; // Only available for logged-in users

		// Verify that the book exists
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: 'fail',
				message: 'Book not found'
			});
		}

		// Find the specific chapter within the book
		const chapter = await Chapter.findById(chapterId).where({ book: bookId });

		if (!chapter) {
			return res.status(404).json({
				status: 'fail',
				message: 'Chapter not found in the specified book'
			});
		}

		let canAccess = !chapter.isLocked;
		let user = null; // Initialize user

		// If a user is logged in, check their role and unlocks
		if (userId) {
			// Fetch role, unlockedChapters, and readingHistory
			// We need all these fields for logic within this function.
			user = await User.findById(userId).select('unlockedChapters role readingHistory');

			if (user) {
				// 1.  Grant access if user is an 'admin'
				if (user.role === 'admin') {
					canAccess = true;
				}	// 2. Grant access if chapter is locked BUT user has unlocked it
				else if (chapter.isLocked && user.unlockedChapters.includes(chapter._id)) {
					canAccess = true;
				}

			}
		}

		// If the chapter is locked and the user cannot access it, return limited info
		if (!canAccess) {
			return res.status(200).json({
				status: 'locked',
				data: {
					bookTitle: book.title,
					chapter: {
						_id: chapter._id,
						title: chapter.title,
						chapterNo: chapter.chapterNo,
						createdAt: chapter.createdAt,
						isLocked: true,
						coinCost: chapter.coinCost,
						// Don’t send content since it’s locked
						content: null,
					},
				}
			});
		}

		// --- NEW VIEW TRACKING LOGIC ---

		// 1. Get the user's IP address (handles proxies/load balancers)
		let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

		// If multiple IPs are returned, grab the first one (the original client)
		if (clientIp && typeof clientIp === 'string' && clientIp.includes(',')) {
			clientIp = clientIp.split(',')[0].trim();
		}

		let isNewView = false;

		if (userId) {
			// Logic for logged-in users
			if (!book.viewedBy.includes(userId)) {
				book.viewedBy.push(userId);
				isNewView = true;
			}
		} else {
			// Logic for anonymous users
			if (!book.anonymousViewers.includes(clientIp)) {
				book.anonymousViewers.push(clientIp);
				isNewView = true;
			}
		}

		// Increment views and save only if it's a new unique view
		if (isNewView) {
			book.views += 1;
			await book.save();
		}

		// --- END VIEW TRACKING LOGIC ---

		// Track reading history for logged-in users
		if (user) {
			// Check if the BOOK is already in the user's reading history
			const existingBookIndex = user.readingHistory.findIndex(
				(history) => history.book.toString() === bookId.toString()
			);

			// If the book exists, remove the old entry so we can move it to the top
			if (existingBookIndex !== -1) {
				// Remove the chapter from its current position
				user.readingHistory.splice(existingBookIndex, 1);
			}

			// add a new entry for the book in reading history
			user.readingHistory.unshift({
				book: bookId,
				lastChapterRead: chapterId,
				createdAt: new Date() // Ensure timestamp is updated
			});

			// Limit the readingHistory to 10 items
			if (user.readingHistory.length > 10) {
				user.readingHistory.pop(); // Remove the last item (oldest)
			}

			await user.save(); // Save the updated user with new reading history
		}

		res.status(200).json({
			status: 'success',
			data: {
				bookTitle: book.title,
				chapter: {
					_id: chapter._id,
					title: chapter.title,
					chapterNo: chapter.chapterNo,
					createdAt: chapter.createdAt,
					isLocked: false, // Override for users who can access
					coinCost: chapter.coinCost,
					content: chapter.content,
				},
			},
		});

	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};


// @description: Unlock a locked chapter using coins
// @route POST /api/v1/books/:bookId/chapters/:chapterId/unlock
// @access private
const unlockChapter = async (req, res) => {
	try {
		const { bookId, chapterId } = req.params;
		const userId = req.user._id;

		// Find the chapter
		const chapter = await Chapter.findOne({ _id: chapterId, book: bookId });
		if (!chapter) {
			return res.status(404).json({
				status: 'fail',
				message: 'Chapter not found'
			});
		}

		// Check if chapter is locked
		if (!chapter.isLocked) {
			return res.status(400).json({
				status: 'fail',
				message: 'Chapter is already free'
			});
		}

		// Find the user
		// Also select the 'role' field
		const user = await User.findById(userId).select("coinBalance unlockedChapters role");
		if (!user) {
			return res.status(404).json({
				status: 'fail',
				message: 'User not found'
			});
		}

		// Add check to prevent admins from unlocking
		if (user.role === 'admin') {
			return res.status(403).json({
				status: 'fail',
				message: 'Admins do not need to unlock chapters, access is free'
			});
		}

		// Check if chapter is already unlocked
		if (user.unlockedChapters.some(id => id.equals(chapter._id))) {
			return res.status(400).json({
				status: 'fail',
				message: 'Chapter already unlocked'
			});
		}

		// Check if user has enough coins
		if (user.coinBalance < chapter.coinCost) {
			return res.status(400).json({
				status: 'fail',
				message: "Insufficient coins"
			});
		}

		// Deduct coins and unlock
		user.coinBalance -= chapter.coinCost;
		user.unlockedChapters.push(chapter._id);
		await user.save();

		res.status(200).json({
			status: 'success',
			message: 'Chapter unlocked successfully',
			remainingCoins: user.coinBalance
		});
	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};

// @description: Get the 10 newest books added to the platform
// @route GET /api/v1/books/new
// @access public

const getNewBooks = async (req, res) => {
	try {
		// 1. Fetch the 10 newest books, sorted by creation date in descending order
		const books = await Book.find()
			.sort({ createdAt: -1 }) // Sort by createdAt field in descending order
			.limit(10); // Limit to 10 books

		// 2. Send the response with the retrieved books
		res.status(200).json({
			status: 'success',
			results: books.length, // Number of books returned
			data: books, // Array of book objects
		});
	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};

// @description: Get latest updated books (with the most recent chapters added)
// @route GET /api/v1/books/latest-updates
// @access public
const getLatestUpdatedBooks = async (req, res) => {
	try {
		const books = await Book.aggregate([
			// Only include books with chapters and valid status
			{
				$match: {
					chapters: { $exists: true, $ne: [] },
					status: { $in: ['ongoing', 'completed'] }
				}
			},
			// Lookup chapters
			{
				$lookup: {
					from: 'chapters',
					localField: 'chapters',
					foreignField: '_id',
					as: 'chaptersData'
				}
			},
			// Unwind chapters for sorting
			{ $unwind: '$chaptersData' },
			// Sort by most recently updated chapter
			{ $sort: { 'chaptersData.createdAt': -1 } },
			// Group by book and take latest chapter
			{
				$group: {
					_id: '$_id',
					title: { $first: '$title' },
					bookImage: { $first: '$bookImage' },
					latestChapter: { $first: '$chaptersData' },
				}
			},
			// Ensure response itself is sorted newest-to-oldest
			{ $sort: { "latestChapter.createdAt": -1 } },
			// Limit results
			{ $limit: 20 },
		]);

		// Format response
		const latestBooks = books.map(book => {
			const latestChapter = book.latestChapter;
			const timeAgo = calculateTimeAgo(latestChapter.createdAt);

			return {
				bookId: book._id,
				title: book.title,
				bookImage: book.bookImage,
				latestChapter: {
					title: latestChapter.title,
					chapterNo: latestChapter.chapterNo,
					updatedAt: timeAgo,
				},
			};
		});

		res.status(200).json({
			status: 'success',
			result: latestBooks.length,
			data: latestBooks
		});

	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};


// @description: Get the top 10 trending books
// @route GET /api/v1/books/trending
// @access public
const getTrendingBooks = async (req, res) => {
	try {
		const now = new Date();

		const trendingBooks = await Book.aggregate([
			// Lookup chapters
			{
				$lookup: {
					from: 'chapters',
					localField: 'chapters',
					foreignField: '_id',
					as: 'chaptersData'
				}
			},
			// Compute fields safely
			{
				$addFields: {
					numericViews: { $ifNull: [{ $toInt: "$views" }, 0] },
					numericLikes: { $ifNull: [{ $toInt: "$likeCount" }, 0] },
					safeUpdatedAt: { $ifNull: ["$updatedAt", "$createdAt"] },
					daysSinceUpdate: {
						$divide: [
							{ $subtract: [now, { $ifNull: ["$updatedAt", "$createdAt"] }] },
							1000 * 60 * 60 * 24 // ms → days
						]
					}
				}
			},
			// Add decay-based score
			{
				$addFields: {
					decayFactor: { $exp: { $multiply: ["$daysSinceUpdate", -0.1] } },
					trendingScore: {
						$multiply: [
							{
								$add: [
									{ $multiply: ["$numericViews", 3] },  // Views weight
									{ $multiply: ["$numericLikes", 5] },  // Likes weight
									{ $multiply: [{ $size: "$chaptersData" }, 1] }  // Chapters weight
								]
							},
							{ $exp: { $multiply: ["$daysSinceUpdate", -0.1] } } // Decay over time
						]
					}
				}
			},
			{ $sort: { trendingScore: -1 } },
			{ $limit: 10 },
			{
				$project: {
					title: 1,
					description: 1,
					country: 1,
					category: 1,
					tags: 1,
					status: 1,
					bookImage: 1,
					views: "$numericViews",
					likeCount: "$numericLikes",
					chapterCount: { $size: "$chaptersData" },
					daysSinceUpdate: 1,
					trendingScore: 1,
					decayFactor: 1
				}
			}
		]);

		res.status(200).json({
			status: 'success',
			results: trendingBooks.length,
			data: trendingBooks
		});
	} catch (error) {
		console.error('Error in getTrendingBooks:', error);
		res.status(500).json({
			status: 'fail',
			message: 'Server Error'
		});
	}
};

// @description: Get random book recommendations
// @route GET /api/v1/books/recommendations
// @access public (Optional)
const getBookRecommendations = async (req, res) => {
	try {
		const userId = req.user ? req.user.id : null; // Only available for logged-in users

		const recommendedBooks = await getRecommendedBooks(userId);


		res.status(200).json({
			status: 'success',
			results: recommendedBooks.length,
			data: recommendedBooks
		});
	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};

// @description: Get all books with pagination
// @route GET /api/v1/books
// @access public
const getAllBooks = async (req, res) => {
	try {
		const { page = 1, limit = 6, autoUnlock } = req.query;// Extract autoUnlock
		const pageNumber = parseInt(page, 10) || 1;
		const limitNumber = parseInt(limit, 10) || 6;
		const skip = (pageNumber - 1) * limitNumber;

		// 1. Initialize query object
		let query = {};

		// 2. Add filter if autoUnlock is explicitly requested
		if (autoUnlock === 'true') {
			query.isAutoUnlockEnabled = true;
		}

		const booksPromise = Book.find(query)
			.sort({ createdAt: -1 }) // Sort by creation date descending so that mean the newest books appear first
			.skip(skip)
			.limit(limitNumber)
			.select('title description bookImage status chapters views likeCount country tags');
		const countPromise = Book.countDocuments();

		// Execute both promises in parallel to improve performance that means we are fetching the books and counting the total number of books at the same time
		const [books, total] = await Promise.all([booksPromise, countPromise]);
		const totalPages = Math.ceil(total / limitNumber);

		res.status(200).json({
			status: 'success',
			results: books.length,
			data: books,
			pagination: {
				total,
				currentPage: pageNumber,
				totalPages
			}
		});
	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};

// @description: Toggle the daily auto-unlock feature for a specific book
// @route PATCH /api/v1/books/:id/toggle-auto-unlock
// @access private (Admin only)
const toggleAutoUnlock = async (req, res) => {
	try {
		const { id } = req.params;

		// 1. Security Check: Ensure only admins can toggle this
		if (!req.user || req.user.role !== 'admin') {
			return res.status(403).json({
				status: 'fail',
				message: 'Not authorized. Only admins can toggle daily unlocks.'
			});
		}

		// 2. Find the book
		const book = await Book.findById(id);
		if (!book) {
			return res.status(404).json({
				status: 'fail',
				message: 'Book not found'
			});
		}

		// 3. Toggle the boolean flag
		book.isAutoUnlockEnabled = !book.isAutoUnlockEnabled;
		await book.save();

		// 4. Send response
		res.status(200).json({
			status: 'success',
			message: `Auto-unlock is now ${book.isAutoUnlockEnabled ? 'ENABLED' : 'DISABLED'} for "${book.title}"`,
			data: {
				isAutoUnlockEnabled: book.isAutoUnlockEnabled
			}
		});
	} catch (error) {
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};

module.exports = { searchBooks, getBookById, getChapterById, unlockChapter, getNewBooks, getLatestUpdatedBooks, getTrendingBooks, getBookRecommendations, getBookComments, getBookWithComments, getAllBooks, toggleAutoUnlock };
