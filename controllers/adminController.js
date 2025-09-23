const Book = require("../models/Book");
const Chapter = require("../models/Chapter");
const User = require("../models/User");
const { uploadImage, deleteImage } = require("../utils/s3")


// @description: Add a new book
// @route POST /api/v1/admin/books
// @access private (Admin)
const addBook = async (req, res) => {
	const { title, author, description, category, country, tags, status } = req.body;
	// Validate tags
	if (!tags) {
		return res.status(400).json({
			status: "fail",
			error: "tags is required"
		});
	}

	const tagsArr = tags.split(",").map(tag => tag.trim()); // Split tags and trim spaces

	if (!Array.isArray(tagsArr) || tagsArr.length === 0 || tagsArr[0].length === 0) {
		return res.status(400).json({
			status: "fail",
			error: "tags must be a non-empty array"
		});
	}

	try {
		// Check if the bookImage is provided
		if (!req.file) {
			return res.status(400).json({ status: "fail", error: "bookImage is required" });
		}

		// Upload thumbnail
		const bookImageUrl = await uploadImage(req?.file);

		const newBook = await Book.create({
			title,
			author,
			description,
			category,
			country,
			tags: tagsArr,
			status,
			bookImage: bookImageUrl,
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
	let { title, author, description, category, country, tags, status } = req.body;

	try {
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: "fail",
				error: "Book not found",
			});
		}

		// Convert tags string -> array only if tags was actually sent
		if (tags !== undefined) {
			try {
				tags = JSON.parse(tags); // comes as stringified array
			} catch {
				tags = Array.isArray(tags) ? tags : tags.split(",");
			}

			// clean up tags
			tags = tags.map(tag => tag.trim()).filter(Boolean);

			if (tags.length > 0) {
				book.tags = tags; // overwrite only if non-empty
			}
			// if empty, do nothing → keeps old tags
		}

		// Handle book image upload
		if (req.file) {
			if (book.bookImage) {
				await deleteImage(book.bookImage); // delete old one
			}
			const bookImageUrl = await uploadImage(req.file);
			book.bookImage = bookImageUrl;
		}

		// If neither req.file is provided, book.bookImage remains unchanged
		// Update the book fields
		book.title = title || book.title;
		book.author = author || book.author;
		book.description = description || book.description;
		book.category = category || book.category;
		book.country = country || book.country;
		book.status = status || book.status;

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

		// Delete book image from S3 if it exists
		if (book.bookImage) {
			await deleteImage(book.bookImage);
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
		// console.log("chapterCount", chapterCount);
		const newChapterNumber = chapterCount + 1;

		// Logic for locking
		let finalIsLocked;
		let lockedAt = null;

		if (newChapterNumber <= book.freeChapters) {
			// Chapters within freeChapters are always free
			finalIsLocked = false;
		} else {
			// Beyond freeChapters: lock by default, unless explicitly set to false
			finalIsLocked = isLocked !== undefined ? isLocked : true;
			lockedAt = finalIsLocked ? new Date() : null;
		}

		// Create the new chapter
		const newChapter = await Chapter.create({
			title,
			content,
			book: bookId,
			chapterNo: newChapterNumber, // Assign the new chapter number
			isLocked: finalIsLocked,
			lockedAt,
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

// @description: Get dashboard statistics
// @route GET /api/v1/admin/dashboard
// @access private (Admin)
const getDashboardStats = async (req, res) => {
	try {
		// Fetch counts concurrently for performance
		const [totalBooks, ongoingBooks, completedBooks, totalCustomers] = await Promise.all([
			Book.countDocuments(),
			Book.countDocuments({ status: 'ongoing' }),
			Book.countDocuments({ status: 'completed' }),
			User.countDocuments({ role: 'user' })
		]);

		res.status(200).json({
			status: "success",
			data: {
				totalBooks,
				ongoingBooks,
				completedBooks,
				totalCustomers
			}
		});
	} catch (error) {
		res.status(500).json({
			status: "fail",
			error: error.message
		});
	}
};

module.exports = { addBook, addChapter, updateBook, deleteBook, updateChapter, deleteChapter, getDashboardStats };
