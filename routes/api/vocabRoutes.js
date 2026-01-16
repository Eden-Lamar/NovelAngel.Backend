const express = require('express');
const multer = require('multer');
const { importVocab } = require('../../controllers/vocabController');
const { protect, admin } = require('../../middlewares/authMiddleware');


const router = express.Router();

// Configure Multer (Temp storage)
const upload = multer({ dest: 'uploads/' });

router.post('/import', protect, admin, upload.single('file'), importVocab); // Import vocab from file

module.exports = router;