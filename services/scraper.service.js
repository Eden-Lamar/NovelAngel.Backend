const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// List of random user agents to rotate identity
const userAgents = [
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
];

const scrapeChapter = async (url) => {
	let browser;
	try {
		browser = await puppeteer.launch({
			headless: false, // Keep it visible
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
			defaultViewport: null
		});

		const page = await browser.newPage();

		// 2. Set Random User Agent
		const randomAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
		await page.setUserAgent(randomAgent);

		console.log(`Opening page: ${url}`);

		// CHANGE 1: 'domcontentloaded' is much faster than 'networkidle2'
		// It fires as soon as the HTML is ready, ignoring the background ads.
		// We try to go to the page. If it "times out" (network idle), we assume it might just be a slow ad loading 
		// and proceed to check the content selector anyway.
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
		} catch (e) {
			console.log("Navigation warning: Page loading might be incomplete, but checking for content anyway...");
		}

		// CHANGE 2: Immediately look for the text box.
		console.log("Checking for novel content...");

		// 1. Wait for the Text Container
		await page.waitForSelector('.txtnav', { timeout: 30000 });

		// 2. CRITICAL FIX: Scroll to Bottom to trigger lazy loading
		console.log("Scrolling to load full content...");
		await autoScroll(page);

		// 4. Extract Data
		const data = await page.evaluate(() => {
			const titleElement = document.querySelector('h1');
			const title = titleElement ? titleElement.innerText.trim() : "No Title";
			const contentElement = document.querySelector('.txtnav');

			// Find the "Next Chapter" Link
			// 69shuba often uses .page1 or just simple 'a' tags at bottom
			let nextUrl = null;
			const links = Array.from(document.querySelectorAll('a'));
			for (let link of links) {
				if (link.innerText.includes("下一章") || link.innerText.includes("Next Chapter")) {
					nextUrl = link.href;
					break;
				}
			}

			if (!contentElement) return null;

			// Cleanup Garbage
			const junkClasses = ['.txtinfo', '.hide720', 'div', 'script', '.ads', '.bottom-ad'];
			junkClasses.forEach(cls => {
				const junk = contentElement.querySelectorAll(cls);
				junk.forEach(el => el.remove());
			});

			return {
				title,
				content: contentElement.innerText,
				nextUrl
			};
		});

		if (!data) throw new Error("Content Selector found, but content was empty.");

		// 5. Cleanup Text
		let cleanContent = data.content
			.replace(/69书吧.*/g, '')
			.replace(/\(本章完\)/g, '')
			.trim();

		// Safety Check: If content is suspiciously short (< 500 chars), warn us
		if (cleanContent.length < 500) {
			console.warn(`WARNING: Scraped content seems very short (${cleanContent.length} chars). Possible truncated scrape.`);
		}

		console.log(`Scraping successful! (${cleanContent.length} chars)`);

		return {
			title: data.title,
			content: cleanContent,
			nextUrl: data.nextUrl
		};

	} catch (error) {
		console.error(`Scraping Error:`, error.message);
		throw error;
	} finally {
		if (browser) await browser.close();
	}
};

// Helper function to simulate human scrolling
async function autoScroll(page) {
	await page.evaluate(async () => {
		await new Promise((resolve) => {
			var totalHeight = 0;
			var distance = 100;
			var timer = setInterval(() => {
				var scrollHeight = document.body.scrollHeight;
				window.scrollBy(0, distance);
				totalHeight += distance;

				// Stop scrolling if we reached the bottom
				if (totalHeight >= scrollHeight - window.innerHeight) {
					clearInterval(timer);
					resolve();
				}
			}, 100); // Scroll every 100ms
		});
	});
}

module.exports = { scrapeChapter };