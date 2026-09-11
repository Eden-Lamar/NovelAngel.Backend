const Book = require('../models/Book');
const Chapter = require('../models/Chapter');
const puppeteer = require('puppeteer');
const axios = require('axios'); // Ensure axios is installed
const { OpenAI } = require('openai')

const { APP_LOGO_BASE64 } = require('../utils/logoBase64'); // Import the base64 string of your logo

/**
 * Sanitizes and formats LLM recap text for the Pinterest Image generator.
 * @param {string} text - The raw output from the LLM.
 * @returns {string} - The cleaned, formatted string.
 */
const formatRecapForImage = (text) => {
	if (!text) return "";

	let formatted = text;

	// 1. Remove numbering labels (e.g., "1.", "2)", "3 -") anywhere in the text
	// This looks for digits 1-9 followed by a dot or parenthesis and a space.
	formatted = formatted.replace(/\b[1-9][\.\)]\s+/g, '');

	// 2. Replace em dashes (—) and en dashes (–) with a comma and a space.
	// It handles cases with or without surrounding spaces (e.g., "him—but" -> "him, but")
	formatted = formatted.replace(/\s*[—–]\s*/g, ', ');

	// 3. Normalize all whitespace (collapses accidental double spaces or existing line breaks)
	formatted = formatted.replace(/\s+/g, ' ').trim();

	// 4. Add a double line break (\n\n) after every sentence.
	// This looks for ending punctuation (. ! ?) followed by a space and a capital letter.
	formatted = formatted.replace(/([.?!])\s+(?=[A-Z])/g, '$1\n\n');

	return formatted;
};
// , "the toxic sister", "the villain", "the best friend", or "the rival".
// @description: Generate recap, create image, and post to Pinterest
// @route POST /api/v1/books/:bookId/chapters/:chapterId/pinterest
// @access private (Admin only)
const postChapterToPinterest = async (req, res) => {
	try {
		const { bookId, chapterId } = req.params;
		const { action, imageBase64, text } = req.body; // NEW: Get action from body

		// 1. Security Check
		if (req.user.role !== 'admin') {
			return res.status(403).json({ status: 'fail', message: 'Not authorized.' });
		}

		// 2. Fetch Book & Chapter
		const book = await Book.findById(bookId);
		const chapter = await Chapter.findOne({ _id: chapterId, book: bookId });

		if (!book || !chapter) {
			return res.status(404).json({ status: 'fail', message: 'Book or Chapter not found' });
		}

		// ==========================================
		// PHASE 1: PREVIEW (Generate LLM & Image)
		// ==========================================
		if (action === 'preview') {
			const openai = new OpenAI({
				apiKey: process.env.OPENROUTER_API_KEY,
				baseURL: "https://openrouter.ai/api/v1",
			});

			// 3. Call LLM to generate the 4-sentence formula
			// Replace with your preferred LLM API (OpenAI, Gemini, Anthropic)
			const llmPrompt = `
						You are a dramatic marketing copywriter for a web novel app creating viral Pinterest hooks.
						Summarize the following chapter text into exactly 4 sentences.

						CRITICAL RULE: You MUST absolutely replace character names with web-novel marketing archetypes. You must prioritize using these exact phrases: "the male lead", "the female lead", "the toxic sister", "the villain", "the best friend", or "the rival". (e.g., Do not say "John", say "the male lead") so like Archetypes, role-based descriptors, or Epithets.

						FORMATTING RULE: Output ONLY the 4 sentences as a single flowing paragraph. DO NOT include labels, numbers (like 1., 2.), or bullet points.

						Structure the 4 sentences as follows:
						Sentence 1: Opening Hook (High-impact drama setting the stakes).
						Sentence 2: Beginning (Setup of the scene).
						Sentence 3: Middle (The rising action or conflict).
						Sentence 4: End (The cliffhanger or emotional peak).

						Chapter Text: 
						${chapter.content}
						`;

			const llmResponse = await openai.chat.completions.create({
				model: "deepseek/deepseek-v4-flash-0731", // or "kimi-k2.5" depending on their current endpoint names
				messages: [
					{ role: "system", content: "You strictly follow formatting rules without adding conversational filler." },
					{ role: "user", content: llmPrompt }
				],
				temperature: 0.7, // Keeps it dramatic but focused
				max_tokens: 8192 // <--- FIX 1: This stops the 131k token error and saves money!
			});

			// 1. DEFENSIVE CHECK: Did the LLM actually return content?
			let rawContent = "";

			if (
				llmResponse &&
				llmResponse.choices &&
				llmResponse.choices.length > 0 &&
				llmResponse.choices[0].message &&
				llmResponse.choices[0].message.content
			) {
				rawContent = llmResponse.choices[0].message.content;
			} else {
				// If the LLM failed, throw a descriptive error so the frontend catches it gracefully
				console.error("OpenRouter Raw Response:", JSON.stringify(llmResponse, null, 2));
				throw new Error("The AI model returned an empty response. Please try clicking generate again.");
			}

			// NEW FIX: Strip out DeepSeek's <think> tags (both closed and unclosed)
			rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '');
			rawContent = rawContent.replace(/<think>[\s\S]*/gi, ''); // In case it gets cut off

			// Trim any leftover whitespace from the removal
			rawContent = rawContent.trim();

			// Log it to the console so you can verify the text is actually there!
			// console.log("Cleaned LLM Output before Image Gen:", rawContent);

			if (!rawContent) {
				throw new Error("The model only returned internal thoughts and no actual summary. Try generating again.");
			}

			// Safely format the text for the image
			const formattedRecapText = formatRecapForImage(rawContent);

			// res.status(200).json({ status: 'success', recap: formattedRecapText })
			// console.log("Generated Recap:", recapText);

			// // 4. Generate Image using Puppeteer
			const browser = await puppeteer.launch({
				headless: true,
				protocolTimeout: 60000, // Gives the protocol 60 seconds to respond
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox',
					'--disable-dev-shm-usage', // Prevents memory crashes on Linux servers
					'--disable-gpu',           // Disables GPU hardware acceleration
					'--no-zygote'
				]
			});
			const page = await browser.newPage();
			await page.setViewport({ width: 1000, height: 1500, deviceScaleFactor: 2 });

			const htmlContent = `
        <html>
            <head>
                <style>
                    body {
                        background-color: #0f1013;
                        color: #ffffff;
                        font-family: 'Arial', serif;
                        padding: 70px;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        box-sizing: border-box;
                        margin: 0;
                        overflow: hidden; 
                    }
                    .book-title { 
                        display: flex;         /* NEW: Puts logo and text in a row */
                        align-items: center;   /* NEW: Vertically centers them */
                        gap: 15px;             /* NEW: Adds space between logo and text */
                        font-size: 32px; 
                        color: #FFD700; 
                        margin-bottom: 30px; 
                        flex-shrink: 0; 
                    }
                    .app-logo {
                        height: 150px;          /* Adjust this to make your logo bigger/smaller */
                        width: auto;
                        border-radius: 10px;    /* Optional: slightly rounds the logo corners */
                        object-fit: contain;
                    }
                    .recap-wrapper {
                        flex-grow: 1; 
                        display: flex;
                        flex-direction: column;
                        justify-content: center; 
                    }
                    .recap-text { 
                        font-size: 38px; 
                        line-height: 1.5; 
                    }
                    .footer { 
                        margin-top: 30px; 
                        font-size: 31px; 
                        color: #c2c2c2; 
                        border-top: 1px solid #333; 
                        padding-top: 20px; 
                        flex-shrink: 0; 
                    }
                </style>
            </head>
            <body>
                <div class="book-title">
                    <img src="${APP_LOGO_BASE64}" class="app-logo" alt="App Logo" />
                    <span>Read now on ${process.env.FRONTEND_USER_URL}/book/${book.slug}</span>
                </div>
                <div class="recap-wrapper">
                    <div class="recap-text">${formattedRecapText.replace(/\n/g, '<br/>')}</div>
                </div>
                <div class="footer">Novel Title - ${book.title}, Chapter ${chapter.chapterNo}</div>
            </body>
        </html>
      `;

			// This forces Puppeteer to wait until all images (like your logo) are fully loaded before taking the screenshot.
			await page.setContent(htmlContent);
			const imageBuffer = await page.screenshot({
				type: 'jpeg',
				quality: 90,
				timeout: 0
			});
			await browser.close();

			const base64Image = imageBuffer.toString('base64');

			return res.status(200).json({
				status: 'success',
				data: {
					imageBase64: base64Image,
					text: formattedRecapText,
				}
			});
		}

		// ==========================================
		// PHASE 2: PUBLISH (Send to Pinterest API)
		// ==========================================
		if (action === 'publish') {
			if (!imageBase64 || !text) {
				return res.status(400).json({ status: 'fail', message: 'Missing image or text data.' });
			}

			const pinterestData = {
				board_id: process.env.PINTEREST_BOARD_ID,
				media_source: {
					source_type: "image_base64",
					content_type: "image/jpeg",
					data: imageBase64 // Expecting raw base64 without the 'data:image/jpeg;base64,' prefix
				},
				title: `${book.title} - Chapter ${chapter.chapterNo}`,
				description: text,
				link: `${process.env.FRONTEND_USER_URL}/book/${book.slug}/chapter/${chapter.chapterNo}`
			};

			const pinterestResponse = await axios.post('https://api.pinterest.com/v5/pins', pinterestData, {
				headers: {
					'Authorization': `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}`,
					'Content-Type': 'application/json'
				}
			});

			return res.status(200).json({
				status: 'success',
				message: 'Successfully posted to Pinterest!',
				data: pinterestResponse.data
			});
		}

	} catch (error) {
		console.error("Pinterest Automation Error:", error);
		res.status(500).json({ status: 'fail', message: error.message });
	}
};

module.exports = { postChapterToPinterest };