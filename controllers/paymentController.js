const axios = require('axios');
const Flutterwave = require('flutterwave-node-v3');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);

// Coin purchase plans: { coins (base), bonus, price (USD) }
const COIN_PLANS = [
	{ baseCoins: 100, bonus: 0, price: 1.00 },
	{ baseCoins: 300, bonus: 0, price: 2.99 },
	{ baseCoins: 500, bonus: 0, price: 4.99 },
	{ baseCoins: 1000, bonus: 50, price: 9.99 },
	{ baseCoins: 2000, bonus: 200, price: 19.99 },
	{ baseCoins: 5000, bonus: 1750, price: 49.99 },
	{ baseCoins: 10000, bonus: 4500, price: 99.99 },
];

// @description: Initiate coin purchase
// @route POST /api/v1/payments/buy-coins
// @access private
const buyCoins = async (req, res) => {
	try {
		const { coins } = req.body;
		const userId = req.user._id;

		// Find matching plan
		const plan = COIN_PLANS.find(p => p.baseCoins === coins);
		if (!plan) {
			return res.status(400).json({
				status: "fail",
				message: "Invalid coin amount. Choose from coin plans",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({
				status: 'fail',
				message: 'User not found'
			});
		}

		const amount = plan.price;
		const totalCoins = plan.baseCoins + plan.bonus;
		const tx_ref = `coins-${userId}-${Date.now()}`;

		// Create transaction record
		await Transaction.create({
			user: userId,
			tx_ref,
			amount,
			coins: totalCoins, // Total including bonus
			currency: 'USD'
		});

		// Determine origin port for redirect_url
		const userOrigin = req.get('Origin') || req.get('Referer') || '';
		const originPort = userOrigin.includes('3002') ? '3002' : '3001';

		const payload = {
			tx_ref,
			amount,
			currency: 'USD',
			redirect_url: `${process.env.API_URL}/payment/callback?origin=${originPort}`, // Redirects to callback route Adjust to your callback URL
			payment_options: 'card,ussd,banktransfer',
			customer: {
				email: user.email,
				name: user.username
			},
			customizations: {
				title: 'Buy Coins',
				description: `${totalCoins} coins (${plan.baseCoins} + ${plan.bonus} bonus) for $${amount}`
			}
		};

		const response = await axios.post(
			'https://api.flutterwave.com/v3/payments',
			payload,
			{
				headers: {
					Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`
				}
			}
		);

		res.status(200).json({
			status: 'success',
			link: response.data.data.link
		});
	} catch (error) {
		console.error("buyCoins error:", error.message);
		res.status(500).json({
			status: 'fail',
			message: error.message
		});
	}
};

// @description: Flutterwave Webhook handler for payment verification and coin credit
// @route POST /api/v1/payments/flutterwave/webhook
// @access public (secured by verif-hash)
const flutterwaveWebhook = async (req, res) => {
	// Log raw request for debugging
	console.log("Webhook received - Headers:", req.headers);
	console.log("Webhook received - Body:", req.body);

	// Get verif-hash from header
	const verifHash = req.headers["verif-hash"];
	if (!verifHash || verifHash !== process.env.FLW_WEBHOOK_SECRET) {
		console.log("Webhook failed: Invalid or missing verif-hash", { received: verifHash, expected: process.env.FLW_WEBHOOK_SECRET });
		return res.status(401).end();
	}

	const { event, data } = req.body;
	console.log("Webhook event:", event, "Status:", data?.status);

	if (event === "charge.completed") {
		// Handle SUCCESSFUL charges
		if (data.status === "successful") {
			try {
				// Verify transaction
				console.log("Verifying transaction ID:", data.id);
				const verified = await flw.Transaction.verify({ id: data.id });

				if (verified.data.status === "successful") {
					console.log("Transaction verified:", verified.data);

					// Atomic update: Find and update in one operation
					const transaction = await Transaction.findOneAndUpdate(
						{
							tx_ref: verified.data.tx_ref,
							status: "initiated" // Only match if STILL initiated
						},
						{
							$set: { status: "processing" } // Temporarily lock it so two webhook calls can’t double-credit the same transaction.
						},
						{
							new: false // Return the original document (before update)
						}
					);

					if (!transaction) {
						console.log("Transaction already processed or not found:", verified.data.tx_ref);
						return res.status(200).end();
					}

					console.log("Transaction locked for processing:", transaction);

					// Check amount/currency (on the original transaction)
					if (Math.abs(verified.data.amount - transaction.amount) < 0.01 && verified.data.currency === transaction.currency) {
						// Credit coins
						const user = await User.findById(transaction.user);
						if (!user) {
							console.log("User not found for ID:", transaction.user);
							// Roll back status to initiated if needed, but for simplicity, leave as processing
							return res.status(200).end();
						}
						console.log("Before update - User coinBalance:", user.coinBalance);
						const updatedUser = await User.findByIdAndUpdate(
							transaction.user,
							{ $inc: { coinBalance: transaction.coins } },
							{ new: true }
						);
						console.log("After update - User coinBalance:", updatedUser.coinBalance);

						// Update transaction to successful
						// Use updateOne instead of save() for final status
						const updatedTransaction = await Transaction.updateOne(
							{ _id: transaction._id },
							{ status: "successful", transaction_id: verified.data.id }
						);
						console.log("Transaction updated:", updatedTransaction);
					} else {
						console.log("Transaction mismatch - Amount or currency", {
							verifiedAmount: verified.data.amount,
							transactionAmount: transaction.amount,
							verifiedCurrency: verified.data.currency,
							transactionCurrency: transaction.currency,
						});
						// Roll back to initiated if mismatch
						await Transaction.updateOne({ _id: transaction._id }, { status: "initiated" });
					}
				} else {
					console.log("Verification failed:", verified.data.status);
				}
			} catch (error) {
				console.error("Webhook 'successful' block error:", error.message);
			}

		} else if (data.status === "failed") {
			try {
				const { tx_ref, id } = data;
				console.log("Processing failed transaction:", tx_ref);

				// Find the transaction and update its status to 'failed'
				const transaction = await Transaction.findOneAndUpdate(
					{ tx_ref: tx_ref, status: "initiated" }, // Only update if it's still initiated
					{ $set: { status: "failed", transaction_id: id } },
					{ new: true }
				);

				if (transaction) {
					console.log("Transaction marked as failed:", tx_ref);
				} else {
					console.log("Failed transaction already processed or not found:", tx_ref);
				}
			} catch (error) {
				console.error("Webhook 'failed' block error:", error.message);
			}

		} else {
			// Handle other statuses like 'pending', 'abandoned' etc.
			console.log(`Webhook: Charge completed but status is '${data.status}', not processing.`);
		}

	} else {
		// Log other events but don't process them
		console.log(`Webhook skipped: Event is not 'charge.completed' (Event: ${event})`);
	}

	// Always send a 200 OK to Flutterwave to stop retries
	res.status(200).end();
};

module.exports = { buyCoins, flutterwaveWebhook };