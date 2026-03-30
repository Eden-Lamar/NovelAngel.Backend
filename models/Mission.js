const mongoose = require('mongoose');

const MissionSchema = new mongoose.Schema({
	book: {
		type: mongoose.Schema.Types.ObjectId,
		ref: 'Book',
		required: true
	},
	status: {
		type: String,
		enum: ['running', 'completed', 'failed'],
		default: 'running'
	},
	total: { type: Number, default: 0 },
	pending: { type: Number, default: 0 },
	active: { type: Number, default: 0 },
	completed: { type: Number, default: 0 },
	failed: { type: Number, default: 0 },
	// TTL Index: Auto-deletes this document 7 days after creation
	createdAt: { type: Date, default: Date.now, expires: '7d' }
});

module.exports = mongoose.model('Mission', MissionSchema);