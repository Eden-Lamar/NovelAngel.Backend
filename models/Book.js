const mongoose = require('mongoose');
const { Schema } = mongoose;

const bookSchema = new Schema({
	title: {
		type: String,
		required: [true, "title is a Required field"],
		trim: true,
		lowercase: true,
		minLength: 6,
		maxLength: 80,
	},

	author: {
		type: String,
		trim: true,
		required: [true, "Username is a Required field"],
		// lowercase: true,
		minLength: 3,
		maxLength: 50,
	},

	description: {
		type: String,
		required: [true, "description is a Required field"],
		trim: true,
		lowercase: true,
		minLength: 20,
		maxLength: 200,
	},

	category: {
		type: String,
		enum: ['Translation', 'Original stories', 'Fanfiction'],
		default: 'Translation', // Default value for category
		// required: [true, "category is a Required field"]
	},

	tags: [{
		type: [String],
		trim: true,
		default: undefined,
		required: [true, "tags is a Required field"]
	}],

	chapters: [{
		type: Schema.Types.ObjectId,
		ref: 'Chapter'
	}],

	freeChapters: {
		type: Number,
		default: 3
	}, // Number of free chapters

	status: {
		type: String,
		enum: ['ongoing', 'completed'],
		default: 'ongoing', // Default value for status
		//   required: [true, "status is a Required field"]
	},

	uploadedBy: {
		type: Schema.Types.ObjectId,
		ref: 'User'
	}, // Admin who uploaded the book

}, { timestamps: true });

module.exports = mongoose.model('Book', bookSchema);
