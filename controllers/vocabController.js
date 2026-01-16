const Vocab = require("../models/Vocab");
const Book = require("../models/Book");
const mammoth = require("mammoth");
const fs = require("fs");

// @description: Import Vocab from .docx file
// @route POST /api/v1/vocab/import
// @access Private (Admin)
const importVocab = async (req, res) => {
	try {
		const { bookId } = req.body;

		if (!bookId) {
			return res.status(400).json({ status: "fail", error: "Book ID is required" });
		}

		// Find the book by its ID
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({
				status: "fail",
				error: "Book not found"
			});
		}

		if (!req.file) {
			return res.status(400).json({ status: "fail", error: "No file uploaded" });
		}


		console.log(`Processing file: ${req.file.originalname} for book: ${bookId}`);

		const result = await mammoth.extractRawText({ path: req.file.path });
		const rawText = result.value;

		// DEBUG LOG: See the first 200 chars to verify text extraction
		// console.log("DEBUG: Raw Text Preview:", rawText.substring(0, 200).replace(/\n/g, '\\n'));

		const lines = rawText.split(/\r?\n/);
		const vocabOps = [];
		// let addedCount = 0;
		let skippedCount = 0;

		const splitRegex = /\s+(?:translates\s+as|translated\s+as|as|=)\s+/i;

		for (const line of lines) {
			if (!line.trim()) continue;

			// DEBUG: Log the specific line being parsed
			// console.log("Processing Line:", line); 

			const parts = line.split(splitRegex);

			if (parts.length >= 2) {
				let rawOriginal = parts[0];

				// Strip prefixes or 1. or (1)
				rawOriginal = rawOriginal.replace(/^(\|\d+[\.\)]|\[\d+\])\s*/i, '');

				const original = rawOriginal.replace(/[<>“"”']/g, '').trim();
				const translation = parts[1].replace(/[<>“"”']/g, '').trim();

				// --- SAFETY CHECK ---
				// If Original is 1 char, but Translation is > 8 chars, it's likely a parser error.
				// We SKIP it to prevent database pollution.
				if (original.length === 1 && translation.length > 8) {
					console.warn(`SKIPPING SUSPICIOUS ENTRY: "${original}" -> "${translation}" (Ratio mismatch)`);
					skippedCount++;
					continue;
				}

				if (original && translation) {
					vocabOps.push({
						updateOne: {
							filter: { book: bookId, original: original },
							update: { $set: { translation: translation } }, // we use $set because we trust the user input to overwrite existing translations
							upsert: true
						}
					});
					// addedCount++;
				}
			}
		}

		// Execute Bulk Write
		let createdCount = 0;
		let updatedCount = 0;

		if (vocabOps.length > 0) {
			const bulkResult = await Vocab.bulkWrite(vocabOps);

			// MongoDB tells us exactly what happened
			createdCount = bulkResult.upsertedCount;
			updatedCount = bulkResult.matchedCount;
		}

		fs.unlinkSync(req.file.path);

		console.log(`Summary: Created ${createdCount}, Updated/Matched ${updatedCount}, Skipped ${skippedCount}`);

		res.status(200).json({
			status: "success",
			message: `Sync Complete. Created ${createdCount} new terms. Updated ${updatedCount} existing terms.`,
			stats: {
				created: createdCount,
				updated: updatedCount,
				skipped: skippedCount
			}
		});

	} catch (error) {
		console.error("Import Error:", error);
		if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); // Cleanup on error
		res.status(500).json({ status: "fail", error: error.message });
	}
};

module.exports = { importVocab };