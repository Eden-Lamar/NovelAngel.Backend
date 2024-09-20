const mongoose = require('mongoose');
const { Schema } = mongoose;

const bookmarkSchema = new Schema({
	user: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true
	},

	book: {
		type: Schema.Types.ObjectId,
		ref: 'Book',
		required: [true, "book is a require field"]
	},

}, { timestamps: true });

// Prevent duplicate bookmarks
bookmarkSchema.index({ user: 1, book: 1 }, { unique: true });

module.exports = mongoose.model('Bookmark', bookmarkSchema);
