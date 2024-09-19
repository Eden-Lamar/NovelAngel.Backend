const mongoose = require('mongoose');
const { Schema } = mongoose;

const likeSchema = new Schema({
	user: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true
	},

	chapter: {
		type: Schema.Types.ObjectId,
		ref: 'Chapter',
		required: true
	},

}, { timestamps: true });

module.exports = mongoose.model('Like', likeSchema);
