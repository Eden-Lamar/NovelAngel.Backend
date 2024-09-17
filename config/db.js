const mongoose = require("mongoose");

const connectDB = async () => {
	try {
		const conn = await mongoose.connect(process.env.MONGO_URI)
		console.log(`Connected to ${conn.connection.name} Database`);
	} catch (err) {
		console.log("Error:", err.message)
	}
};
module.exports = connectDB;
