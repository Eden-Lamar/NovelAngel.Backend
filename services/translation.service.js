const { OpenAI } = require("openai");
const Vocab = require("../models/Vocab");

// --- CONFIGURATION ---
const PRIMARY_MODEL = "deepseek/deepseek-v4-flash-0731";
// const FALLBACK_MODEL = "gemini-2.5-flash";

let primaryQuotaExhausted = false;


// Initialize the OpenAI client pointing to OpenRouter
const openai = new OpenAI({
	baseURL: "https://openrouter.ai/api/v1",
	apiKey: process.env.OPENROUTER_API_KEY,
	// Optional: Add default max retries to let the SDK handle network blips
	maxRetries: 3,
});

// Initialize the client
// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Helper function
const escapeRegex = (str) => {
	if (typeof str !== "string") return "";
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};


// More reliable paragraph counting (prefers real paragraph breaks)
const countParagraphs = (text) => {
	if (!text) return 0;
	return text
		.split(/\n\s*\n/)                 // Prefer double newlines
		.map(p => p.trim())
		.filter(p => p.length > 0).length;
};

// Normalize text for fuzzy glossary matching
const normalizeForMatch = (str) => {
	if (!str) return "";
	return str
		.toLowerCase()
		.replace(/[-–—]/g, " ")
		.replace(/[^\w\s\u4e00-\u9fff]/g, "") // keep Chinese + alphanumeric
		.replace(/\s+/g, " ")
		.trim();
};

// --- 1. NEW: AGGRESSIVE SANITIZATION ---
const sanitizeChineseText = (text) => {
	if (!text) return "";
	return text
		.replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width hidden characters
		.replace(/[a-zA-Z0-9.-]+\.com/gi, '') // Strip hidden URLs
		.replace(/(69书吧|69shuba|www\.69shuba\.com)/gi, '') // Strip anti-piracy tags
		// Remove "本章完" and similar end markers
		.replace(/\(本章完\)\s*$/g, '')
		.replace(/（本章完）\s*$/g, '')
		.replace(/正文完\s*$/g, '')

		// Remove common author note / outbound commentary blocks
		// This targets the typical "author speaking" section at the end
		.replace(/(?:又是一年|三年后的生日|男女主个性|字数差不多|后面白就用来存稿|正式连载|看到觉得喜欢的请收藏|么么哒|啦啦啦)[\s\S]*$/gi, '')

		// Broader cleanup for vote / collection begging
		.replace(/(求|请|感谢|谢谢|喜欢的话).*?(票|收藏|推荐|支持|追读|打赏|点赞|月票|订阅|收藏).*?$/gm, '')

		// Remove leftover decorative lines or separators often used before author notes
		.replace(/^[—–\-_=]{2,}\s*$/gm, '')

		.trim();
};

const removeAuthorNotes = (text) => {
	// Common patterns that usually indicate the start of an author note
	const authorNoteMarkers = [
		/又是一年/,
		/男女主/,
		/字数差不多/,
		/后面.*存稿/,
		/正式连载/,
		/请收藏/,
		/么么哒/,
		/啦啦啦/,
		/作者有话/,
		/作者的话/,
		/感言/,
	];

	for (const marker of authorNoteMarkers) {
		const match = text.search(marker);
		if (match > 0) {
			// Only cut if the marker appears in the last 15% of the text
			if (match > text.length * 0.85) {
				return text.slice(0, match).trim();
			}
		}
	}

	return text;
};

// --- 2. NEW: DYNAMIC SEMANTIC CHUNKING ---
const chunkText = (text, maxChunkSize = 2500) => {
	// Split by double newline or single newline to isolate paragraphs
	const paragraphs = text.split(/\n\s*\n|\n/);
	const chunks = [];
	let currentChunk = "";
	let lastContext = "";
	let currentParaCount = 0;

	for (const p of paragraphs) {
		const trimmed = p.trim();
		if (!trimmed) continue;

		if ((currentChunk.length + trimmed.length) > maxChunkSize && currentChunk.length > 0) {
			chunks.push({
				text: currentChunk.trim(),
				context: lastContext,
				paraCount: currentParaCount
			});
			// Save the last ~300 chars to feed as context to the next chunk
			lastContext = currentChunk.slice(-300);
			currentChunk = trimmed + "\n";
			currentParaCount = 1;
		} else {
			currentChunk += trimmed + "\n";
			currentParaCount++;
		}
	}

	if (currentChunk.trim()) {
		chunks.push({
			text: currentChunk.trim(),
			context: lastContext,
			paraCount: currentParaCount
		});
	}

	return chunks;
};

