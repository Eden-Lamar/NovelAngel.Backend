// APPLICATION IMPORTS
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const bodyParser = require('body-parser');  // We use this instead of express.json() for raw body capture
const passport = require("passport");
require("dotenv").config();
const connectDB = require("./config/db");
const indexRouter = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 5000;

const corsOptions = {
	exposedHeaders: 'Authorization',
};

// APPLICATION MIDDLEWARE
app.use(
	bodyParser.json({
		verify: (req, res, buf) => {
			req.rawBody = buf.toString(); // Save raw body for webhook verification
		},
	})
);
app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(passport.initialize());


// ROUTES MIDDLEWARE
app.use('/', indexRouter);

// PAYMENT CALLBACK ROUTE (for Postman testing, and frontend)
app.get("/payment/callback", (req, res) => {
	const { status, tx_ref, transaction_id, origin } = req.query;
	console.log("Payment callback:", { status, tx_ref, transaction_id });

	const port = (origin === '3002') ? '3002' : '3001';
	const baseUrl = (port === '3002') ? process.env.FRONTEND_USER_URL : process.env.FRONTEND_URL;

	console.log("Base URL:", baseUrl);

	// Build query parameters
	const params = new URLSearchParams({
		status: status || 'unknown',
		tx_ref: tx_ref || '',
		...(transaction_id && { transaction_id })
	});

	// Redirect to frontend success page
	const frontendUrl = `${baseUrl}/payment/success?${params.toString()}`;
	console.log("Redirecting to:", frontendUrl);

	res.redirect(frontendUrl);
});

// CONNECT TO DB
connectDB().then(() => {
	// Load cron jobs only after DB is ready
	require("./jobs/unlockChapters"); // job auto-runs in background
});

// create Server
app.listen(PORT, () => {
	console.log(`\nServer up on port ${PORT}...\n`);
});
