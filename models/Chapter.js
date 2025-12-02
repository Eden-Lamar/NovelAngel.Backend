const mongoose = require('mongoose');
const { Schema } = mongoose;

const chapterSchema = new Schema({
	title: {
		type: String,
		required: [true, "title is a Required field"],
		trim: true,
		lowercase: true,
		maxLength: 80,
	},

	content: {
		type: String,
		trim: true,
		required: [true, "content is a Required field"]
	},

	book: {
		type: Schema.Types.ObjectId,
		ref: 'Book',
		required: [true, "book id is a Required field"]
	},
	chapterNo: {
		type: Number,
		required: [true, "chapterNo is a Required field"]
	},

	isLocked: {
		type: Boolean,
		default: false
	}, // Free or locked chapter

	coinCost: {
		type: Number,
		default: 0,
		min: 0
	}, // Cost in coins to unlock

	lockedAt: {
		type: Date,
		default: null
	}, // Timestamp when the chapter was locked

	// likes: [{
	// 	type: Schema.Types.ObjectId,
	// 	ref: 'Like'
	// }],

	// comments: [{
	// 	type: Schema.Types.ObjectId,
	// 	ref: 'Comment'
	// }],

	releasedAt: {
		type: Date,
		default: null, // Default to null. We set this when it becomes free.
		index: true    // Add index for faster sorting in the RSS feed
	},

	uploadedBy: {
		type: Schema.Types.ObjectId,
		ref: 'User'
	},
}, { timestamps: true });

// Pre-save hook
// If a chapter is created/updated as FREE (isLocked: false) and has no releasedAt date,
// set releasedAt to NOW.
chapterSchema.pre('save', function (next) {
	if (!this.isLocked && !this.releasedAt) {
		this.releasedAt = new Date();
	}
	next();
});

module.exports = mongoose.model('Chapter', chapterSchema);
