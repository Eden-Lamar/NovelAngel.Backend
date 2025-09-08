// APPLICATION IMPORTS
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./config/db");
const indexRouter = require('./routes/index');

const app = express();
const port = process.env.PORT || 8080;

const corsOptions = {
	exposedHeaders: 'Authorization',
};

// APPLICATION MIDDLEWARE
app.use(express.json());
app.use(cors(corsOptions));
app.use(morgan("dev"));

// ROUTES MIDDLEWARE
app.use('/', indexRouter);

// CONNECT TO DB
connectDB().then(() => {
	// Load cron jobs only after DB is ready
	require("./jobs/unlockChapters"); // job auto-runs in background
});

// create Server
app.listen(port, () => {
	console.log(`\nServer up on port ${port}...\n`);
});
