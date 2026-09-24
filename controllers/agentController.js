const { setMaxListeners } = require('events');
const Book = require("../models/Book");
const Chapter = require("../models/Chapter");
const Vocab = require("../models/Vocab");
const { translateChapter, clearVocabCache, resetModelQuotaState } = require("../services/translation.service");


// --- NEW: Global Map to track running translations ---
const activeTranslations = new Map();

// --- NEW: Helper to convert Quill HTML back to plain text with newlines ---
const convertHtmlToPlainText = (html) => {
	if (!html) return "";
	return html
		.replace(/<p><br><\/p>/gi, '\n') // Convert Quill's empty line breaks
		.replace(/<\/p>/gi, '\n')       // Convert end of paragraphs to newlines
		.replace(/<br\s*\/?>/gi, '\n')  // Convert standard BR tags
		.replace(/<[^>]+>/g, '')        // Strip all remaining HTML tags (like <p>, <strong>)
		.replace(/&nbsp;/g, ' ')        // Decode HTML spaces
		.replace(/\n\s*\n/g, '\n\n')    // Normalize multiple newlines into standard double-spacing
		.trim();
};


// @description: Translate raw text and return for admin preview
// @route POST /api/v1/agent/preview
// @access Private (Admin)
const previewTranslation = async (req, res) => {
	const { bookId, rawTitle, rawContent } = req.body;

	if (!bookId || !rawTitle || !rawContent) {
		return res.status(400).json({ status: "fail", error: "Book ID, title, and content are required." });
	}

	// 1. Create a unique session key for this specific user and book
	const sessionKey = `${req.user._id}-${bookId}`;

	// 2. Create the AbortController and store it in our global Map
	const serverAbortController = new AbortController();

	// NEW: Raise the listener limit to handle our massive parallel Promise.all() arrays
	setMaxListeners(50, serverAbortController.signal);

	activeTranslations.set(sessionKey, serverAbortController);

	try {

		const book = await Book.findById(bookId).select('title');
		if (!book) {
			return res.status(404).json({ status: "fail", error: "Book not found." });
		}

		// Use your existing translation service!
		// Strip the HTML out of the Quill editor payload before passing to the AI
		const cleanPlainTextContent = convertHtmlToPlainText(rawContent);

		// Use your existing translation service!
		const { translatedTitle, translatedContent, newVocabItems, qualityScore, scoreReasons, missedTermsData } = await translateChapter(
			rawTitle,
			cleanPlainTextContent, // <--- Pass the cleaned text!
			bookId,
			book.title,
			(type, msg) => console.log(`[Translate Preview] ${type}: ${msg}`),
			serverAbortController.signal
		);

		// Optionally clear cache/quota state after a successful run
		resetModelQuotaState();

		res.status(200).json({
			status: "success",
			data: {
				translatedTitle,
				translatedContent,
				newVocabItems,
				qualityScore,
				scoreReasons,
				missedTermsData
			}
		});

	} catch (error) {
		// 4. Safely ignore the error if it was caused by our intentional abort
		if (error.name === 'AbortError' || error.constructor.name === 'APIUserAbortError' || /aborted/i.test(error.message)) {
			return console.log("[Translate Preview] info: Translation successfully aborted. Credits saved.");
		}

		console.error("Translation Preview Error:", error);
		res.status(500).json({ status: "fail", error: error.message });
	} finally {
		// 4. ALWAYS clean up the Map when the translation finishes (success or fail)
		activeTranslations.delete(sessionKey);
	}
};

// @description: Abort an ongoing translation preview
// @route POST /api/v1/agent/abort
// @access Private (Admin)
const abortTranslation = (req, res) => {
	const { bookId } = req.body;
	const sessionKey = `${req.user._id}-${bookId}`;

	if (activeTranslations.has(sessionKey)) {
		console.log(`[Translate Preview] warning: Kill switch activated by admin. Halting execution...`);
		activeTranslations.get(sessionKey).abort(); // This fires the AbortError instantly
		activeTranslations.delete(sessionKey);
		return res.status(200).json({ status: "success", message: "Translation aborted." });
	}

	res.status(200).json({ status: "success", message: "No active translation found to abort." });
};

// @description: Save the finalized chapter to the database
// @route POST /api/v1/agent/publish
// @access Private (Admin)
const publishChapter = async (req, res) => {
	try {
		const { bookId, title, content, coinCost, isLocked, newVocabItems } = req.body;

		// 1. Save any new vocabulary discovered during preview
		if (newVocabItems && newVocabItems.length > 0) {
			const vocabOps = newVocabItems.map(item => ({
				updateOne: {
					filter: { book: bookId, original: item.original },
					update: { $setOnInsert: { translation: item.translation } },
					upsert: true
				}
			}));
			const bulkResult = await Vocab.bulkWrite(vocabOps);
			if (bulkResult.upsertedCount > 0) clearVocabCache(bookId);
		}

		// 2. Automatically determine the next chapter number
		const lastChapter = await Chapter.findOne({ book: bookId }).sort({ chapterNo: -1 });
		const nextChapterNo = lastChapter ? lastChapter.chapterNo + 1 : 1;

		// 3. Determine Lock Status based on Free Chapters allocation
		let finalIsLocked = isLocked !== undefined ? isLocked : true;
		const bookDoc = await Book.findById(bookId).select('freeChapters');
		if (nextChapterNo <= bookDoc.freeChapters) finalIsLocked = false;

		// 4. Create the Chapter
		const newChapter = await Chapter.create({
			title,
			content,
			book: bookId,
			chapterNo: nextChapterNo,
			isLocked: finalIsLocked,
			coinCost: finalIsLocked ? (coinCost || 10) : 0,
			lockedAt: finalIsLocked ? new Date() : null,
			uploadedBy: req.user._id,
			status: 'published' // It's human-approved now!
		});

		// 5. Link to Book
		await Book.findByIdAndUpdate(bookId, {
			$addToSet: { chapters: newChapter._id }
		});

		res.status(201).json({
			status: "success",
			message: `Chapter ${nextChapterNo} published successfully!`,
			chapter: newChapter
		});

	} catch (error) {
		console.error("Publish Chapter Error:", error);
		res.status(500).json({ status: "fail", error: error.message });
	}
};

module.exports = { previewTranslation, publishChapter, abortTranslation };