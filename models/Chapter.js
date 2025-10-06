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

	uploadedBy: {
		type: Schema.Types.ObjectId,
		ref: 'User'
	},
}, { timestamps: true });

module.exports = mongoose.model('Chapter', chapterSchema);
