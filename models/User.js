const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
	username: {
		type: String,
		trim: true,
		required: [true, "Username is a Required field"],
		minLength: 3,
		maxLength: 30,
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
		minLength: 8,
		maxLength: 255,
		trim: true,
		// Only required if not using Google (or any OAuth)
		required: function () {
			return !this.googleId; // If there's no Google ID, password is required
		},
	},
	googleId: {
		type: String,
		default: null,
	},
	role: {
		type: String,
		enum: ['user', 'admin'],
		default: 'user'
	},
	avatar: {
		type: String, // URL of the avatar
		default: null
	},
	coinBalance: {
		type: Number,
		default: 30, // 🎁 Give new users 30 free coins automatically
		min: 0
	},
	unlockedChapters: [{
		type: Schema.Types.ObjectId,
		ref: 'Chapter'
	}],
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
userSchema.index({ 'readingHistory.book': 1, 'readingHistory.createdAt': -1 });

module.exports = mongoose.model('User', userSchema);
