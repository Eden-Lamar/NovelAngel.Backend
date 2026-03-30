const express = require('express');
const { serve } = require('inngest/express');
const { inngest } = require('../../inngest/client');
const { bulkTranslateProcess, retryFailedProcess } = require('../../inngest/functions');

const router = express.Router();

// Mount the Inngest handler
router.use(
	'/',
	serve({
		client: inngest,
		functions: [bulkTranslateProcess, retryFailedProcess],
	})
);

module.exports = router;