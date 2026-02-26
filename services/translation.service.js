const { GoogleGenAI } = require("@google/genai");
const Vocab = require("../models/Vocab");

// --- CONFIGURATION ---
const PRIMARY_MODEL = "gemini-3-flash-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";

let primaryQuotaExhausted = false;

// Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Helper function
const escapeRegex = (str) => {
	if (typeof str !== "string") return "";
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// --- 1. NEW: AGGRESSIVE SANITIZATION ---
const sanitizeChineseText = (text) => {
	if (!text) return "";
	return text
		.replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width hidden characters
		.replace(/[a-zA-Z0-9.-]+\.com/gi, '') // Strip hidden URLs
		.replace(/(69书吧|69shuba|www\.69shuba\.com)/gi, '') // Strip anti-piracy tags
		.replace(/\(本章完\)\s*$/g, '') // End of chapter marks
		.replace(/(求|请).*?(票|收藏|推荐|支持|追读|打赏|点赞|月票|订阅).*$/g, '') // Begging for votes
		.trim();
};

// --- 2. NEW: DYNAMIC SEMANTIC CHUNKING ---
const chunkText = (text, maxChunkSize = 800) => {
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
			// Save the last ~200 chars to feed as context to the next chunk
			lastContext = currentChunk.slice(-200);
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

	const raw = line.trim();
	if (!raw) return null;

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
		const escapedOriginal = escapeRegex(original);
		if (original.length < 2) continue;
		if (!chineseSource.includes(original)) continue;

		const chineseRegex = new RegExp(escapedOriginal, 'g');
		const beforeFix = output;
		output = output.replace(chineseRegex, translation);

		if (output !== beforeFix) {
			corrections.push(`Fixed leaked Chinese: ${original} → ${translation}`);
		}
	}
	return { output, corrections };
};

const retryWithBackoff = async (fn, onLog, maxRetries = 3) => {
	let attempt = 0;
	let delay = 3000; // Start with a 3-second delay

	while (attempt <= maxRetries) {
		try {
			return await fn();
		} catch (e) {
			const status = e?.status;
			const message = e?.message || "";

			// Target capacity errors (503, 429) and our structural truncation errors
			const shouldRetry =
				status === 500 ||
				status === 503 ||
				status === 429 || // Too Many Requests
				message.includes("Truncation detected") ||
				/INTERNAL|UNAVAILABLE/i.test(message);

			if (shouldRetry && attempt < maxRetries) {
				attempt++;
				onLog("warning", `API busy or validation failed (${status || 'error'}). Retrying chunk (Attempt ${attempt}/${maxRetries}) in ${delay / 1000}s...`);

				await new Promise(r => setTimeout(r, delay));
				delay *= 2; // Double the delay for the next attempt (3s -> 6s -> 12s)
				continue;
			}

			// If we exhaust all retries or hit a fatal error (like 400 Bad Request), throw it
			throw e;
		}
	}
};

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

