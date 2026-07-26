const mongoose = require('mongoose');
const slugify = require('slugify');
const { Schema } = mongoose;

const bookSchema = new Schema({
	title: {
		type: String,
		required: [true, "title is a Required field"],
		trim: true,
		// lowercase: true,
		minLength: 6,
		maxLength: 1000,
	},

	author: {
		type: String,
		trim: true,
		required: [true, "Author is a Required field"],
		// lowercase: true,
		minLength: 3,
		maxLength: 100,
	},

	description: {
		type: String,
		required: [true, "description is a Required field"],
		trim: true,
		// lowercase: true,
		minLength: 20,
		maxLength: 6000,
	},

	category: {
		type: String,
		enum: ['BL', 'GL', 'BG', 'No CP'],
		default: 'BL', // Default value for category
		// required: [true, "category is a Required field"]
	},

	country: {
		type: String,
		enum: ['Chinese', 'Japanese', 'South Korean'],
		required: [true, "Country is a Required field"]
	},

	bookImage: {
		type: String, // URL of the thumbnail
		required: true
	},

	tags: {
		type: [String],
		trim: true,
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

	// Link to Buy Me a Coffee for books that are already completed and want to monetize through donations
	buyMeACoffeeLink: {
		type: String,
		trim: true,
		default: null
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

	// NEW: Track anonymous users by IP to prevent refresh spam
	anonymousViewers: [{
		type: String,
	}],

	lastUnlockedAt: {
		type: Date,
		default: null
	},

	// Controls if the daily cron job targets this book
	isAutoUnlockEnabled: {
		type: Boolean,
		default: false
	},

	autoUnlockCount: {
		type: Number,
		default: 1, // Default to 1 chapter per day
	},

	autoUnlockTime: {
		type: String,
		default: "00:00", // Default to Midnight (24-hour HH:MM format)
	},

	slug: {
		type: String,
		unique: true,
		index: true
	},

}, { timestamps: true });

// Add a Pre-save hook to generate the slug
bookSchema.pre('save', function (next) {
	// Only generate a new slug if the title was modified (or is new)
	if (this.isModified('title')) {
		this.slug = slugify(this.title, {
			lower: true,      // Convert to lowercase
			strict: true,     // Strip special characters
			remove: /[*+~.()'"!:@]/g // Ensure clean URLs
		});
	}
	next();
});

// Create a text index on title and author for efficient text search
bookSchema.index({ title: 'text', author: 'text' });

// Create indexes on category and tags for efficient filtering
bookSchema.index({ category: 1 });
bookSchema.index({ tags: 1 });

// New index for the trending books query
bookSchema.index({ updatedAt: -1, views: -1, likeCount: -1 });

// Created Index for book recommendations
bookSchema.index({ createdAt: -1 });

// NEW INDEX: Optimizes the daily cron job query -> Book.find({ isAutoUnlockEnabled: true })
bookSchema.index({ isAutoUnlockEnabled: 1 });

module.exports = mongoose.model('Book', bookSchema);
