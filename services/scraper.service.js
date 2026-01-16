const axios = require('axios');
const cheerio = require('cheerio');

const scrapeChapter = async (url) => {
	try {
		const ZENROWS_API_KEY = process.env.ZENROWS_API_KEY;
		if (!ZENROWS_API_KEY) throw new Error("Missing ZENROWS_API_KEY in .env");

		console.log(`Scrapping...`);

		// We use ZenRows 'js_instructions' to force the page to scroll to the bottom
		// This triggers the lazy-loading of the text (replacing your autoScroll function)
		const jsInstructions = [
			{ "scroll_y": 10000 }, // Scroll down deep
			{ "wait": 3000 } // Wait 1s for text to appear
		];

		const { data: html } = await axios({
			url: 'https://api.zenrows.com/v1/',
			method: 'GET',
			params: {
				'apikey': ZENROWS_API_KEY.trim(),
				'url': url,
				'js_render': 'true', // Required for 69shuba's dynamic content
				'antibot': 'true',   // Bypass Cloudflare
				'premium_proxy': 'true', // Use residential IPs
				'wait_for': '.txtnav',
				'js_instructions': JSON.stringify(jsInstructions) // Perform the scroll
			}
		});

		console.log("Parsing HTML...");

		// Load HTML into Cheerio (which works just like jQuery/document.querySelector)
		const $ = cheerio.load(html);

		// DEBUG: Check what page we actually got
		const pageTitle = $('title').text().trim();
		console.log(`Page Title found: "${pageTitle}"`);

		// Extract Title
		const title = $('h1').text().trim() || "No Title";

		// Extract Content
		// Remove garbage elements first
		$('.txtinfo, .hide720, script, .ads, .bottom-ad, style').remove();

		// PRESERVE PARAGRAPHS ---
		// Cheerio .text() strips html tags. We want <br> to become newlines first.
		$('.txtnav br').replaceWith('\n');
		$('.txtnav p').after('\n');

		let content = $('.txtnav').text().trim();

		// Cleanup Text
		content = content
			.replace(/69书吧.*/g, '')
			.replace(/\(本章完\)/g, '')
			.trim();

		// Find Next URL
		let nextUrl = null;
		$('a').each((i, link) => {
			const text = $(link).text();
			if (text.includes("下一章") || text.includes("Next Chapter")) {
				nextUrl = $(link).attr('href');
				// 69shuba sometimes gives relative URLs (e.g., "/txt/123/456.html")
				// We ensure it is absolute
				if (nextUrl && !nextUrl.startsWith('http')) {
					nextUrl = new URL(nextUrl, 'https://www.69shuba.com').href;
				}
			}
		});

		if (!content) {
			// Log a snippet of the body to see what went wrong (is it a captcha?)
			const bodySnippet = $('body').text().substring(0, 200).replace(/\n/g, ' ');
			console.warn(`DEBUG: Body snippet: ${bodySnippet}`);
			throw new Error(`ZenRows returned HTML, but .txtnav content was empty. Title was: ${pageTitle}`);
		}

		if (content.length < 500) {
			console.warn(`WARNING: Content seems short (${content.length} chars).`);
		}

		console.log(`Scraping successful (${content.length} chars)`);

		return {
			title,
			content,
			nextUrl
		};

	} catch (error) {
		// Better error logging for ZenRows responses
		if (error.response) {
			console.error(`ZenRows API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
			throw new Error(`ZenRows Failed: ${error.response.status}`);
		}
		console.error(`Scraping Error:`, error.message);
		throw error;
	}
};

module.exports = { scrapeChapter };