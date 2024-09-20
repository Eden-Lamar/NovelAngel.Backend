const Comment = require('../models/Comment');
const Book = require('../models/Book');

// @description: Add a comment to a book
// @route POST /api/v1/books/:bookId/comments
// @access private
const addComment = async (req, res) => {
	const { bookId } = req.params;
	const { text } = req.body;
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

		// Create a new comment
		const newComment = await Comment.create({
			user: userId,
			book: bookId,
			text
		});

		res.status(201).json({
			status: "success",
			data: newComment
		});
	} catch (error) {
		res.status(500).json({
			status: "fail",
			error: error.message
		});
	}
};

// @description: Delete a comment
// @route DELETE /api/v1/comments/:commentId
// @access private
const deleteComment = async (req, res) => {
	const { commentId } = req.params;
	const userId = req.user._id;

	try {
		const comment = await Comment.findById(commentId);
		if (!comment) {
			return res.status(404).json({
				status: "fail",
				error: "Comment not found"
			});
		}

		// Ensure that only the user who created the comment can delete it
		if (comment.user.toString() !== userId.toString()) {
			return res.status(403).json({
				status: "fail",
				error: "Unauthorized to delete this comment"
			});
		}

		// Delete the comment
		await Comment.deleteOne({ _id: commentId });

		res.status(200).json({
			status: "success",
			message: "Comment deleted successfully"
		});
	} catch (error) {
		res.status(500).json({
			status: "fail",
			error: error.message
		});
	}
};

module.exports = { addComment, deleteComment };
