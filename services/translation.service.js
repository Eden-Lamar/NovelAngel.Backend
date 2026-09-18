const { OpenAI } = require("openai");
const Vocab = require("../models/Vocab");

// --- CONFIGURATION ---
const PRIMARY_MODEL = "deepseek/deepseek-v4-flash-0731"; // , "deepseek/deepseek-v4-flash-0731", "deepseek/deepseek-v4-pro-0813", "google/gemini-3.8-flash", "moonshotai/kimi-k3"
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
		.split(/\n+/) // Split by any number of consecutive newlines
		.map(p => p.trim())
		.filter(p => p.length > 0).length;
};

// DYNAMIC SEMANTIC CHUNKING
const chunkText = (text, maxChunkSize = 2500) => {
	// Split consistently by any newline
	const paragraphs = text.split(/\n+/);
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
			lastContext = currentChunk.slice(-180);
			currentChunk = trimmed + "\n\n"; // Standardize to double newlines for output
			currentParaCount = 1;
		} else {
			currentChunk += trimmed + "\n\n";
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

const NAME_PARTICLES = /^(Mc|Mac|De|Da|Di|Du|Van|Von|La|Le|O|St|Des|Del|Della)$/;

const normalizeSpacedPinyin = (text, protectedTerms = []) => {
	if (!text) return text;

	// Build a set of exact canonical forms we must never touch
	const protectedSet = new Set(
		protectedTerms
			.flatMap(t => String(t).split(/\s+/))
			.filter(Boolean)
	);

	return text.replace(/\b([A-Z][a-z]+)([A-Z][a-z]+)\b/g, (match, a, b) => {
		if (protectedSet.has(match)) return match;   // exact glossary token
		if (NAME_PARTICLES.test(a)) return match;    // McKinney, DeAndre, LaMarcus
		return `${a} ${b}`;
	});
};

const looksAbruptlyCut = (text) => {
	const t = (text || "").trim();
	if (!t) return true;

	const lastLine = t.split(/\n+/).filter(Boolean).pop() || "";
	const lastChar = t.slice(-1);

	// Ends mid-word / mid-clause
	if (/[A-Za-z0-9]$/.test(lastChar) && !/[.!?”"’'~…]/.test(lastChar)) return true;

	// Short trailing line that looks incomplete
	if (
		lastLine.length < 40 &&
		!/[.!?”"’]$/.test(lastLine) &&
		/\b(heard|said|opened|looked|was|were|the|a|an|to|of|and)\b/i.test(lastLine)
	) {
		return true;
	}

	return false;
};


const removeNearDuplicateParagraphs = (text) => {
	const paras = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
	const result = [];
	const recentParas = []; // Keep track of last 10 paragraphs
	let duplicateCount = 0;

	for (const p of paras) {
		// Extract significant words (4+ letters) for comparison
		const words = p.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];

		// If it's a very short line (like dialogue), skip deep comparison
		if (words.length < 3) {
			result.push(p);
			recentParas.push({ text: p, words: new Set(words) });
			if (recentParas.length > 10) recentParas.shift();
			continue;
		}

		const wordSet = new Set(words);
		let isDuplicate = false;

		for (const recent of recentParas) {
			if (recent.words.size < 3) continue;

			let overlap = 0;
			for (const w of wordSet) {
				if (recent.words.has(w)) overlap++;
			}

			// Calculate Jaccard Similarity (Overlap / Total Unique Words)
			const union = new Set([...wordSet, ...recent.words]).size;
			const similarity = overlap / union;

			// If they share more than 50% of significant words, it's a ghost duplicate
			if (similarity > 0.50) {
				isDuplicate = true;
				break;
			}
		}

		if (isDuplicate) {
			duplicateCount++;
		} else {
			result.push(p);
			recentParas.push({ text: p, words: wordSet });
			if (recentParas.length > 10) recentParas.shift();
		}
	}

	return { cleanedText: result.join('\n\n'), duplicateCount };
};


// // --- 2. NEW: DYNAMIC SEMANTIC CHUNKING ---
// const chunkText = (text, maxChunkSize = 2500) => {
// 	// Split by double newline or single newline to isolate paragraphs
// 	const paragraphs = text.split(/\n\s*\n|\n/);
// 	const chunks = [];
// 	let currentChunk = "";
// 	let lastContext = "";
// 	let currentParaCount = 0;

// 	for (const p of paragraphs) {
// 		const trimmed = p.trim();
// 		if (!trimmed) continue;

// 		if ((currentChunk.length + trimmed.length) > maxChunkSize && currentChunk.length > 0) {
// 			chunks.push({
// 				text: currentChunk.trim(),
// 				context: lastContext,
// 				paraCount: currentParaCount
// 			});
// 			// Save the last ~300 chars to feed as context to the next chunk
// 			lastContext = currentChunk.slice(-180);
// 			currentChunk = trimmed + "\n";
// 			currentParaCount = 1;
// 		} else {
// 			currentChunk += trimmed + "\n";
// 			currentParaCount++;
// 		}
// 	}

// 	if (currentChunk.trim()) {
// 		chunks.push({
// 			text: currentChunk.trim(),
// 			context: lastContext,
// 			paraCount: currentParaCount
// 		});
// 	}

// 	return chunks;
// };

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

		// 2. Normalize common English variants of the forced term
		// Only do this for clean English terms (names, titles, etc.)
		if (/^[a-zA-Z0-9\s\-']+$/.test(translation)) {
			const escapedTranslation = escapeRegex(translation);

			// Match common variations: different spacing, hyphens, or case
			const variantRegex = new RegExp(
				`\\b${escapedTranslation.replace(/\s+/g, '[\\s\\-]*')}\\b`,
				"gi"
			);

			const beforeEnglish = output;
			output = output.replace(variantRegex, translation);

			if (output !== beforeEnglish) {
				corrections.push(`Normalized English variant → ${translation}`);
			}
		}
	}


	return { output, corrections };
};

const correctMissedVocabTerms = async (englishText, chineseParagraphs, missedTermsData, callAI, onLog, abortSignal) => {
	if (missedTermsData.length === 0) return englishText;

	const englishParagraphs = englishText.split(/\n+/).map(p => p.trim()).filter(Boolean);
	const isSynced = englishParagraphs.length === chineseParagraphs.length;

	if (!isSynced) {
		onLog("warning", `Paragraph count mismatch (EN ${englishParagraphs.length} vs ZH ${chineseParagraphs.length}). Switching to fuzzy keyword targeting...`);
	}

	const paraFixMap = new Map(); // targetIdx -> [{ original, term }]

	for (const { term, original, paragraphs } of missedTermsData) {
		let targetIndices = [];

		if (isSynced) {
			// Exact 1:1 mapping (convert to 0-based index)
			targetIndices = paragraphs.map(p => p - 1);
		} else {
			// Fuzzy Keyword Targeting
			// Break the mandatory term into significant words (e.g. "Patrick Ewing" -> ["Patrick", "Ewing"])
			const words = term.split(/[\s\-]+/).filter(w => w.length > 2);

			englishParagraphs.forEach((enPara, idx) => {
				// Search for any piece of the English name (using word boundaries to avoid false positives)
				const hasPartialMatch = words.some(w => {
					const regex = new RegExp(`\\b${escapeRegex(w)}\\b`, 'i');
					return regex.test(enPara);
				});

				// If we find a partial English match, or the raw Chinese leaked, flag this paragraph
				if (hasPartialMatch || enPara.includes(original)) {
					targetIndices.push(idx);
				}
			});
		}

		for (const targetIdx of targetIndices) {
			if (targetIdx >= 0 && targetIdx < englishParagraphs.length) {
				if (!paraFixMap.has(targetIdx)) paraFixMap.set(targetIdx, []);
				// Prevent duplicate instructions for the same paragraph
				if (!paraFixMap.get(targetIdx).some(t => t.term === term)) {
					paraFixMap.get(targetIdx).push({ original, term });
				}
			}
		}
	}

	if (paraFixMap.size === 0) return englishText; // Nothing found to fix

	// --- Execute Corrections in Parallel ---
	const correctionPromises = Array.from(paraFixMap.entries()).map(async ([targetIdx, terms]) => {
		const paragraph = englishParagraphs[targetIdx];
		if (!paragraph) return 0;

		const termList = terms.map(t => `- "${t.original}" MUST be translated as "${t.term}"`).join('\n');

		const correctionInstruction = `You are fixing a single paragraph of an already-translated English novel excerpt because it failed to use mandatory glossary terms.

MANDATORY TERMINOLOGY (the paragraph below currently uses a different word/phrase for these):
${termList}

Rules:
- Rewrite the paragraph so it uses the exact mandated English term(s) above wherever the corresponding concept appears.
- Do NOT change anything else: keep sentence structure, tone, and all other wording as close to the original as possible.
- Output ONLY the corrected paragraph. No explanations, no quotes, no labels.`;

		try {
			const corrected = await callAI(paragraph, correctionInstruction, { maxTokens: 2000, signal: abortSignal });
			if (corrected && corrected.trim()) {
				englishParagraphs[targetIdx] = corrected.trim();
				return 1;
			}
		} catch (e) {
			if (e.name === 'AbortError' || e.constructor.name === 'APIUserAbortError' || /aborted/i.test(e.message)) throw e;
			onLog("warning", `Vocab correction failed for target paragraph: ${e.message}`);
		}
		return 0;
	});

	const correctionResults = await Promise.all(correctionPromises);
	const correctedCount = correctionResults.reduce((sum, count) => sum + count, 0);

	if (correctedCount > 0) {
		onLog("info", `🔧 Corrected ${correctedCount} paragraph(s) for missed glossary terms.`);
	}

	return englishParagraphs.join('\n\n');
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

const translateChapter = async (chineseTitle, chineseContent, bookId, bookTitle, onLog = () => { }, abortSignal) => {

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
	const callAI = async (prompt, systemInstruction, options = {}) => {
		// Default to 8192, but allow overrides
		const maxTokens = options.maxTokens || 8192;
		// Default to throwing an error on truncation, but allow bypassing it
		const throwOnLength = options.throwOnLength !== undefined ? options.throwOnLength : true;

		const response = await openai.chat.completions.create({
			model: PRIMARY_MODEL,
			temperature: 0.1,
			max_tokens: maxTokens,
			messages: [
				{ role: "system", content: systemInstruction },
				{ role: "user", content: prompt }
			],
			reasoning: { effort: "low" }
		}, {
			// Pass the signal into the OpenAI SDK's request options
			signal: options.signal
		});

		// PATCH: Safely fallback to an empty string if OpenRouter returns null content
		const choice = response.choices[0];
		const content = choice?.message?.content || "";
		const finishReason = choice?.finish_reason;

		if (!content && finishReason === "length") {
			onLog("warning", `Model exhausted max_tokens (${maxTokens}) before producing output — likely reasoning overhead.`);
		}

		return content.trim();
	};

	const callAIWithContext = async (context, mainText, systemInstruction, options = {}) => {
		return callAI(`PREVIOUS CONTEXT (for continuity only; DO NOT retranslate or repeat):\n${context}\n\nTEXT TO TRANSLATE (new content only):\n${mainText}`, systemInstruction, options);
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
		const extractionInstruction = `Extract NEW proper nouns from the text (Characters, Places, Organizations, Titles, and important Nicknames/aliases).

TRANSLITERATION RULE (Most Important):
Chinese fiction often phonetically transliterates foreign names. For each name, decide which case applies:
- If the Chinese characters are a PHONETIC TRANSLITERATION of a Western name, output the REAL, STANDARD SPELLING of that name, not pinyin (e.g., 罗杰=Roger NOT Luo Jie; 麦金尼=McKinney NOT Mai Jin Ni).
- If the name is a genuine Chinese name, use standard pinyin (e.g., 林小雨=Lin Xiaoyu).
- Use the setting and surrounding context to decide. If the story is set outside China or the surrounding names are Western, assume transliteration.
- For real public figures, athletes, or historical people, use their actual documented English name.

ALIASES & NICKNAMES:
If a term is a nickname or alias for another person, translate it directly to the exact same English name/nickname used for that person (e.g., 鲨鱼=Shaq, 奥尼尔=Shaq). 

Format STRICTLY:
- One entry per line: Chinese=English
- For descriptive nicknames, use NATURAL ENGLISH SPACING ("Snow Veggie", not "SnowVeggie").
- OUTPUT ONLY THE PAIRS. No explanations, no markdown.
- If you find no new proper nouns, output exactly "NONE".

${excludeText}`;

		const extractedNewVocab = [];
		const newVocabSet = new Set();

		try {
			// 1. FRAME THE TEXT: Clearly label the input so the AI knows what to process
			const extractionPrompt = `TEXT TO SCAN:\n${normalizedContent.slice(0, 2000)}`;
			// Send just the first 2000 characters to cheaply identify the core entities of the chapter
			// Use maxTokens: 1000 (plenty for a 2000 char snippet) and allow truncation
			const newVocabRaw = await callAI(extractionPrompt, extractionInstruction, { maxTokens: 4000, throwOnLength: false, signal: abortSignal });

			// 2. DEBUG LOG: Let's see exactly what DeepSeek is returning
			// onLog("info", `--- RAW PRE-FLIGHT AI OUTPUT ---\n${newVocabRaw}\n------------------------------`);

			const lines = newVocabRaw.split('\n');

			for (const line of lines) {
				// Aggressively strip bolding, italics, backticks, and extra spaces
				const cleanedLine = line.replace(/[*`_]/g, '').trim();

				// Skip the "NONE" escape hatch or empty lines
				if (!cleanedLine || cleanedLine === "NONE") continue; // Ignore the empty state output

				const parsed = parseVocabLine(cleanedLine, onLog);
				if (parsed && !newVocabSet.has(parsed.original) && !vocabDocs.find(v => v.original === parsed.original)) {
					newVocabSet.add(parsed.original);
					extractedNewVocab.push(parsed);
				}
			}
			onLog("info", `Pre-flight found ${extractedNewVocab.length} new terms.`);
		} catch (e) {
			// NEW: If it's an abort, don't fallback—stop everything immediately!
			if (e.name === 'AbortError' || e.constructor.name === 'APIUserAbortError' || /aborted/i.test(e.message)) {
				throw e;
			}
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

		const titleVocabSection = titleVocabString
			? `MANDATORY TERMINOLOGY:\nUse these translations if they appear:\n${titleVocabString}\n\n`
			: '';

		const metaInstruction = `You are translating a Chinese web novel chapter title.
		${titleVocabSection}Rules:
		- Output ONLY the translated title.
		- Do NOT add "Chapter", numbers, explanations, or extra words.
		- NEVER output Chinese characters.
		- If the title is very short, symbolic, or unusual (for example a single letter or symbol), keep it short and literal. Do NOT expand it into a words.
		- Never refuse the title and never say it is invalid.

		Translate this title:`;


		let translatedTitleRaw = "";
		let titleAttempt = 0;
		let titleSuccess = false;

		while (!titleSuccess && titleAttempt < 3) {
			try {
				// Frame the user prompt so it doesn't just echo the Chinese
				translatedTitleRaw = await callAI(`Title to translate:\n${chineseTitle}`, metaInstruction, { maxTokens: 800, signal: abortSignal });

				// Reject empty outputs, extreme length (AI chatting), AI refusals, AND any leaked Chinese characters
				if (
					!translatedTitleRaw ||
					translatedTitleRaw.length > 100 ||
					/invalid|placeholder|does not contain|please provide/i.test(translatedTitleRaw) ||
					/[\u4e00-\u9fa5]/.test(translatedTitleRaw)
				) {
					throw new Error(`Invalid title output (length, refusal, or leaked Chinese): ${translatedTitleRaw}`);
				}

				titleSuccess = true;
			} catch (e) {
				// NEW: If aborted, break out of the retry loop instantly
				if (e.name === 'AbortError' || e.constructor.name === 'APIUserAbortError' || /aborted/i.test(e.message)) {
					throw e;
				}
				titleAttempt++;
				onLog("warning", `Title translation attempt ${titleAttempt} failed: ${e.message}`);
				if (titleAttempt >= 3) {
					// Ultimate fallback to an English string, not the original Chinese
					translatedTitleRaw = "Untitled";
				}
			}
		}

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

			const proseVocabSection = activeChunkVocabString ? `MANDATORY TERMINOLOGY:\nYou MUST use these exact translations whenever the corresponding Chinese terms appear:\n${activeChunkVocabString}\n\nDo not invent alternative names, spellings, or variations. Keep names compact and consistent. Avoid inserting unnecessary spaces into romanized names.\n\n` : '';

			const proseInstruction = `You are a professional literary translator specializing in Chinese web novels (including contemporary, urban, suspense, romance, and xianxia).

${proseVocabSection}CORE RULES:
- Translate STRICTLY paragraph by paragraph. PRESERVE EVERY SINGLE LINE BREAK. Do not merge short paragraphs or dialogue lines together.
- Output ONLY the translated story prose. No explanations, notes, or comments.
- Do not use the "Original [English]" format for system text or foreign languages. Output ONLY the English translation.
- TRANSLATE ALL ASIAN CHARACTERS. Do not leave any Chinese or Japanese text in the English output, even for system prompts, UI text, or stylized brackets.
- Prioritize natural, fluent, and elegant literary English over literal word-for-word translation.
- Translate all place names and locations into English
- Preserve the original tone, atmosphere, and narrative voice exactly (sweet, cold, eerie, humorous, violent, tender, etc.).
- When the original creates a specific mood (especially eerie, unsettling, sarcastic, or intimate), actively maintain that mood in English.

IMPORTANT:
- Do not confuse or interchange character names.
- Preserve who is speaking and who is acting exactly as in the original.
- Do not repeat previous scenes or paragraphs.
- Keep English name spacing natural (e.g. "An Xun", not "AnXun").
- Never replace one character’s name with another character’s name.

NAME & TERM HANDLING:
-- Always use the mandatory terminology provided.
- For real names, keep consistent romanization.
- For nicknames and online handles, prefer natural English renderings when they are clearer and more readable than pure pinyin.
- Keep each character’s identity consistent.

ANTI-DUPLICATION RULES:
- Do not repeat scenes, paragraphs, or events already translated.
- If context is provided, continue forward only. Never retell prior content.
- Each event should appear once unless the original itself repeats it.

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
						? await callAIWithContext(chunk.context, chunk.text, proseInstruction, { signal: abortSignal })
						: await callAI(chunk.text, proseInstruction, { signal: abortSignal });

					// NEW: empty response guard
					if (!result || !result.trim()) {
						throw new Error(`Empty model response for chunk ${i + 1}.`);
					}

					const transParas = countParagraphs(result);
					const minAcceptable = Math.floor(chunk.paraCount * 0.75);

					if (transParas < minAcceptable) {
						throw new Error(`Truncation detected: Returned ${transParas} paragraphs, expected ${chunk.paraCount}.`);
					}

					if (looksAbruptlyCut(result)) {
						throw new Error(
							`Truncation detected: Chunk appears to end mid-sentence ("${result.trim().slice(-40)}").`
						);
					}

					// const lastChar = result.trim().slice(-1);
					// if (!/[.!?”"’'~\]》—…,:]/.test(lastChar)) {
					// 	throw new Error(`Truncation detected: Output ended abruptly without terminal punctuation (ends with "${lastChar}").`);
					// }

					finalTranslatedChunks.push(result);
					chunkSuccess = true;
				} catch (e) {
					// NEW: If aborted, stop retrying chunks immediately
					if (e.name === 'AbortError' || e.constructor.name === 'APIUserAbortError' || /aborted/i.test(e.message)) {
						throw e;
					}
					attempt++;
					if (attempt >= 3) throw e;
					onLog("warning", `Truncation validation failed. Retrying Chunk ${i + 1} (Attempt ${attempt}/3)...`);
				}
			}
		}

		onLog("info", "Translation successful 👍🏼 Combining chunks...");
		let combinedContent = finalTranslatedChunks.join('\n\n');

		// Run Smart Deduplication
		const { cleanedText, duplicateCount } = removeNearDuplicateParagraphs(combinedContent);
		combinedContent = cleanedText;

		// Punctuation Cleanup (Em-dash replacement)
		// 1. Scene Separators: Dashes on a line by themselves -> replace with a clean line break
		let finalCleanedContent = combinedContent.replace(/^\s*[—–-]{2,}\s*$/gm, '\n\n');

		// 2. Smart Inline Dashes: Check for preceding punctuation
		finalCleanedContent = finalCleanedContent.replace(/([.!?,;:"'”’\]]?)\s*(?:—|——|--)\s*/g, (match, punctuation) => {
			if (punctuation) {
				// If it ends with punctuation (e.g. "flushing. ——"), remove the dash and leave a space
				return punctuation + ' ';
			} else {
				// Otherwise (e.g. "take it apart —— sell"), replace the dash with a comma and a space
				return ', ';
			}
		});

		// 3. Dialogue Colon Replacement
		// Converts: He said: "Hello" -> He said, "Hello"
		// Matches standard colons or Chinese full-width colons right before any quote mark
		finalCleanedContent = finalCleanedContent.replace(/[：:](\s*)(?=["'“‘])/g, ',$1');

		// 4. Normalize Pinyin (Run this BEFORE the enforcer!)
		finalCleanedContent = normalizeSpacedPinyin(
			finalCleanedContent,
			masterVocabList.map(v => v.translation)
		);

		// Final enforcement across all combined chunks
		const { output: enforcedContent, corrections } = enforceCanonicalVocab(finalCleanedContent, masterVocabList, normalizedContent);
		if (corrections.length > 0) {
			onLog("warning", `🔧 Fixed ${corrections.length} leaked Chinese terms post-translation.`);
		}


		// --- STEP 4: THE QUALITY SCORING ENGINE ---
		onLog("info", "Calculating Translation Quality Score...");
		let qualityScore = 100;
		const scoreReasons = [];

		const expectedParas = chunks.reduce((sum, chunk) => sum + chunk.paraCount, 0);
		const actualParas = countParagraphs(finalCleanedContent);
		const paraDiff = Math.abs(expectedParas - actualParas);

		if (paraDiff > 0) {
			const penalty = Math.round(Math.min(paraDiff * 1.2, 18)); // Cap + softer
			qualityScore -= penalty;
			scoreReasons.push(`Structure Penalty (-${penalty}): Expected ${expectedParas} paragraphs, got ${actualParas}.`);
		}

		// Severe penalty for AI hallucinations/repetitions
		if (duplicateCount > 0) {
			const penalty = duplicateCount * 12; // -12 points per duplicated paragraph
			qualityScore -= penalty;
			scoreReasons.push(`Repetition Penalty (-${penalty}): Detected and stripped ${duplicateCount} duplicated or highly repetitive paragraph(s) from the AI output.`);
		}

		// Check Title for Asian Characters
		const titleAsianCharacters = cleanedTitle.match(/[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g) || [];
		if (titleAsianCharacters.length > 0) {
			const penalty = 15; // Heavy penalty since a Chinese title breaks the UI experience
			qualityScore -= penalty;
			scoreReasons.push(`Title Penalty (-${penalty}): The chapter title failed to translate and still contains Chinese characters.`);
		}

		// Check Content for Asian Characters
		const asianCharacters = finalCleanedContent.match(/[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g) || [];
		if (asianCharacters.length > 0) {
			const penalty = asianCharacters.length * 2; // -2 points per untranslated character
			qualityScore -= penalty;
			scoreReasons.push(`Translation Penalty (-${penalty}): Found ${asianCharacters.length} untranslated Asian characters.`);
		}

		// Check C: Glossary Adherence — first pass (to find what needs fixing)
		const usedVocab = masterVocabList.filter(v => normalizedContent.includes(v.original));
		const chineseParagraphs = normalizedContent.split(/\n+/).filter(p => p.trim());

		const scanForMissedTerms = (englishText) => {
			const missed = [];
			const missedData = [];

			const englishParas = englishText.split(/\n+/).map(p => p.trim()).filter(Boolean);

			// We already calculated chineseParagraphs outside this scope
			const canDoLineByLine = englishParas.length === chineseParagraphs.length;

			usedVocab.forEach(v => {
				// 1. Create a strict word-boundary regex
				const escapedTerm = escapeRegex(v.translation).replace(/\s+/g, '[\\s\\-]+');

				// \b checks for word boundaries, so "Shaq" won't match inside "Shaquille"
				// (?:s|'s)? allows for plurals or possessives (e.g., "Shaq's")
				const strictRegex = new RegExp(`\\b${escapedTerm}(?:s|'s)?\\b`, 'i');

				const missedInParas = [];

				if (canDoLineByLine) {
					// 2. Precise Paragraph-by-Paragraph Check
					chineseParagraphs.forEach((zhPara, index) => {
						if (zhPara.includes(v.original)) {
							const enPara = englishParas[index];
							// If the Chinese has the term, but this exact English paragraph DOES NOT
							if (enPara && !strictRegex.test(enPara)) {
								missedInParas.push(index + 1);
							}
						}
					});

					if (missedInParas.length > 0) {
						missedData.push({ term: v.translation, original: v.original, paragraphs: missedInParas });
						missed.push(`"${v.translation}" (Para ${missedInParas.join(", ")})`);
					}
				} else {
					// 3. Fallback Document-Level Check (if paragraph counts drifted)
					if (!strictRegex.test(englishText)) {
						const foundInParas = [];
						chineseParagraphs.forEach((para, index) => {
							if (para.includes(v.original)) foundInParas.push(index + 1);
						});
						missedData.push({ term: v.translation, original: v.original, paragraphs: foundInParas });
						const locationStr = foundInParas.length > 0 ? ` (Para ${foundInParas.join(", ")})` : "";
						missed.push(`"${v.translation}"${locationStr}`);
					}
				}
			});

			return { missed, missedData };
		};

		let { missed: missedTerms, missedData: missedTermsData } = scanForMissedTerms(finalCleanedContent);

		// Attempt to auto-fix synonym drift (cases enforceCanonicalVocab can't catch)
		if (missedTermsData.length > 0) {
			onLog("info", `Attempting to correct ${missedTermsData.length} missed glossary term(s)...`);
			finalCleanedContent = await correctMissedVocabTerms(finalCleanedContent, chineseParagraphs, missedTermsData, callAI, onLog, abortSignal);

			// Re-scan after correction so the score reflects the fixed text
			const rescan = scanForMissedTerms(finalCleanedContent);
			missedTerms = rescan.missed;
			missedTermsData = rescan.missedData;
		}

		if (missedTerms.length > 0) {
			const penalty = Math.min(missedTerms.length * 3, 15);
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