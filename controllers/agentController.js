const Book = require("../models/Book");
const Chapter = require("../models/Chapter");
const Vocab = require("../models/Vocab");
const { scrapeChapter } = require("../services/scraper.service");
const { translateChapter } = require("../services/translation.service");

// @description: Auto-translate and publish a single chapter
// @route POST /api/v1/agent/single
// @access Private (Admin)
const autoTranslateChapter = async (req, res) => {
	const { bookId, sourceUrl, coinCost, isLocked } = req.body;

	try {
		// 1. Validation
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({ status: "fail", error: "Book not found" });
		}

		console.log(`Step 1: Scraping ${sourceUrl}...`);
		// 2. Scrape the Chinese Text (Using our Stealth Puppeteer service)
		const { title: chineseTitle, content: chineseContent } = await scrapeChapter(sourceUrl);

		console.log(`Step 2: Translating "${chineseTitle}"...`);
		// 3. Translate using Gemini (Injects DB Vocab automatically)
		const { translatedTitle, translatedContent, newVocabItems } = await translateChapter(
			chineseTitle,
			chineseContent,
			bookId,
			book.title
		);

		// 4. Update Vocabulary (The "Learning" Phase)
		let trueNewVocabCount = 0; // Variable to track actual new Vocab words

		// We loop through any new vocab the AI found and save/update it in MongoDB
		if (newVocabItems && newVocabItems.length > 0) {
			console.log(`Step 3: Saving ${newVocabItems.length} new vocab items...`);
			const vocabOperations = newVocabItems.map(item => ({
				updateOne: {
					filter: { book: bookId, original: item.original },
					update: { $set: { translation: item.translation } },
					upsert: true // Create if it doesn't exist, update if it does
				}
			}));

			// Execute Bulk Write
			const bulkResult = await Vocab.bulkWrite(vocabOperations);

			// MongoDB tells us exactly how many were "Upserted" (Created New)
			trueNewVocabCount = bulkResult.upsertedCount;
			console.log(`- Updated: ${bulkResult.modifiedCount}`);
			console.log(`- Created: ${trueNewVocabCount}`);
		}

		// 5. Determine Chapter Number
		// We assume this is the NEXT chapter. 
		const currentCount = await Chapter.countDocuments({ book: bookId });
		const nextChapterNo = currentCount + 1;

		// 6. Logic for Locking (Same as your manual addChapter)
		let finalIsLocked = isLocked !== undefined ? isLocked : true;

		// If it's within the free range, force unlock
		if (nextChapterNo <= book.freeChapters) {
			finalIsLocked = false;
		}
		const finalCoinCost = finalIsLocked ? (coinCost || 10) : 0;
		const lockedAt = finalIsLocked ? new Date() : null;

		// 7. Create the Chapter in Database
		const newChapter = await Chapter.create({
			title: translatedTitle, // Or just the English title if we translated it separately
			content: translatedContent,
			book: bookId,
			chapterNo: nextChapterNo,
			isLocked: finalIsLocked,
			coinCost: finalCoinCost,
			lockedAt,
			uploadedBy: req.user._id
		});

		// 8. Link to Book
		book.chapters.push(newChapter._id);
		await book.save();

		console.log("Success: Chapter published.");

		res.status(200).json({
			status: "success",
			message: "Chapter translated and published successfully",
			data: {
				chapter: newChapter,
				vocabAdded: trueNewVocabCount
			}
		});

	} catch (error) {
		console.error("Agent Error:", error.message);
		res.status(500).json({
			status: "fail",
			error: error.message
		});
	}
};

// @description: Bulk translate chapters in a loop
// @route POST /api/v1/agent/bulk
// @access Private (Admin)
const bulkTranslateChapters = async (req, res) => {
	// We accept a starting URL and a limit (e.g., do 5 chapters then stop)
	let { bookId, startUrl, limit, coinCost, isLocked } = req.body;

	// Default limit to 1 if not specified, max 50 to prevent crashes
	limit = limit || 1;
	if (limit > 50) limit = 50;

	let currentUrl = startUrl;
	let successCount = 0;
	let totalNewVocabLearned = 0; // <--- Track total new words across all chapters
	let logs = [];

	try {
		const book = await Book.findById(bookId);
		if (!book) return res.status(404).json({ error: "Book not found" });

		// Send immediate response so the browser doesn't timeout
		// We will process in the background (Conceptually. For now, we await to keep it simple).
		// NOTE: For true background processing, we'd need a Job Queue (BullMQ).
		// For now, we will just keep the connection open (Long Polling).

		// START THE LOOP
		for (let i = 0; i < limit; i++) {
			if (!currentUrl) {
				logs.push(`Stopped: No 'Next Chapter' URL found after ${i} chapters.`);
				break;
			}

			console.log(`[${i + 1}/${limit}] Processing: ${currentUrl}`);

			// A. Scrape (Now returns nextUrl!)
			const { title: chineseTitle, content: chineseContent, nextUrl } = await scrapeChapter(currentUrl);

			// B. Translate
			const { translatedTitle, translatedContent, newVocabItems } = await translateChapter(
				chineseTitle,
				chineseContent,
				bookId,
				book.title
			);

			// C. Save Vocab
			let chapterNewVocabCount = 0;

			if (newVocabItems.length > 0) {
				const vocabOps = newVocabItems.map(item => ({
					updateOne: {
						filter: { book: bookId, original: item.original },
						update: { $set: { translation: item.translation } },
						upsert: true
					}
				}));

				const bulkResult = await Vocab.bulkWrite(vocabOps);

				// Capture exactly how many were created new
				chapterNewVocabCount = bulkResult.upsertedCount;
				totalNewVocabLearned += chapterNewVocabCount;
			}

			// D. Save Chapter
			const currentCount = await Chapter.countDocuments({ book: bookId });
			const nextChapterNo = currentCount + 1;

			// Logic: First X chapters free
			let finalIsLocked = isLocked !== undefined ? isLocked : true;
			if (nextChapterNo <= book.freeChapters) finalIsLocked = false;

			const newChapter = await Chapter.create({
				title: translatedTitle,
				content: translatedContent,
				book: bookId,
				chapterNo: nextChapterNo,
				isLocked: finalIsLocked,
				coinCost: finalIsLocked ? (coinCost || 10) : 0,
				lockedAt: finalIsLocked ? new Date() : null,
				uploadedBy: req.user._id
			});

			// --- FIX: Link Chapter to Book ---
			// We use findByIdAndUpdate to atomically push the ID to the array
			await Book.findByIdAndUpdate(bookId, {
				$push: { chapters: newChapter._id }
			});

			logs.push(`Success: Chapter ${nextChapterNo} saved. (Learned ${chapterNewVocabCount} new words)`);
			successCount++;

			// E. Update URL for next loop
			currentUrl = nextUrl;

			// F. DELAY (Crucial for Cloudflare & Gemini limits)
			// Wait 10 seconds between chapters
			if (i < limit - 1) {
				console.log("Waiting 10s cooldown...");
				await new Promise(resolve => setTimeout(resolve, 10000));
			}
		}

		// Final Report
		res.status(200).json({
			status: "success",
			processed: successCount,
			totalNewVocab: totalNewVocabLearned,
			logs: logs
		});

	} catch (error) {
		console.error("Bulk Error:", error);
		// Return partial logs so you know where it failed
		res.status(500).json({
			status: "fail",
			error: error.message,
			processed: successCount,
			logs
		});
	}
};

module.exports = { autoTranslateChapter, bulkTranslateChapters };