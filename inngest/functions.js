const { inngest } = require("./client");
const Book = require("../models/Book");
const Chapter = require("../models/Chapter");
const Vocab = require("../models/Vocab");
const Mission = require("../models/Mission");
const { scrapeChapter } = require("../services/scraper.service");
const { translateChapter, clearVocabCache, resetModelQuotaState } = require("../services/translation.service");

// @description: Fire & Forget Bulk Translation Trigger
// This function will be triggered by the API route and will run in the background without blocking the main thread.
// It processes multiple chapters in a loop, updating the mission status in the database as it goes.
const bulkTranslateProcess = inngest.createFunction(
  { id: "bulk-translate-chapters", name: "Bulk Translate Chapters" },
  { event: "agent/translate.bulk" },
  async ({ event, step }) => {
    const { missionId, bookId, startUrl, limit, coinCost, isLocked, userId } = event.data;

    let currentUrl = startUrl;
    let successCount = 0;
    let failedCount = 0;
    let vocabChanged = false;

    // 1. Get the starting chapter number safely
    const lastChapter = await step.run("get-last-chapter", async () => {
      return await Chapter.findOne({ book: bookId }).sort({ chapterNo: -1 });
    });

    let currentChapterNo = lastChapter ? lastChapter.chapterNo + 1 : 1;

    // 2. The Main Processing Loop
    for (let i = 0; i < limit; i++) {
      if (!currentUrl) {
        console.warn("Chain stopped: No 'Next Chapter' URL found.");
        break;
      }

      // Update Mission to show active processing
      await step.run(`update-mission-active-${i}`, async () => {
        await Mission.findByIdAndUpdate(missionId, {
          active: 1,
          pending: limit - i - 1
        });
      });

      let nextUrlToProcess = null;

      try {
        // A. Scrape the Chapter
        const { title: chineseTitle, content: chineseContent, nextUrl } = await step.run(`scrape-chapter-${i}`, async () => {
          return await scrapeChapter(currentUrl);
        });

        // Save the next URL immediately so we don't lose the chain if translation fails
        nextUrlToProcess = nextUrl;

        // B. Translate the Chapter
        const { translatedTitle, translatedContent, newVocabItems } = await step.run(`translate-chapter-${i}`, async () => {
          const book = await Book.findById(bookId).select('title');
          return await translateChapter(
            chineseTitle,
            chineseContent,
            bookId,
            book.title,
            (type, msg) => console.log(`[Worker] ${type}: ${msg}`) 
          );
        });

        // C. Save Vocabulary & Chapter to Database
        await step.run(`save-database-${i}`, async () => {
          // Save Vocab
          if (newVocabItems && newVocabItems.length > 0) {
            const vocabOps = newVocabItems.map(item => ({
              updateOne: {
                filter: { book: bookId, original: item.original },
                update: { $setOnInsert: { translation: item.translation } },
                upsert: true
              }
            }));
            const bulkResult = await Vocab.bulkWrite(vocabOps);
            if (bulkResult.upsertedCount > 0) vocabChanged = true;
          }

          // Save Chapter (Using UPSERT to guarantee no duplicates on retries)
          let finalIsLocked = isLocked !== undefined ? isLocked : true;
          const bookDoc = await Book.findById(bookId).select('freeChapters');
          if (currentChapterNo <= bookDoc.freeChapters) finalIsLocked = false;

          const newChapter = await Chapter.findOneAndUpdate(
            { book: bookId, chapterNo: currentChapterNo },
            {
              title: translatedTitle,
              content: translatedContent,
              isLocked: finalIsLocked,
              coinCost: finalIsLocked ? (coinCost || 20) : 0,
              lockedAt: finalIsLocked ? new Date() : null,
              sourceUrl: currentUrl, // <--- ADDED HERE
              status: "published",   // <--- ADDED HERE
              uploadedBy: userId
            },
            { upsert: true, new: true }
          );

          // Link to Book
          await Book.findByIdAndUpdate(bookId, {
            $addToSet: { chapters: newChapter._id }
          });
        });

        successCount++;

        // Update Mission Success Stats
        await step.run(`update-mission-success-${i}`, async () => {
          await Mission.findByIdAndUpdate(missionId, {
            $inc: { completed: 1 },
            active: 0
          });
        });

      } catch (error) {
        console.error(`[Worker] Chapter ${currentChapterNo} Failed:`, error.message);
        failedCount++;

        // --- NEW: THE PLACEHOLDER PATCH ---
        await step.run(`save-failed-placeholder-${i}`, async () => {
          const failedChapter = await Chapter.findOneAndUpdate(
            { book: bookId, chapterNo: currentChapterNo },
            {
              title: `Chapter ${currentChapterNo} (Translation Failed)`,
              content: "This chapter encountered an error during translation. It is queued for retry.",
              sourceUrl: currentUrl, 
              status: "failed",      
              isLocked: false,
              coinCost: 0
            },
            { upsert: true, new: true }
          );

          await Book.findByIdAndUpdate(bookId, {
            $addToSet: { chapters: failedChapter._id } 
          });
        });
        // ----------------------------------

        // Update Mission Failed Stats
        await step.run(`update-mission-fail-${i}`, async () => {
          await Mission.findByIdAndUpdate(missionId, {
            $inc: { failed: 1 },
            active: 0
          });
        });

        if (!nextUrlToProcess) {
          console.error("[Worker] Scraping failed, lost next URL. Aborting chain.");
          break;
        }
      }

      // D. Prepare for Next Loop & Cooldown
      currentUrl = nextUrlToProcess;
      currentChapterNo++;

      if (i < limit - 1) {
        await step.sleep(`cooldown-sleep-${i}`, "10s");
      }
    }

    // 3. Final Cleanup
    await step.run("finalize-mission", async () => {
      if (vocabChanged) clearVocabCache(bookId);
      resetModelQuotaState();

      await Mission.findByIdAndUpdate(missionId, {
        status: failedCount > 0 && successCount === 0 ? 'failed' : 'completed',
        active: 0,
        pending: 0 
      });
    });

    return { success: successCount, failed: failedCount };
  }
);


