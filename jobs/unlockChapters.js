const cron = require("node-cron");
const Book = require("../models/Book.js");
const Chapter = require("../models/Chapter");

const isEnabled = process.env.ENABLE_CHAPTER_UNLOCK === "true";

if (!isEnabled) {
	console.log("⏸️  Chapter unlock job is DISABLED (via ENV)");
	return; // stop loading cron
}

console.log("⏰ Daily unlock job ENABLED! Will unlock one chapter per book every day at midnight (Africa/Lagos)\n");

// Run once a day at midnight (WAT – Africa/Lagos)
cron.schedule("0 0 * * *", async () => {
	try {
		console.log("🔔 Running daily chapter unlock job...");

		// Get all books
		const books = await Book.find().populate("chapters");

		for (const book of books) {
			// Check safeguard: skip if unlocked today already
			if (
				book.lastUnlockedAt &&
				new Date(book.lastUnlockedAt).toDateString() === new Date().toDateString()
			) {
				console.log(`⏭️ Skipping "${book.title}" (already unlocked today)`);
				continue;
			}

			// Sort chapters by chapterNo
			const sortedChapters = [...book.chapters].sort(
				(a, b) => a.chapterNo - b.chapterNo
			);

			// Find the first locked chapter after the free chapters
			const chapterToUnlock = sortedChapters.find(
				(ch) => ch.isLocked && ch.chapterNo > book.freeChapters
			);

			if (chapterToUnlock) {
				await Chapter.findByIdAndUpdate(chapterToUnlock._id, {
					isLocked: false,
				});

				// Update safeguard timestamp
				book.lastUnlockedAt = new Date();
				await book.save();

				console.log(
					`✅ Unlocked Chapter ${chapterToUnlock.chapterNo} of "${book.title}"`
				);
			} else {
				console.log(`📘 No locked chapters left for "${book.title}"`);
			}
		}

		console.log("🎉 Daily unlock job completed!");
	} catch (err) {
		console.error("❌ Error unlocking chapters:", err.message);
	}
},

	{
		timezone: "Africa/Lagos",
	}

);
