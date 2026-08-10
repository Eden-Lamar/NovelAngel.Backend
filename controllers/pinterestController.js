const Book = require('../models/Book');
const Chapter = require('../models/Chapter');
const puppeteer = require('puppeteer');
const axios = require('axios'); // Ensure axios is installed
const { OpenAI } = require('openai')

// @description: Generate recap, create image, and post to Pinterest
// @route POST /api/v1/books/:bookId/chapters/:chapterId/pinterest
// @access private (Admin only)
const postChapterToPinterest = async (req, res) => {
    try {
        const { bookId, chapterId } = req.params;

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

        // Initialize OpenAI client pointing to Kimi (Moonshot AI)
        const openai = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: "https://openrouter.ai/api/v1",
        });

        // 3. Call LLM to generate the 4-sentence formula
        // Replace with your preferred LLM API (OpenAI, Gemini, Anthropic)
        const llmPrompt = `
				You are a dramatic marketing copywriter for a web novel app.
        Summarize the following chapter text into a strict 4-sentence formula:
        1. Opening Hook (High-impact drama, mention "male lead/female lead" instead of names if needed)
        2. Beginning (Setup of the scene)
        3. Middle (The rising action or conflict)
        4. End (The cliffhanger or emotional peak)
        
        Chapter Text: ${chapter.content}
        `;

        const llmResponse = await openai.chat.completions.create({
            model: "openai/gpt-oss-20b:free", // or "kimi-k2.5" depending on their current endpoint names
            messages: [
                { role: "system", content: "You strictly follow formatting rules without adding conversational filler." },
                { role: "user", content: llmPrompt }
            ],
            temperature: 0.7, // Keeps it dramatic but focused
        });

        const recapText = llmResponse.choices[0].message.content.trim(); // Adjust based on LLM response structure
        console.log("Generated Recap:", recapText);

        // // 4. Generate Image using Puppeteer
        // const browser = await puppeteer.launch();
        // const page = await browser.newPage();

        // // Set viewport for Pinterest standard pin size (1000x1500)
        // await page.setViewport({ width: 1000, height: 1500, deviceScaleFactor: 2 });

        // // HTML/CSS for the Dark Mode Image
        // const htmlContent = `
        //     <html>
        //         <head>
        //             <style>
        //                 body {
        //                     background-color: #1a1b23;
        //                     color: #ffffff;
        //                     font-family: 'Georgia', serif;
        //                     padding: 80px;
        //                     display: flex;
        //                     flex-direction: column;
        //                     justify-content: center;
        //                     height: 100%;
        //                     box-sizing: border-box;
        //                 }
        //                 .book-title {
        //                     font-size: 32px;
        //                     color: #FFD700;
        //                     margin-bottom: 20px;
        //                     text-transform: uppercase;
        //                     letter-spacing: 2px;
        //                 }
        //                 .recap-text {
        //                     font-size: 48px;
        //                     line-height: 1.6;
        //                 }
        //                 .highlight {
        //                     color: #06b6d4; /* Cyan 500 */
        //                     font-weight: bold;
        //                 }
        //                 .footer {
        //                     margin-top: auto;
        //                     font-size: 28px;
        //                     color: #888;
        //                     border-top: 1px solid #333;
        //                     padding-top: 20px;
        //                 }
        //             </style>
        //         </head>
        //         <body>
        //             <div class="book-title">Chapter ${chapter.chapterNo}: ${chapter.title}</div>
        //             <div class="recap-text">${recapText.replace(/\n/g, '<br/>')}</div>
        //             <div class="footer">Read now at yourwebsite.com/${book.slug}</div>
        //         </body>
        //     </html>
        // `;

        // await page.setContent(htmlContent);
        // const imageBuffer = await page.screenshot({ type: 'jpeg', quality: 90 });
        // await browser.close();

        // // 5. Upload Image and Post to Pinterest
        // // Note: You must convert the buffer to base64 or upload to a CDN (like AWS S3/Cloudinary) first, 
        // // as Pinterest API requires an image URL or media_id.
        // const base64Image = imageBuffer.toString('base64');

        // const pinterestData = {
        //     board_id: process.env.PINTEREST_BOARD_ID,
        //     media_source: {
        //         source_type: "image_base64",
        //         content_type: "image/jpeg",
        //         data: base64Image
        //     },
        //     title: `${book.title} - Chapter ${chapter.chapterNo}`,
        //     description: recapText,
        //     link: `https://yourwebsite.com/books/${book.slug}/read?chapterNo=${chapter.chapterNo}`
        // };

        // const pinterestResponse = await axios.post('https://api.pinterest.com/v5/pins', pinterestData, {
        //     headers: {
        //         'Authorization': `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}`,
        //         'Content-Type': 'application/json'
        //     }
        // });

        // res.status(200).json({
        //     status: 'success',
        //     message: 'Successfully posted to Pinterest!',
        //     data: pinterestResponse.data
        // });

    } catch (error) {
        console.error("Pinterest Automation Error:", error);
        res.status(500).json({ status: 'fail', message: error.message });
    }
};

module.exports = { postChapterToPinterest };