const parseVocabLine = (line, onLog) => {
	if (!line || typeof line !== "string") return null;

	let raw = line.trim();
	if (!raw) return null;

	// NEW: Strip markdown bullets or numbered lists just in case the AI disobeys
	raw = raw.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').trim();

	if (/^[^=]+=[^=]+$/.test(raw)) {
		const idx = raw.indexOf('=');
		return {
			original: raw.slice(0, idx).trim(),
			translation: raw.slice(idx + 1).trim(),
			fixed: false
		};
	}

	const sepMatch = raw.match(/^(.+?)\s*(?:-|–|—|:)\s*(.+)$/);
	if (sepMatch) {
		return {
			original: sepMatch[1].trim(),
			translation: sepMatch[2].trim(),
			fixed: true
		};
	}

	const heuristic = raw.match(/^([\u4e00-\u9fff]{2,})\s+(.+)$/);
	if (heuristic && heuristic[2].length >= 2) {
		return {
			original: heuristic[1].trim(),
			translation: heuristic[2].trim(),
			fixed: true
		};
	}
	return null;
};

const enforceCanonicalVocab = (text, vocabDocs, chineseSource) => {
	let output = text;
	const corrections = [];

	const sorted = [...vocabDocs].sort(
		(a, b) => b.original.length - a.original.length
	);

	for (const { original, translation } of sorted) {
		if (original.length < 2) continue;
		if (!chineseSource.includes(original)) continue;

		// 1. Always fix leaked Chinese characters
		const escapedOriginal = escapeRegex(original);
		const chineseRegex = new RegExp(escapedOriginal, "g");
		const beforeFix = output;
		output = output.replace(chineseRegex, translation);

		if (output !== beforeFix) {
			corrections.push(`Fixed leaked Chinese: ${original} → ${translation}`);
		}

		// 2. Soft English enforcement (only log major mismatches, don't force awkwardly)
		// We no longer hard-replace English variants to avoid fighting natural translation
	}

	return { output, corrections };
};

// const retryWithBackoff = async (fn, onLog, maxRetries = 3) => {
// 	let attempt = 0;
// 	let delay = 3000; // Start with a 3-second delay

// 	while (attempt <= maxRetries) {
// 		try {
// 			return await fn();
// 		} catch (e) {
// 			const status = e?.status;
// 			const message = e?.message || "";

// 			// Target capacity errors (503, 429) and our structural truncation errors
// 			const shouldRetry =
// 				status === 500 ||
// 				status === 503 ||
// 				status === 429 || // Too Many Requests
// 				message.includes("Truncation detected") ||
// 				/INTERNAL|UNAVAILABLE/i.test(message);

// 			if (shouldRetry && attempt < maxRetries) {
// 				attempt++;
// 				onLog("warning", `API busy or validation failed (${status || 'error'}). Retrying chunk (Attempt ${attempt}/${maxRetries}) in ${delay / 1000}s...`);

// 				await new Promise(r => setTimeout(r, delay));
// 				delay *= 2; // Double the delay for the next attempt (3s -> 6s -> 12s)
// 				continue;
// 			}

// 			// If we exhaust all retries or hit a fatal error (like 400 Bad Request), throw it
// 			throw e;
// 		}
// 	}
// };

const normalizeChapterInput = (title, content) => {
	const escapedTitle = escapeRegex(title);
	return content
		.replace(new RegExp(`^\\s*${escapedTitle}\\s*\\n?`), '')
		.replace(/^\s*第\s*[一二三四五六七八九十百千\d]+\s*章[·.\- ]*[^\n]*\n?/, '')
		.trim();
}

const vocabCache = new Map();

