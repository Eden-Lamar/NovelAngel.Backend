const mongoose = require('mongoose');
const { Schema } = mongoose;

const likeSchema = new Schema({
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

// Prevent duplicate likes
likeSchema.index({ user: 1, book: 1 }, { unique: true });

module.exports = mongoose.model('Like', likeSchema);
