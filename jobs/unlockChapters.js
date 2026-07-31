const cron = require("node-cron");
const Book = require("../models/Book");
const Chapter = require("../models/Chapter");

const isEnabled = process.env.ENABLE_CHAPTER_UNLOCK === "true";

if (!isEnabled) {
  console.log("⏸️  Chapter unlock job is DISABLED (via ENV)");
  return; // stop loading cron
}

console.log("⏰ Unlock job ENABLED! Running every minute to check scheduled times...\n");

// Runs every single minute
cron.schedule(
  "* * * * *",
  async () => {
    try {
      // 1. Safely extract exact New York time pieces without local timezone corruption
      const now = new Date();
      const opts = { timeZone: "America/New_York" };

      const year = new Intl.DateTimeFormat('en-US', { ...opts, year: 'numeric' }).format(now);
      const month = new Intl.DateTimeFormat('en-US', { ...opts, month: '2-digit' }).format(now);
      const day = new Intl.DateTimeFormat('en-US', { ...opts, day: '2-digit' }).format(now);
      let hour = new Intl.DateTimeFormat('en-US', { ...opts, hour: '2-digit', hour12: false }).format(now);
      const minute = new Intl.DateTimeFormat('en-US', { ...opts, minute: '2-digit' }).format(now);

      // Handle midnight format edge-case in some Node environments
      if (hour === '24') hour = '00';

      // ====================================================================
      // TIME VARIABLES
      // ====================================================================

      // For Task A: "11:15"
      const currentHHMM = `${hour}:${minute}`;
      // For Task A Safeguard: "2026-07-31"
      const todayNYString = `${year}-${month}-${day}`;
      // For Task B: Forces the NY clock face into strict UTC to bypass local machine offsets
      const nyClockFaceUTC = new Date(`${year}-${month}-${day}T${hour}:${minute}:00.000Z`);

      // ====================================================================
      // TASK A: THE BATCH UNLOCK (Book-Level Schedule)
      // ====================================================================

      // 2. Find books that are enabled AND scheduled for this exact minute
      const books = await Book.find({
        isAutoUnlockEnabled: true,
        autoUnlockTime: currentHHMM
      }).populate("chapters");

      if (books.length > 0) {
        console.log(`🔔 Found ${books.length} book(s) scheduled for batch unlock at ${currentHHMM}`);

        for (const book of books) {
          // Check safeguard: skip if unlocked today already to prevent double-firing
          if (
            book.lastUnlockedAt &&
            book.lastUnlockedAt.toISOString().split('T')[0] === todayNYString
          ) {
            console.log(`⏭️ Skipping "${book.title}" (already unlocked today)`);
            continue;
          }

          // Sort chapters by chapterNo
          const sortedChapters = [...book.chapters].sort((a, b) => a.chapterNo - b.chapterNo);

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
                releasedAt: nyClockFaceUTC, // <--- THIS triggers the "New Release" for RSS
                scheduledReleaseDate: null // Clear any specific schedule since it just unlocked
              })
            );

            await Promise.all(unlockPromises);

            book.lastUnlockedAt = nyClockFaceUTC;
            await book.save();

            const unlockedNumbers = chaptersToUnlock.map(ch => ch.chapterNo).join(", ");
            console.log(`✅ BATCH UNLOCKED: Chapter(s) [${unlockedNumbers}] of "${book.title}"`);
          } else {
            console.log(`📘 No locked chapters left for "${book.title}"`);
          }
        }
      }

      // ====================================================================
      // TASK B: THE SPECIFIC SCHEDULE (Chapter-Level Schedule)
      // ====================================================================

      // Find any locked chapter where the scheduled release date has arrived or passed
      const individuallyScheduledChapters = await Chapter.find({
        isLocked: true,
        scheduledReleaseDate: {
          $ne: null, // Must have a scheduled date
          $lte: nyClockFaceUTC // $lte = Less than or equal to current time
        },

      }).populate('book', 'title');

      if (individuallyScheduledChapters.length > 0) {
        // Extract the IDs for a fast bulk update
        const chapterIdsToUnlock = individuallyScheduledChapters.map(ch => ch._id);

        // Update all matching chapters at once for maximum performance
        await Chapter.updateMany(
          { _id: { $in: chapterIdsToUnlock } },
          {
            $set: {
              isLocked: false,
              releasedAt: nyClockFaceUTC, // <--- Triggers RSS
              scheduledReleaseDate: null // Clear the schedule to prevent re-querying
            }
          }
        );

        // Log the specific book and chapter details
        individuallyScheduledChapters.forEach(ch => {
          const bookTitle = ch.book ? ch.book.title : "Unknown Book";
          console.log(`\n🎯 SPECIFIC UNLOCK: Released Chapter ${ch.chapterNo} of "${bookTitle}"\n`);
        });
      }

    } catch (err) {
      console.error("❌ Error running unlock cron job:", err.message);
    }
  },
  {
    timezone: "America/New_York",
  }
);