const getVocabData = async (bookId) => {
	if (vocabCache.has(bookId)) {
		return vocabCache.get(bookId);
	}
	const vocabDocs = await Vocab.find({ book: bookId });
	const vocabString = vocabDocs.map(v => `${v.original}=${v.translation}`).join('\n');
	const data = { vocabDocs, vocabString };
	vocabCache.set(bookId, data);
	return data;
};

const translateChapter = async (chineseTitle, chineseContent, bookId, bookTitle, onLog = () => { }) => {

	// const getRawText = (response) => {
	// 	let rawText = null;
	// 	if (response.text && typeof response.text === 'function') {
	// 		try { rawText = response.text(); } catch (err) { }
	// 	}
	// 	if (!rawText && response.candidates && response.candidates[0]) {
	// 		rawText = response.candidates[0].content?.parts?.[0]?.text;
	// 	}
	// 	return rawText || "";
	// };

	// --- NEW: OPENAI SDK API CALL ---
	const callAI = async (prompt, systemInstruction) => {
		const response = await openai.chat.completions.create({
			model: PRIMARY_MODEL,
			temperature: 0.1,
			max_tokens: 8192,
			messages: [
				{ role: "system", content: systemInstruction },
				{ role: "user", content: prompt }
			]
		});

		// PATCH: Safely fallback to an empty string if OpenRouter returns null content
		const content = response.choices[0]?.message?.content || "";
		return content.trim();
	};

	const callAIWithContext = async (context, mainText, systemInstruction) => {
		return callAI(`PREVIOUS CONTEXT (DO NOT TRANSLATE):\n${context}\n\nTEXT TO TRANSLATE:\n${mainText}`, systemInstruction);
	};


	try {
		onLog("info", `Processing Chapter with DeepSeek V4 Flash...`);
		const { vocabDocs } = await getVocabData(bookId);

		// Sanitize first so our Pre-Flight scanner doesn't read garbage HTML
		onLog("info", "Sanitizing source text...");
		const normalizedContent = removeAuthorNotes(sanitizeChineseText(normalizeChapterInput(chineseTitle, chineseContent)));

		// --- NEW: STEP 1 (PRE-FLIGHT VOCAB EXTRACTION) ---
		onLog("info", "Pre-flight: Scanning for new terminology...");

		// Only tell it to exclude terms if we actually have terms to exclude
		const excludeText = vocabDocs.length > 0
			? `\nDo NOT include or overwrite these existing terms: ${vocabDocs.map(v => v.original).join(', ')}`
			: '';

		// Stricter prompt forbidding markdown
		const extractionInstruction = `Extract NEW proper nouns (Characters, Places, Organizations, Titles, and important Nicknames or terms of address) from this text.
Format STRICTLY as: Chinese=English (one per line).
For nicknames and terms of endearment, prefer natural English renderings that can function well as names or forms of address, rather than awkward literal translations.
OUTPUT ONLY THE PAIRS. No markdown, no bullet points, no introductory text.${excludeText}`;

		const extractedNewVocab = [];
		const newVocabSet = new Set();

		try {
			// Send just the first 2000 characters to cheaply identify the core entities of the chapter
			const newVocabRaw = await callAI(normalizedContent.slice(0, 2000), extractionInstruction);
			// // DEBUG: Let's see exactly what DeepSeek is returning!
			// onLog("info", `--- RAW AI VOCAB OUTPUT START ---\n${newVocabRaw}\n--- RAW AI VOCAB OUTPUT END ---`);

			const lines = newVocabRaw.split('\n');

			for (const line of lines) {
				// Aggressively strip bolding, italics, backticks, and extra spaces
				const cleanedLine = line.replace(/[*`_]/g, '').trim();

				const parsed = parseVocabLine(cleanedLine, onLog);
				if (parsed && !newVocabSet.has(parsed.original) && !vocabDocs.find(v => v.original === parsed.original)) {
					newVocabSet.add(parsed.original);
					extractedNewVocab.push(parsed);
				}
			}
			onLog("info", `Pre-flight found ${extractedNewVocab.length} new terms.`);
		} catch (e) {
			onLog("warning", `Pre-flight vocab extraction failed: ${e.message}. Proceeding with existing DB vocab.`);
		}

		// --- NEW: STEP 2 (MERGE INTO MASTER VOCAB LIST) ---
		// Combine the database terms with the newly discovered terms BEFORE translating anything
		const masterVocabList = [...vocabDocs, ...extractedNewVocab];


		// --- STEP 3: TRANSLATE TITLE (Using Master Vocab) ---
		onLog("info", "Translating title...");

		// Inject only the terms that actually appear in the title to keep the prompt light
		const activeTitleVocab = masterVocabList.filter(v => chineseTitle.includes(v.original));
		const titleVocabString = activeTitleVocab.map(v => `${v.original}=${v.translation}`).join('\n');

		const titleVocabSection = titleVocabString ? `MANDATORY TERMINOLOGY:\nYou MUST use these exact translations if they appear:\n${titleVocabString}\n\n` : '';
		const metaInstruction = `Translate the chapter title into natural English for the novel "${bookTitle}".\n${titleVocabSection}Output ONLY the translated title. No chapter numbers.`;

		const translatedTitleRaw = await callAI(chineseTitle, metaInstruction);

		// Enforce using the Master List
		const { output: fixedTitle } = enforceCanonicalVocab(translatedTitleRaw, masterVocabList, chineseTitle);
		const cleanedTitle = fixedTitle.replace(/^chapter\s*\d+:?\s*/i, '').trim();


		// --- STEP 4: TRANSLATE PROSE (Using Master Vocab) ---
		onLog("info", "Chunking prose...");
		const chunks = chunkText(normalizedContent, 2500);
		onLog("info", `Chapter split into ${chunks.length} safe chunks.`);

		let finalTranslatedChunks = [];

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			onLog("info", `Translating Chunk ${i + 1}/${chunks.length}...`);

			// Inject ONLY the vocab that appears in this specific 2500-character chunk
			const activeChunkVocab = masterVocabList.filter(v => chunk.text.includes(v.original));
			const activeChunkVocabString = activeChunkVocab.map(v => `${v.original}=${v.translation}`).join('\n');

			const proseVocabSection = activeChunkVocabString ? `MANDATORY TERMINOLOGY:\nYou MUST use these exact translations:\n${activeChunkVocabString}\n\n` : '';

			const proseInstruction = `You are a professional literary translator specializing in Chinese web novels (including contemporary, urban, suspense, romance, and xianxia).

${proseVocabSection}CORE RULES:
- Translate paragraph by paragraph. Do NOT summarize, skip, or merge content unnecessarily.
- Output ONLY the translated story prose. No explanations, notes, or comments.
- Prioritize natural, fluent, and elegant literary English over literal word-for-word translation.
- Preserve the original tone, atmosphere, and narrative voice exactly (sweet, cold, eerie, humorous, violent, tender, etc.).
- When the original creates a specific mood (especially eerie, unsettling, sarcastic, or intimate), actively maintain that mood in English.

NAME & TERM HANDLING:
- Always use the mandatory terminology provided.
- For pet names, nicknames, and terms of endearment, render them naturally in English. Prefer forms that work well as names or natural address, and avoid awkward literal translations.
- Keep each character’s voice consistent.

STYLE GUIDELINES:
- Avoid stiff or overly literal phrasing. Prefer what a skilled English novelist would write.
- Dialogue should sound natural when spoken aloud.
- Action scenes should be sharp and clear.
- Emotional or atmospheric scenes should retain their original impact.
- Do not flatten distinctive stylistic choices from the Chinese text.

When in doubt, choose the version that reads most naturally in English while staying faithful to the meaning and tone.`;

			// Simplified structural error handling loop
			let attempt = 0;
			let chunkSuccess = false;

			while (!chunkSuccess && attempt < 3) {
				try {
					let result = chunk.context
						? await callAIWithContext(chunk.context, chunk.text, proseInstruction)
						: await callAI(chunk.text, proseInstruction);

					const transParas = countParagraphs(result);
					const minAcceptable = Math.floor(chunk.paraCount * 0.50);

					if (transParas < minAcceptable) {
						throw new Error(`Truncation detected: Returned ${transParas} paragraphs, expected ~${chunk.paraCount}.`);
					}

					finalTranslatedChunks.push(result);
					chunkSuccess = true;
				} catch (e) {
					attempt++;
					if (attempt >= 3) throw e;
					onLog("warning", `Truncation validation failed. Retrying Chunk ${i + 1} (Attempt ${attempt}/3)...`);
				}
			}
		}

		onLog("info", "Translation successful 👍🏼 Combining chunks...");
		let combinedContent = finalTranslatedChunks.join('\n\n');

		// Final enforcement across all combined chunks
		const { output: enforcedContent, corrections } = enforceCanonicalVocab(combinedContent, masterVocabList, normalizedContent);
		if (corrections.length > 0) {
			onLog("warning", `🔧 Fixed ${corrections.length} leaked Chinese terms post-translation.`);
		}

		// Punctuation Cleanup (Em-dash replacement)
		const finalCleanedContent = enforcedContent.replace(/\s*(—|–|--)\s*/g, ', ');

		// --- STEP 4: THE QUALITY SCORING ENGINE ---
		onLog("info", "Calculating Translation Quality Score...");
		let qualityScore = 100;
		const scoreReasons = [];

		const expectedParas = chunks.reduce((sum, chunk) => sum + chunk.paraCount, 0);
		const actualParas = countParagraphs(finalCleanedContent);
		const paraDiff = Math.abs(expectedParas - actualParas);

		if (paraDiff > 0) {
			const penalty = Math.min(paraDiff * 1.2, 18); // Cap + softer
			qualityScore -= penalty;
			scoreReasons.push(`Structure Penalty (-${penalty}): Expected ~${expectedParas} paragraphs, got ${actualParas}.`);
		}

		const chineseCharacters = finalCleanedContent.match(/[\u4e00-\u9fa5]/g) || [];
		if (chineseCharacters.length > 0) {
			const penalty = chineseCharacters.length * 2; // -2 points per untranslated character
			qualityScore -= penalty;
			scoreReasons.push(`Translation Penalty (-${penalty}): Found ${chineseCharacters.length} untranslated Chinese characters.`);
		}

		// Check C: Glossary Adherence (Now explicitly naming missed terms!)
		const usedVocab = masterVocabList.filter(v => normalizedContent.includes(v.original));
		const missedTerms = [];
		const missedTermsData = [];

		const contentNormalized = normalizeForMatch(finalCleanedContent);
		const chineseParagraphs = normalizedContent.split(/\n\s*\n/).filter(p => p.trim());

		usedVocab.forEach(v => {
			const target = normalizeForMatch(v.translation);

			// Accept common variants
			const variants = [
				target,
				target.replace(/\s+/g, ""),          // AnXun
				target.replace(/\s+/g, "-"),         // An-Xun
				target.replace(/\s+/g, ""),
			];

			const found = variants.some(variant => contentNormalized.includes(variant));

			if (!found) {
				const foundInParas = [];
				chineseParagraphs.forEach((para, index) => {
					if (para.includes(v.original)) foundInParas.push(index + 1);
				});

				missedTermsData.push({
					term: v.translation,
					paragraphs: foundInParas
				});

				const locationStr = foundInParas.length > 0 ? ` (Para ${foundInParas.join(", ")})` : "";
				missedTerms.push(`"${v.translation}"${locationStr}`);
			}
		});


		if (missedTerms.length > 0) {
			const penalty = Math.min(missedTerms.length * 3, 15); // -4 points per missed glossary term Softer + capped
			qualityScore -= penalty;
			scoreReasons.push(`Glossary Penalty (-${penalty}): Missed ${missedTerms.length} term(s) → ${missedTerms.join(", ")} from the vocabulary database.`);
		}

		qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));

		return {
			translatedTitle: cleanedTitle,
			translatedContent: finalCleanedContent,
			newVocabItems: extractedNewVocab, // Return the Pre-Flight terms so your controller saves them
			qualityScore,
			scoreReasons,
			missedTermsData
		};

	} catch (error) {
		onLog("error", `Agent Error: ${error.message}`);
		throw error;
	}
};

const clearVocabCache = (bookId) => {
	vocabCache.delete(bookId);
};

const resetModelQuotaState = () => {
	primaryQuotaExhausted = false;
};

module.exports = { translateChapter, clearVocabCache, resetModelQuotaState };