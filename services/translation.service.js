const { GoogleGenAI } = require("@google/genai");
const Vocab = require("../models/Vocab");

// Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const translateChapter = async (chineseTitle, chineseContent, bookId, bookTitle) => {

	console.log("Translating...");

	// 1. Fetch Vocab
	const vocabDocs = await Vocab.find({ book: bookId });
	const vocabListString = vocabDocs
		.map(v => `"${v.original}" = "${v.translation}"`)
		.join("\n");

	// 2. Prepare Instructions
	const systemInstruction = `
													You are an expert translator specializing in Chinese-to-English literary translations, with a deep understanding of narrative flow, cultural nuances, and linguistic accuracy. Your goal is to produce translations that are faithful to the original text, capturing the author's intent, tone, and style without adding, omitting, or altering content unnecessarily.

													The translation must be natural, readable English that flows effortlessly like a professionally edited novel, requiring minimal post-translation edits.

													You are translating a Chinese language novel called "${bookTitle}" to English. You are to learn more about the universe and stay consistent in translating names, places, artefacts, superpowers etc.

													*** CRITICAL RULES ***
													1. **NO CENSORSHIP:** Translate all scenes, including combat, blood, or violence, exactly as written. Do not soften the tone.
													2. **NO SUMMARIZATION:** You are FORBIDDEN from summarizing. You must translate every single sentence line-by-line.
													3. **COMPLETENESS:** Do not stop until you reach the end of the text. If the chapter is long, write until it is finished.

													KEY GUIDELINES:
													- **Accuracy and Fidelity:** Translate word-for-word where possible without sacrificing natural English phrasing. Preserve idioms, metaphors, and cultural references by explaining them subtly in context if needed, but prioritize direct equivalence.
													- **Consistency:** Maintain strict consistency in proper nouns. If a term appears multiple times, use the same English rendering throughout.
													- **Flow and Readability:** Ensure the English reads smoothly, with effortless sentence structure and pacing that mirrors the original's rhythm. Avoid awkward phrasing; make dialogue sound natural and narrative descriptions vivid.
													- **Important! Punctuation:** Use commas instead of em-dashes (—) for interruptions, asides, or parenthetical elements. For example, change "He ran—heart pounding—through the forest" to "He ran, heart pounding, through the forest."
													- **Structure:** Preserve paragraph breaks and dialogue formatting. Do not add footnotes or extraneous commentary.
													- **Honorifics:** Use Chinese honorifics (e.g., -ge, -jie) in the English text where necessary.
													- **Formatting:** Leave all output in regular text. **No Bold text and No Italics.** Use standard English quotation marks (" ") for all spoken dialogue.

													VOCABULARY MANAGEMENT:
													Create a vocab list which would be used as a living document to maintain consistency. When you notice new, recurring names of characters or places please update the vocab.
													1. **Existing Vocab:** You MUST use the list below.
													2. **New Vocab (CRITICAL):** You MUST aggressively scan for ANY proper noun (Characters, Places, Powers, Titles, Artifacts) that is NOT in the existing list.
													3. If you encounter a name or term that appears new, you MUST add it to the output list. DO NOT ignore it.

													**PRIORITY VOCABULARY (Must Use):**
													${vocabListString || "No vocabulary established yet."}

													*** TECHNICAL OUTPUT FORMAT (REQUIRED) ***
													To ensure the system can save your work, you MUST format your response exactly using these tags:

													===TITLE===
													[English Title]
													===CONTENT===
													[Full Story Translation]
													===VOCAB===
													[Chinese]=[English]
													===END===
													`;

	// 3. RETRY LOOP (The "Self-Healing" Logic)
	let lastError = null;
	const MAX_ATTEMPTS = 5;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			if (attempt > 1) console.log(`   ↳ Attempt ${attempt}/${MAX_ATTEMPTS}: Retrying translation...`);

			// A. Make the Request
			const response = await ai.models.generateContent({
				model: "gemini-3-flash-preview", // or gemini-2.5-flash
				config: {
					systemInstruction: systemInstruction,
					temperature: 0.3,
					maxOutputTokens: 8192,
					// Safety Settings to prevent "Silent Blocks"
					safetySettings: [
						{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
						{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
						{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
						{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
					],
				},
				contents: [
					{
						role: 'user',
						parts: [
							{ text: `Title: ${chineseTitle}\n\nContent:\n${chineseContent}\n\n[TRANSLATE UNTIL THE END OF THE TEXT]` }
						]
					}
				]
			});

			// B. Extract Text
			let rawText = null;

			// Attempt 1: Use the SDK helper method (safely)
			if (response.text && typeof response.text === 'function') {
				try {
					rawText = response.text();
				} catch (err) {
					// If response was blocked, .text() might throw. We ignore and try manual extraction.
				}
			}

			// Attempt 2: Manual Extraction (Safe Mode)
			if (!rawText && response.candidates && response.candidates[0]) {
				// We use ?. to safely access parts[0]
				// If 'parts' is missing, this becomes undefined instead of crashing
				const candidate = response.candidates[0];
				rawText = candidate.content?.parts?.[0]?.text;
			}

			if (!rawText) throw new Error("Empty response from AI (Content might be blocked)");

			// C. THE NEW GUARD DOG: Check for the End Tag
			// If the AI didn't print ===END===, it was cut off. No guessing needed.
			if (!rawText.includes("===END===")) {
				// Fallback: Check length just in case it forgot the tag but finished the text
				// We bump the ratio to 1.5x to be stricter
				if (rawText.length < chineseContent.length * 1.5) {
					throw new Error("Truncation Detected: Missing ===END=== tag meaning the ai did not finish translating the text.");
				}
			}

			// D. Parse Tags
			const titleSplit = rawText.split('===TITLE===');
			if (titleSplit.length < 2) throw new Error("AI missed ===TITLE=== tag");

			const contentSplit = titleSplit[1].split('===CONTENT===');
			let translatedTitle = contentSplit[0].trim();

			// Clean Title
			translatedTitle = translatedTitle
				.replace(/^Chapter\s+\d+[:\.\s]*/i, "")
				.replace(/^Vol\w*\s+\d+[:\.\s]*/i, "")
				.trim();

			const vocabSplit = contentSplit[1].split('===VOCAB===');
			const translatedContent = vocabSplit[0].trim();

			// E. Parse Vocab (Only if validation passed)
			const newVocabItems = [];
			if (vocabSplit.length > 1) {
				// We split by ===END=== to ensure we don't grab garbage at the end
				const vocabSection = vocabSplit[1].split('===END===')[0];
				const vocabLines = vocabSection.trim().split('\n');

				vocabLines.forEach(line => {
					const separator = line.includes('=') ? '=' : 'translates as';
					if (line.includes(separator)) {
						const parts = line.split(separator);

						// --- FIX: Aggressively strip quotes from keys and values ---
						// We remove ", ', <, >, and smart quotes “ ”
						const original = parts[0].replace(/[<>“"”']/g, '').trim();
						const translation = parts[1].replace(/[<>“"”']/g, '').trim();

						// Only add if not empty
						if (original && translation) {
							newVocabItems.push({ original, translation });
						}
					}
				});
			}

			console.log("Translation successful 👍🏼");
			return {
				translatedTitle,
				translatedContent,
				newVocabItems
			};

		} catch (error) {
			lastError = error;
			console.warn(`   ⚠️ Attempt ${attempt} failed: ${error.message}`);
			// Loop will continue to next attempt...

			// --- SMART WAIT LOGIC ---
			// If we still have attempts left, we need to wait before retrying.
			if (attempt < MAX_ATTEMPTS) {
				let waitTime = 65000; // Default: Wait 65 seconds for truncation/glitches

				// If it's a Rate Limit (429) or Overload (503), wait MUCH longer
				if (error.message.includes("429") || error.message.includes("quota") || error.message.includes("503")) {
					console.log("   🛑 Rate Limit/Overload Hit. Cooling down for 60 seconds...");
					waitTime = 60000; // 1 Minute Wait
				}

				console.log(`   ⏳ Waiting ${waitTime / 1000}s before retry...`);
				await new Promise(resolve => setTimeout(resolve, waitTime));
			}
		}
	}

	// If we exit the loop, all 3 attempts failed
	console.error("All translation attempts failed.");
	throw new Error(`AI Translation failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError.message}`);
};

module.exports = { translateChapter };