const mongoose = require('mongoose');
const { Schema } = mongoose;

const commentSchema = new Schema({
	content: {
		type: String,
		trim: true,
		maxLength: 100,
		required: true
	},

	book: {
		type: Schema.Types.ObjectId,
		ref: 'Book',
		required: true
	},

	user: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true
	},

}, { timestamps: true });

// Optional: Index for faster queries
commentSchema.index({ user: 1, book: 1 });

module.exports = mongoose.model('Comment', commentSchema);
