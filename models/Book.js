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
		required: [true, "Author is a Required field"],
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

	tags: {
		type: [String],
		trim: true,
		default: undefined,
		required: [true, "tags is a Required field"]
	},

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
		ref: 'User',
		required: [true, "Uploaded By is a required field"],
	}, // Admin who uploaded the book

	likeCount: { // New field to track likes
		type: Number,
		default: 0
	},

	views: {
		type: Number,
		default: 0,
	},

	viewedBy: [{
		type: mongoose.Schema.Types.ObjectId,
		ref: 'User',
	}],

}, { timestamps: true });

// Create a text index on title and author for efficient text search
bookSchema.index({ title: 'text', author: 'text' });

// Create indexes on category and tags for efficient filtering
bookSchema.index({ category: 1 });
bookSchema.index({ tags: 1 });

// New index for the trending books query
bookSchema.index({ updatedAt: -1, views: -1, likeCount: -1 });

module.exports = mongoose.model('Book', bookSchema);
