const Like = require('../models/Like');
const Book = require('../models/Book');

// @description: Toggle like on a book (Like if not liked, Unlike if already liked)
// @route POST /api/v1/books/:bookId/toggle-like
// @access private
const toggleLike = async (req, res) => {
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

		// Check if the user has already liked the book
		const existingLike = await Like.findOne({ user: userId, book: bookId });

		if (existingLike) {
			// User has already liked the book, so remove the like
			await Like.deleteOne({ _id: existingLike._id });

			// Decrement the likeCount
			book.likeCount = Math.max(book.likeCount - 1, 0); // Ensure likeCount doesn't go below 0
			await book.save();

			return res.status(200).json({
				status: "success",
				message: "Book unliked successfully",
				likeCount: book.likeCount
			});
		} else {
			// User has not liked the book, so add a like
			const newLike = await Like.create({
				user: userId,
				book: bookId
			});

			// Increment the likeCount
			book.likeCount += 1;
			await book.save();

			return res.status(201).json({
				status: "success",
				message: "Book liked successfully",
				data: newLike,
				likeCount: book.likeCount
			});
		}
	} catch (error) {
		res.status(500).json({
			status: "fail",
			error: error.message
		});
	}
};

module.exports = { toggleLike };
