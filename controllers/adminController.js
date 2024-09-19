const Book = require("../models/Book");
const Chapter = require("../models/Chapter");

// @description: Add a new book
// @route POST /api/v1/admin/books
// @access private (Admin)
const addBook = async (req, res) => {
	const { title, author, description, category, tags, status } = req.body;

	try {
		let tagsArray = [];
		if (tags && Array.isArray(tags) && tags.length > 0) {
			tagsArray = tags; // Use provided tags if they are in the correct format
		} else {
			return res.status(400).json({
				status: "fail",
				error: "tags can not be empty"
			})
		}

		const newBook = await Book.create({
			title,
			author,
			description,
			category,
			tags: tagsArray,
			status,
			uploadedBy: req.user._id,
		});


		res.status(201).json({
			status: "success",
			data: newBook
		});
	} catch (error) {
		res.status(400).json({
			status: "fail",
			error: error.message
		});
	}
};


// @description: Update a Book
// @route PUT /api/v1/admin/books/:bookId
// @access private (Admin)
const updateBook = async (req, res) => {
	const { bookId } = req.params;
	const { title, author, description, category, tags, status } = req.body;

	try {
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: "fail",
				error: "Book not found",
			});
		}

		// Update the book fields
		book.title = title || book.title;
		book.author = author || book.author;
		book.description = description || book.description;
		book.category = category || book.category;
		book.status = status || book.status;

		// If new tags are provided, update the tags field
		if (tags && Array.isArray(tags)) {
			// Ensure tags are added individually to avoid nested arrays
			book.tags = [];
			book.tags = book.tags.concat(tags);
		}

		const updatedBook = await book.save();

		res.status(200).json({
			status: "success",
			data: updatedBook,
		});
	} catch (error) {
		res.status(400).json({
			status: "fail",
			error: error.message,
		});
	}
};


// @description: Delete a book
// @route DELETE /api/v1/admin/books/:bookId
// @access private (Admin)
const deleteBook = async (req, res) => {
	const { bookId } = req.params;

	try {
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: "fail",
				error: "Book not found",
			});
		}

		// Delete associated chapters
		await Chapter.deleteMany({ book: bookId });

		// Delete the book
		await Book.deleteOne({ _id: bookId });

		res.status(200).json({
			status: "success",
			message: "Book and associated chapters deleted",
		});
	} catch (error) {
		res.status(500).json({
			status: "fail",
			error: error.message,
		});
	}
};


// @description: Add new chapter
// @route POST /api/v1/admin/books/:bookId/chapters
// @access private (Admin)
const addChapter = async (req, res) => {
	const { title, content, isLocked } = req.body;
	const { bookId } = req.params;

	try {
		// Find the book by its ID
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: "fail",
				error: "Book not found"
			});
		}

		// Determine the next chapter number based on the current chapters
		const chapterCount = await Chapter.countDocuments({ book: bookId });
		console.log("chapterCount", chapterCount);
		const newChapterNumber = chapterCount + 1;

		// Create the new chapter
		const newChapter = await Chapter.create({
			title,
			content,
			book: bookId,
			chapterNo: newChapterNumber, // Assign the new chapter number
			isLocked,
			uploadedBy: req.user._id
		});

		// Add the chapter to the book's chapters array
		book.chapters.push(newChapter._id);
		await book.save();

		res.status(201).json({
			status: "success",
			data: newChapter
		});
	} catch (error) {
		res.status(400).json({ status: "fail", error: error.message });
	}
};

// @description: Update a chapter
// @route PUT /api/v1/admin/chapters/:chapterId
// @access private (Admin)
// Update Chapter
const updateChapter = async (req, res) => {
	const { chapterId } = req.params;
	const { title, content, isLocked } = req.body;

	try {
		const chapter = await Chapter.findById(chapterId);
		if (!chapter) {
			return res.status(404).json({
				status: "fail",
				error: "Chapter not found",
			});
		}

		// Update the chapter fields
		chapter.title = title || chapter.title;
		chapter.content = content || chapter.content;
		chapter.isLocked = isLocked !== undefined ? isLocked : chapter.isLocked;

		const updatedChapter = await chapter.save();

		res.status(200).json({
			status: "success",
			data: updatedChapter,
		});
	} catch (error) {
		res.status(400).json({
			status: "fail",
			error: error.message,
		});
	}
};

// @description: Delete a chapter
// @route DELETE /api/v1/admin/books/:bookId/chapters/:chapterId
// @access private (Admin)
// Delete Chapter
const deleteChapter = async (req, res) => {
	const { chapterId, bookId } = req.params;

	try {
		const chapter = await Chapter.findById(chapterId);
		if (!chapter) {
			return res.status(404).json({
				status: "fail",
				error: "Chapter not found",
			});
		}

		// Remove chapter from book's chapters array
		await Book.findByIdAndUpdate(bookId, {
			$pull: { chapters: chapterId },
		});

		// Delete the chapter
		await Chapter.deleteOne({ _id: chapterId })

		res.status(200).json({
			status: "success",
			message: "Chapter deleted successfully",
		});
	} catch (error) {
		res.status(500).json({
			status: "fail",
			error: error.message,
		});
	}
};

module.exports = { addBook, addChapter, updateBook, deleteBook, updateChapter, deleteChapter };
