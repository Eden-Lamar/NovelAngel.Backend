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
		required: true
	},

}, { timestamps: true });

module.exports = mongoose.model('Bookmark', bookmarkSchema);
