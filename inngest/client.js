const { Inngest } = require("inngest");

// Create a client to send and receive events
const inngest = new Inngest({ id: "novel-angel" });

module.exports = { inngest };