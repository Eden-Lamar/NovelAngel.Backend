const express = require('express');
const { buyCoins, flutterwaveWebhook } = require('../../controllers/paymentController');
const { protect } = require('../../middlewares/authMiddleware');

const router = express.Router();

// Protected route for Initiating coin purchase buying coins
router.post('/buy-coins', protect, buyCoins);

// Flutterwave Webhook (no auth, secured by secret in .env) for payment verification
router.post('/flutterwave/webhook', flutterwaveWebhook);

module.exports = router;