// The Retry Background Job
// @description: This function is triggered when an admin wants to retry all failed chapters for a specific book. It creates a new mission and processes only the chapters that previously failed, updating their status accordingly.
const retryFailedProcess = inngest.createFunction(
  { id: "retry-failed-chapters", name: "Retry Failed Chapters" },
  { event: "agent/translate.retry" },
  async ({ event, step }) => {
    const { missionId, bookId, coinCost, isLocked, userId } = event.data;

    let successCount = 0;
    let failedCount = 0;
    let vocabChanged = false;

    // 1. Fetch the failed chapters from the DB
    const failedChapters = await step.run("get-failed-chapters", async () => {
      return await Chapter.find({ book: bookId, status: "failed" }).sort({ chapterNo: 1 });
    });

    const limit = failedChapters.length;

    // 2. Loop through and retry them
    for (let i = 0; i < limit; i++) {
      const chapter = failedChapters[i];
      const currentUrl = chapter.sourceUrl;
      const currentChapterNo = chapter.chapterNo;

      if (!currentUrl) {
        console.warn(`[Worker] Chapter ${currentChapterNo} missing sourceUrl. Skipping.`);
        continue;
      }

      await step.run(`update-mission-active-${i}`, async () => {
        await Mission.findByIdAndUpdate(missionId, { active: 1, pending: limit - i - 1 });
      });

      try {
        // A. Scrape
        const { title: chineseTitle, content: chineseContent } = await step.run(`scrape-retry-${i}`, async () => {
          return await scrapeChapter(currentUrl);
        });

        // B. Translate
        const { translatedTitle, translatedContent, newVocabItems } = await step.run(`translate-retry-${i}`, async () => {
          const book = await Book.findById(bookId).select('title');
          return await translateChapter(
            chineseTitle, chineseContent, bookId, book.title,
            (type, msg) => console.log(`[Retry Worker] ${type}: ${msg}`)
          );
        });

        // C. Overwrite Placeholder in Database
        await step.run(`save-retry-database-${i}`, async () => {
          if (newVocabItems && newVocabItems.length > 0) {
            const vocabOps = newVocabItems.map(item => ({
              updateOne: { filter: { book: bookId, original: item.original }, update: { $setOnInsert: { translation: item.translation } }, upsert: true }
            }));
            const bulkResult = await Vocab.bulkWrite(vocabOps);
            if (bulkResult.upsertedCount > 0) vocabChanged = true;
          }

          let finalIsLocked = isLocked !== undefined ? isLocked : true;
          const bookDoc = await Book.findById(bookId).select('freeChapters');
          if (currentChapterNo <= bookDoc.freeChapters) finalIsLocked = false;

          await Chapter.findByIdAndUpdate(chapter._id, {
            title: translatedTitle,
            content: translatedContent,
            isLocked: finalIsLocked,
            coinCost: finalIsLocked ? (coinCost || 20) : 0,
            lockedAt: finalIsLocked ? new Date() : null,
            status: "published", // <--- Promoted from 'failed' to 'published'!
            uploadedBy: userId
          });
        });

        successCount++;
        await step.run(`update-mission-success-${i}`, async () => {
          await Mission.findByIdAndUpdate(missionId, { $inc: { completed: 1 }, active: 0 });
        });

      } catch (error) {
        console.error(`[Retry Worker] Chapter ${currentChapterNo} Failed AGAIN:`, error.message);
        failedCount++;
        await step.run(`update-mission-fail-${i}`, async () => {
          await Mission.findByIdAndUpdate(missionId, { $inc: { failed: 1 }, active: 0 });
        });
      }

      if (i < limit - 1) {
        await step.sleep(`cooldown-sleep-${i}`, "10s");
      }
    }

    // 3. Finalize
    await step.run("finalize-retry-mission", async () => {
      if (vocabChanged) clearVocabCache(bookId);
      resetModelQuotaState();
      await Mission.findByIdAndUpdate(missionId, {
        status: failedCount > 0 && successCount === 0 ? 'failed' : 'completed',
        active: 0, pending: 0
      });
    });

    return { success: successCount, failed: failedCount };
  }
);

module.exports = { bulkTranslateProcess, retryFailedProcess };