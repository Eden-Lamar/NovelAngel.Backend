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

// TRUST PROXY (for correct HTTPS detection behind proxies)
app.set("trust proxy", 1);

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
	const { status, tx_ref, transaction_id, source } = req.query;
	console.log("Payment callback:", { status, tx_ref, transaction_id, source });

	// Select the correct base URL based on the 'source' flag we passed earlier
  let baseUrl;
  if (source === 'user') {
      baseUrl = process.env.FRONTEND_USER_URL; // e.g., https://novelangel.com
  } else {
      baseUrl = process.env.FRONTEND_URL; // e.g., https://admin.novelangel.com
  }

  // Fallback if env vars are missing (optional safety)
  if (!baseUrl) {
      console.error("Missing frontend URL in .env");
      return res.status(500).send("Server Configuration Error");
  }

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