const translateChapter = async (chineseTitle, chineseContent, bookId, bookTitle, onLog = () => { }, signal = null) => {

	const getRawText = (response) => {
		let rawText = null;
		if (response.text && typeof response.text === 'function') {
			try { rawText = response.text(); } catch (err) { }
		}
		if (!rawText && response.candidates && response.candidates[0]) {
			rawText = response.candidates[0].content?.parts?.[0]?.text;
		}
		return rawText || "";
	};

	const callAI = async (prompt, systemInstruction) => {
		if (signal?.aborted) throw new Error("ABORTED_BY_CLIENT");

		const performRequest = async (modelName) => {
			return await ai.models.generateContent({
				model: modelName,
				config: {
					systemInstruction,
					temperature: 0.1, // Slightly raised from 0.0 to prevent severe repetitive loops, but still highly deterministic
					maxOutputTokens: 8192,
				},
				contents: [{ role: 'user', parts: [{ text: prompt }] }]
			});
		};

		if (primaryQuotaExhausted) {
			try {
				const response = await performRequest(FALLBACK_MODEL);
				return getRawText(response).trim();
			} catch (error) {
				throw error;
			}
		}

		try {
			const response = await performRequest(PRIMARY_MODEL);
			return getRawText(response).trim();
		} catch (error) {
			if (signal?.aborted) throw new Error("ABORTED_BY_CLIENT");
			const isQuotaError = error?.status === 429 || error?.code === 429 || /quota|exhausted|rate/i.test(error.message || "");

			if (isQuotaError) {
				primaryQuotaExhausted = true;
				onLog("warning", `${PRIMARY_MODEL} quota exceeded. Switching to ${FALLBACK_MODEL}.`);
				try {
					const response = await performRequest(FALLBACK_MODEL);
					return getRawText(response).trim();
				} catch (fallbackError) {
					throw fallbackError;
				}
			}
			throw error;
		}
	};

	const callAIWithContext = async (context, mainText, systemInstruction) => {
		return callAI(
			`PREVIOUS CONTEXT (DO NOT TRANSLATE THIS):\n${context}\n\nTEXT TO TRANSLATE:\n${mainText}`,
			systemInstruction
		);
	};

	try {
		onLog("info", `Processing Chapter...`);
		const { vocabDocs } = await getVocabData(bookId);

		// Sanitize first so our Pre-Flight scanner doesn't read garbage HTML
		onLog("info", "Sanitizing source text...");
		const normalizedContent = sanitizeChineseText(normalizeChapterInput(chineseTitle, chineseContent));

		// --- NEW: STEP 1 (PRE-FLIGHT VOCAB EXTRACTION) ---
		onLog("info", "Pre-flight: Scanning for new terminology...");
		const extractionInstruction = `Extract NEW proper nouns (Characters, Places, Sects, Martial Arts, Titles/Professions) from this Xianxia text.
Format: Chinese=English (one per line).
Do NOT include or overwrite these existing terms: ${vocabDocs.map(v => v.original).join(',')}`;

		const extractedNewVocab = [];
		const newVocabSet = new Set();

		try {
			// Send just the first 1500 characters to cheaply identify the core entities of the chapter
			const newVocabRaw = await retryWithBackoff(() => callAI(normalizedContent.slice(0, 1500), extractionInstruction), onLog);
			const lines = newVocabRaw.split('\n');

			for (const line of lines) {
				const parsed = parseVocabLine(line, () => { });
				if (parsed && !newVocabSet.has(parsed.original) && !vocabDocs.find(v => v.original === parsed.original)) {
					newVocabSet.add(parsed.original);
					extractedNewVocab.push(parsed);
				}
			}
			onLog("info", `Pre-flight found ${extractedNewVocab.length} new terms.`);
		} catch (e) {
			onLog("warning", "Pre-flight vocab extraction failed. Proceeding with existing DB vocab.");
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

		const translatedTitleRaw = await retryWithBackoff(() => callAI(chineseTitle, metaInstruction), onLog);

		// Enforce using the Master List
		const { output: fixedTitle } = enforceCanonicalVocab(translatedTitleRaw, masterVocabList, chineseTitle);
		const cleanedTitle = fixedTitle.replace(/^chapter\s*\d+:?\s*/i, '').trim();


		// --- STEP 4: TRANSLATE PROSE (Using Master Vocab) ---
		onLog("info", "Chunking prose...");
		const chunks = chunkText(normalizedContent, 800);
		onLog("info", `Chapter split into ${chunks.length} safe chunks.`);

		let finalTranslatedChunks = [];

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			onLog("info", `Translating Chunk ${i + 1}/${chunks.length}...`);

			// Inject ONLY the vocab that appears in this specific 800-character chunk
			const activeChunkVocab = masterVocabList.filter(v => chunk.text.includes(v.original));
			const activeChunkVocabString = activeChunkVocab.map(v => `${v.original}=${v.translation}`).join('\n');

			const proseVocabSection = activeChunkVocabString ? `MANDATORY TERMINOLOGY:\nYou MUST use these exact translations:\n${activeChunkVocabString}\n\n` : '';

			const proseInstruction = `You are a professional literary translator for a Xianxia web novel.
${proseVocabSection}CONSTRAINTS:
- Translate paragraph by paragraph. Do NOT summarize. Do NOT skip sentences.
- Output ONLY the translated story prose.
- Maintain a natural, literary English flow.`;

			const translateAttempt = async () => {
				let result;
				if (chunk.context) {
					result = await callAIWithContext(chunk.context, chunk.text, proseInstruction);
				} else {
					result = await callAI(chunk.text, proseInstruction);
				}

				const transParas = result.split(/\n\s*\n|\n/).filter(p => p.trim()).length;
				if (transParas < chunk.paraCount * 0.75) {
					throw new Error(`Truncation detected: Model returned ${transParas} paragraphs, expected ~${chunk.paraCount}.`);
				}
				return result;
			};

			let translatedChunk = await retryWithBackoff(translateAttempt, onLog);
			finalTranslatedChunks.push(translatedChunk);
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

		return {
			translatedTitle: cleanedTitle,
			translatedContent: finalCleanedContent,
			newVocabItems: extractedNewVocab // Return the Pre-Flight terms so your controller saves them
		};

	} catch (error) {
		if (error.message === "ABORTED_BY_CLIENT") throw error;
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