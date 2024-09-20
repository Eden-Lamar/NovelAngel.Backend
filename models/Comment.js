const mongoose = require('mongoose');
const { Schema } = mongoose;

const commentSchema = new Schema({
	text: {
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

module.exports = mongoose.model('Comment', commentSchema);
