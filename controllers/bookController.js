// Import the Book model
const Book = require('../models/Book');
const Chapter = require('../models/Chapter');
const { calculateTimeAgo } = require("../utils/helpFunction")


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
			query.category = category;
		}

		// 5. Filter by Tags (All Specified Tags Must Match)
		if (tags) {
			// Split the comma-separated tags into an array and trim whitespace
			const tagsArray = tags.split(',').map(tag => tag.trim());
			query.tags = { $all: tagsArray };
		}

		// filter by status (Exact Match)
		if (status) {
			query.status = status;
		}

		// 7. Pagination Calculations
		const pageNumber = parseInt(page, 10) || 1; // Current page number
		const limitNumber = parseInt(limit, 10) || 10; // Number of books per page
		const skip = (pageNumber - 1) * limitNumber; // Number of books to skip
		console.log(query);
		// 8. Execute the Query with Filters, Sorting, and Pagination
		const booksPromise = Book.find(query)
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
			error: 'Server Error'
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
				select: 'title chapterNo', // Select specific fields from chapters
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


//  @description: Get details of a specific chapter by ID within a specific book
//  @route GET /api/v1/books/:bookId/chapters/:chapterId
//  @access public
const getChapterById = async (req, res) => {
	try {
		const { bookId, chapterId } = req.params;

		// Verify that the book exists
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: 'fail',
				message: 'Book not found'
			});
		}

		// Find the specific chapter within the book
		const chapter = await Chapter.findOne({ _id: chapterId, book: bookId });

		if (!chapter) {
			return res.status(404).json({
				status: 'fail',
				message: 'Chapter not found in the specified book'
			});
		}

		res.status(200).json({
			status: 'success',
			data: chapter
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
		// 1. Find books with at least one chapter, whether ongoing or completed
		const books = await Book.find({
			chapters: { $exists: true, $ne: [] }, // Ensure books have chapters
			status: { $in: ['ongoing', 'completed'] } // Filter for ongoing or completed books
		})
			.populate({
				path: 'chapters',
				options: { sort: { updatedAt: -1 }, limit: 1 } // Get only the latest chapter for each book
			})
			.sort({ 'chapters.updatedAt': -1 }) // Sort by the most recently updated chapter
			.limit(10); // Limit to 10 books

		// 2. Format the response with the latest chapter number and time ago
		const latestBooks = books.map(book => {
			const latestChapter = book.chapters[0]; // The latest chapter

			// Check if the book has a latest chapter before trying to access its properties
			if (!latestChapter) {
				return null; // Skip books with no chapters
			}

			const timeAgo = calculateTimeAgo(latestChapter.updatedAt); // Calculate how long ago the chapter was added

			return {
				bookId: book._id,
				title: book.title,
				author: book.author,
				category: book.category,
				status: book.status,
				latestChapter: {
					chapterNo: latestChapter.chapterNo,
					updatedAt: timeAgo, // Time ago (e.g., "2 days ago")
				},
			};
		}).filter(book => book !== null); // Filter out null values (books with no chapters)

		// 3. Send the response with the formatted data
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

module.exports = { searchBooks, getBookById, getChapterById, getNewBooks, getLatestUpdatedBooks };
