const Book = require("../models/Book");
const Mission = require("../models/Mission");
const Chapter = require("../models/Chapter");
const { inngest } = require("../inngest/client");

// @description: Fire & Forget Bulk Translation Trigger
// @route POST /api/v1/agent/bulk-inngest
// @access Private (Admin)
const bulkTranslateChapters = async (req, res) => {
	let { bookId, startUrl, limit, coinCost, isLocked } = req.body;

	// Default limit safety
	limit = limit || 1;
	if (limit > 50) limit = 50;

	try {
		const book = await Book.findById(bookId);
		if (!book) {
			return res.status(404).json({ status: "fail", error: "Book not found" });
		}

		// 1. Create the Tracking Mission in the Database
		const mission = await Mission.create({
			book: bookId,
			status: 'running',
			total: limit,
			pending: limit,
			active: 0,
			completed: 0,
			failed: 0
		});

		// 2. Fire the Inngest Background Event
		// We pass all the context the worker needs in the "data" payload
		await inngest.send({
			name: "agent/translate.bulk",
			data: {
				missionId: mission._id.toString(),
				bookId: bookId,
				startUrl: startUrl,
				limit: limit,
				coinCost: coinCost,
				isLocked: isLocked,
				userId: req.user._id.toString() // Needed to link the uploader
			}
		});

		// 3. Respond Immediately (Zero Timeouts!)
		res.status(200).json({
			status: "success",
			message: "Background translation mission queued successfully.",
			missionId: mission._id
		});

	} catch (error) {
		console.error("Bulk Translation Queue Error:", error);
		res.status(500).json({ status: "fail", error: error.message });
	}
};

// @description: Retry Failed Chapters
// @route POST /api/v1/agent/retry-failed
// @access Private (Admin)
const retryFailedChapters = async (req, res) => {
	try {
		const { bookId, coinCost, isLocked } = req.body;

		// 1. Find all failed chapters for this book
		const failedChapters = await Chapter.find({ book: bookId, status: "failed" });

		if (failedChapters.length === 0) {
			return res.status(400).json({ success: false, error: "No failed chapters found to retry." });
		}

		// 2. Create a new Mission specifically for tracking the retries
		const newMission = await Mission.create({
			book: bookId,
			total: failedChapters.length,
			pending: failedChapters.length,
			active: 0,
			completed: 0,
			failed: 0,
			status: "running"
		});

		// 3. Fire the Inngest Retry Event
		await inngest.send({
			name: "agent/translate.retry",
			data: {
				missionId: newMission._id.toString(),
				bookId,
				coinCost,
				isLocked,
				userId: req.user.userId
			}
		});

		// 4. Send Mission ID back so React can track the progress
		res.status(200).json({ success: true, missionId: newMission._id });

	} catch (error) {
		console.error("Retry Failed Error:", error);
		res.status(500).json({ success: false, error: "Failed to start retry mission" });
	}
};

// @description: Poll the Mission Status
// @route GET /api/v1/agent/mission/:missionId
// @access Private (Admin)
const getMissionStatus = async (req, res) => {
	try {
		const mission = await Mission.findById(req.params.missionId);
		if (!mission) {
			return res.status(404).json({ status: "fail", error: "Mission not found" });
		}

		res.status(200).json({
			status: "success",
			mission
		});
	} catch (error) {
		res.status(500).json({ status: "fail", error: error.message });
	}
};

module.exports = { bulkTranslateChapters, retryFailedChapters, getMissionStatus };