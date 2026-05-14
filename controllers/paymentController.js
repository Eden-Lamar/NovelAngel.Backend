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

		// Check if the request came from the User App URL defined in your .env
		// This works for both local (localhost:3002) and prod (https://user-app.vercel.app)
		// assuming FRONTEND_USER_URL is set correctly in .env
		const isUserApp = userOrigin.includes(process.env.FRONTEND_USER_URL) || userOrigin.includes('3002');

		const sourceApp = isUserApp ? 'user' : 'admin';

		const payload = {
			tx_ref,
			amount,
			currency: 'USD',
			redirect_url: `${process.env.API_URL}/payment/callback?source=${sourceApp}`, // Redirects to callback route Adjust to your callback URL
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

// @description: Buy Me a Coffee Webhook handler for Shop/Extras
// @route POST /api/v1/payments/bmac/webhook
// @access public (secured by query token)
const bmacWebhook = async (req, res) => {
	// 1. Security Check: Verify secret token passed in the URL
	const token = req.query.token;
	if (!token || token !== process.env.BMAC_WEBHOOK_SECRET) {
		console.log("BMAC Webhook failed: Invalid or missing token");
		return res.status(401).end();
	}

	console.log("BMAC Webhook received - Body:", JSON.stringify(req.body, null, 2));

	try {
		// BMAC typically wraps the payload in a 'type' and 'data' object
		const { type, data } = req.body;

		// Check if the event is related to a Shop/Extra purchase
		// Note: We log the exact type so you can adjust this string if BMAC changes their naming
		const validEvents = ['extra_purchased', 'shop_purchased', 'Extras purchased'];
		if (!validEvents.includes(type)) {
			console.log(`BMAC Webhook skipped: Event is not a shop purchase (Event: ${type})`);
			return res.status(200).end();
		}

		// 2. Identify the User
		// BMAC sends the payer's email, but we also check for custom question answers
		const payerEmail = data.payer_email || data.supporter_email || "";
		let customAnswer = "";

		// Look for the custom question you set up ("What is your Novel Angel Email...")
		if (data.custom_questions && Array.isArray(data.custom_questions)) {
			const questionData = data.custom_questions[0];
			if (questionData && questionData.answer) {
				customAnswer = questionData.answer.trim();
			}
		}

		// Prioritize the custom answer, fallback to the email they used to check out
		const userIdentifier = customAnswer || payerEmail;

		if (!userIdentifier) {
			console.log("BMAC Webhook: No email or identifier found to credit user.");
			return res.status(200).end(); // Always return 200 so BMAC stops retrying
		}

		// Find the user in the database by email or username (in case they entered their username in the custom question)
		const user = await User.findOne({
			$or: [
				{ email: userIdentifier.toLowerCase() },
				{ username: userIdentifier }
			]
		});

		if (!user) {
			console.log("BMAC Webhook: User not found in database for identifier:", userIdentifier);
			return res.status(200).end();
		}

		// 3. Determine how many coins to grant based on the Shop Item Title
		const itemTitle = data.extra_title || data.title || "";
		let coinsToAdd = 0;
		let amountPaid = data.amount || 0;

		// Use string matching to figure out which package they bought
		if (itemTitle.includes("100")) coinsToAdd = 100;
		else if (itemTitle.includes("300")) coinsToAdd = 300;
		else if (itemTitle.includes("500")) coinsToAdd = 500;
		else if (itemTitle.includes("1050")) coinsToAdd = 1050; // 1000 + 50 bonus
		else if (itemTitle.includes("2200")) coinsToAdd = 2200; // 2000 + 200 bonus
		else if (itemTitle.includes("6750")) coinsToAdd = 6750; // 5000 + 1750 bonus
		else if (itemTitle.includes("14500")) coinsToAdd = 14500; // 10000 + 4500 bonus

		if (coinsToAdd === 0) {
			console.log("BMAC Webhook: Could not determine coin amount from item title:", itemTitle);
			return res.status(200).end();
		}

		// 4. Update the User's Coin Balance
		const updatedUser = await User.findByIdAndUpdate(
			user._id,
			{ $inc: { coinBalance: coinsToAdd } },
			{ new: true }
		);
		console.log(`Success! Credited ${coinsToAdd} coins to ${updatedUser.email} via BMAC.`);

		// 5. Log the Transaction (So it shows up in your admin dashboard)
		await Transaction.create({
			user: user._id,
			tx_ref: `bmac-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
			transaction_id: data.id || `bmac-tx-${Date.now()}`,
			amount: amountPaid,
			currency: data.currency || 'USD',
			coins: coinsToAdd,
			status: 'successful'
		});

		res.status(200).end();
	} catch (error) {
		console.error("BMAC Webhook Error:", error.message);
		res.status(500).end();
	}
};

module.exports = { buyCoins, flutterwaveWebhook, bmacWebhook };