const cron = require("node-cron");
const Book = require("../models/Book.js");
const Chapter = require("../models/Chapter");

const isEnabled = process.env.ENABLE_CHAPTER_UNLOCK === "true";

if (!isEnabled) {
	console.log("⏸️ Chapter unlock job is DISABLED (via ENV)");
	return; // stop loading cron
}

console.log("⏰ Daily unlock job ENABLED!Running every minute to check scheduled times...\n");

// Run once a day at midnight (WAT – Africa/Lagos)
cron.schedule(
	"* * * * *",
	async () => {
		try {
			// 1. Get current time in Lagos (WAT) in HH:MM format
			const lagosDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
			const currentHour = String(lagosDate.getHours()).padStart(2, '0');
			const currentMinute = String(lagosDate.getMinutes()).padStart(2, '0');
			const currentHHMM = `${currentHour}:${currentMinute}`;

			// 2. Find books that are enabled AND scheduled for this exact minute
			const books = await Book.find({
				isAutoUnlockEnabled: true,
				autoUnlockTime: currentHHMM
			}).populate("chapters");

			// Silent return if no books match the current time to avoid console spam
			if (books.length === 0) return;

			console.log(`🔔 Found ${books.length} book(s) scheduled for unlock at ${currentHHMM}`);

			for (const book of books) {
				// Check safeguard: skip if unlocked today already to prevent double-firing
				if (
					book.lastUnlockedAt &&
					new Date(book.lastUnlockedAt).toDateString() === lagosDate.toDateString()
				) {
					console.log(`⏭️ Skipping "${book.title}" (already unlocked today)`);
					continue;
				}

				// Sort chapters by chapterNo
				const sortedChapters = [...book.chapters].sort(
					(a, b) => a.chapterNo - b.chapterNo
				);

				// Filter out all locked chapters beyond freeChapters
				const lockedChapters = sortedChapters.filter(
					(ch) => ch.isLocked && ch.chapterNo > book.freeChapters
				);

				// 3. Slice the exact number of chapters the admin requested (defaults to 1)
				const chaptersToUnlock = lockedChapters.slice(0, book.autoUnlockCount || 1);

				if (chaptersToUnlock.length > 0) {

					// 4. Unlock all selected chapters concurrently for performance
					const unlockPromises = chaptersToUnlock.map(ch =>
						Chapter.findByIdAndUpdate(ch._id, {
							isLocked: false,
							releasedAt: new Date() // <--- THIS triggers the "New Release" for RSS
						})
					);

					await Promise.all(unlockPromises);

					book.lastUnlockedAt = new Date();
					await book.save();

					const unlockedNumbers = chaptersToUnlock.map(ch => ch.chapterNo).join(", ");
					console.log(`✅ Unlocked Chapter(s) [${unlockedNumbers}] of "${book.title}"`);
				} else {
					console.log(`📘 No locked chapters left for "${book.title}"`);
				}
			}

			// console.log("🎉 Daily unlock job completed!");
		} catch (err) {
			console.error("❌ Error unlocking chapters:", err.message);
		}
	},
	{
		timezone: "Africa/Lagos",
	}
);