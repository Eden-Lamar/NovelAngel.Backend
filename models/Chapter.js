const chapterSchema = new Schema({
	title: {
		type: String,
		required: [true, "title is a Required field"],
		trim: true,
		minLength: 6,
		maxLength: 80,
	},

	content: {
		type: String,
		trim: true,
		required: true
	},

	book: {
		type: Schema.Types.ObjectId,
		ref: 'Book',
		required: true
	},

	isLocked: {
		type: Boolean,
		default: false
	}, // Free or locked chapter

	likes: [{
		type: Schema.Types.ObjectId,
		ref: 'Like'
	}],

	comments: [{
		type: Schema.Types.ObjectId,
		ref: 'Comment'
	}],

	uploadedBy: {
		type: Schema.Types.ObjectId,
		ref: 'User'
	},
}, { timestamps: true });

module.exports = mongoose.model('Chapter', chapterSchema);
