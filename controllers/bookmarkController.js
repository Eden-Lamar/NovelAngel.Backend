const Bookmark = require('../models/Bookmark');
const Book = require('../models/Book');

// @description: Toggle bookmark on a book (Bookmark if not bookmarked, Remove if already bookmarked)
// @route POST /api/v1/books/:bookId/toggle-bookmark
// @access private
const toggleBookmark = async (req, res) => {
	const { bookId } = req.params;
	const userId = req.user._id;

	try {
		// Check if the book exists
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: "fail",
				error: "Book not found"
			});
		}

		// Check if the user has already bookmarked the book
		const existingBookmark = await Bookmark.findOne({ user: userId, book: bookId });

		if (existingBookmark) {
			// User has already bookmarked the book, so remove the bookmark
			await Bookmark.deleteOne({ _id: existingBookmark._id });

			return res.status(200).json({
				status: "success",
				message: "Bookmark removed successfully"
			});
		} else {
			// User has not bookmarked the book, so add a bookmark
			const newBookmark = await Bookmark.create({
				user: userId,
				book: bookId
			});

			return res.status(201).json({
				status: "success",
				message: "Book bookmarked successfully",
				data: newBookmark
			});
		}
	} catch (error) {
		res.status(500).json({
			status: "fail",
			error: error.message
		});
	}
};

module.exports = { toggleBookmark };
