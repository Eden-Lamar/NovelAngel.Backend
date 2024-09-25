const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
	username: {
		type: String,
		trim: true,
		required: [true, "Username is a Required field"],
		minLength: 3,
		maxLength: 20,
		// lowercase: true,
		unique: true
	},
	email: {
		type: String,
		required: [true, "Email is a Required field"],
		trim: true,
		minLength: 6,
		maxLength: 255,
		lowercase: true,
		unique: true,
	},
	password: {
		type: String,
		required: [true, "Password is a Required field"],
		minLength: 8,
		maxLength: 255,
		trim: true,
	},
	role: {
		type: String,
		enum: ['user', 'admin'],
		default: 'user'
	},
	bookmarks: [{
		type: Schema.Types.ObjectId,
		ref: 'Bookmark'
	}],
	likes: [{
		type: Schema.Types.ObjectId,
		ref: 'Like'
	}],
	comments: [{
		type: Schema.Types.ObjectId,
		ref: 'Comment'
	}],
	readingHistory: [{
		book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book' },
		lastChapterRead: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter' },
		createdAt: { type: Date, default: Date.now }
	}]
}, { timestamps: true });


// Add this index
userSchema.index({ 'readingHistory.bookId': 1, 'readingHistory.createdAt': -1 });

module.exports = mongoose.model('User', userSchema);
