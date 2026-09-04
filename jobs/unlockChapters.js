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

      // For Task A Safeguard: "2026-07-31"
      const todayNYString = `${year}-${month}-${day}`;
      // For Task B: Forces the NY clock face into strict UTC to bypass local machine offsets
      const nyClockFaceUTC = new Date(`${year}-${month}-${day}T${hour}:${minute}:00.000Z`);

      // Start of today in the same "NY wall-clock labeled as UTC" style
      // Used for the atomic claim boundary
      const startOfTodayNYAsUTC = new Date(`${todayNYString}T00:00:00.000Z`);

      // ====================================================================
      // TASK A: THE BATCH UNLOCK (Book-Level Schedule)
      // ====================================================================

      // 2. Find ALL books that have daily auto-unlock enabled
      const books = await Book.find({
        isAutoUnlockEnabled: true
      }).populate("chapters");

      // Calculate current total minutes since midnight New York time
      const currentTotalMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);

      if (books.length > 0) {
        for (const book of books) {
          try {
            // Convert the book's specific unlock time to total minutes
            const [bookHour, bookMin] = (book.autoUnlockTime || "00:00").split(':').map(Number);
            const bookTotalMinutes = bookHour * 60 + bookMin;

            // 3. Has the scheduled time arrived or passed for today?
            if (currentTotalMinutes < bookTotalMinutes) continue;

            // ATOMIC: only proceeds if lastUnlockedAt is NOT already today.
            // This is the actual lock — whichever tick gets here first wins.
            const claimed = await Book.findOneAndUpdate(
              {
                _id: book._id,
                $or: [
                  { lastUnlockedAt: null },
                  { lastUnlockedAt: { $lt: new Date(`${todayNYString}T00:00:00.000Z`) } }
                ]
              },
              { $set: { lastUnlockedAt: nyClockFaceUTC } },
              { new: true }
            );

            if (!claimed) continue; // another tick already claimed it today

            // Now, and only now, unlock chapters — this book is "ours" for today
            const sortedChapters = [...book.chapters].sort((a, b) => a.chapterNo - b.chapterNo);
            const lockedChapters = sortedChapters.filter(ch => ch.isLocked && ch.chapterNo > book.freeChapters);
            const chaptersToUnlock = lockedChapters.slice(0, book.autoUnlockCount || 1);

            if (chaptersToUnlock.length > 0) {
              const unlockPromises = chaptersToUnlock.map((ch) =>
                Chapter.findByIdAndUpdate(ch._id, {
                  isLocked: false,
                  releasedAt: nyClockFaceUTC,
                  scheduledReleaseDate: null,
                })
              );

              await Promise.all(unlockPromises);

              const unlockedNumbers = chaptersToUnlock
                .map((ch) => ch.chapterNo)
                .join(", ");
              console.log(
                `✅ BATCH UNLOCKED: Chapter(s) [${unlockedNumbers}] of "${book.title}"`
              );
            } else {
              // We claimed the slot but there were no locked chapters left
              console.log(
                `ℹ️  Claimed today's unlock for "${book.title}" but no locked chapters remaining`
              );
            }
          } catch (bookErr) {
            // Isolate failures so one bad book doesn't kill the whole tick
            console.error(
              `❌ Error processing book "${book.title || book._id}":`,
              bookErr.message
            );
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