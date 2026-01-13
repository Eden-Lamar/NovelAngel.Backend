const mongoose = require('mongoose');
const { Schema } = mongoose;

const vocabSchema = new Schema({
	book: {
		type: Schema.Types.ObjectId,
		ref: 'Book',
		required: [true, "Vocab must be linked to a Book"]
	},

	// The Chinese term (Hanzi)
	original: {
		type: String,
		required: true,
		trim: true
	},

	// The English translation
	translation: {
		type: String,
		required: true,
		trim: true
	},

	// Optional: "Character", "Location", "Item", "Skill"
	// This helps the AI understand context better
	type: {
		type: String,
		enum: ['Character', 'Location', 'Item', 'Skill', 'General'],
		default: 'General'
	}
}, { timestamps: true });

// Compound index: A specific Chinese word should only appear once per Book
vocabSchema.index({ book: 1, original: 1 }, { unique: true });

module.exports = mongoose.model('Vocab', vocabSchema);