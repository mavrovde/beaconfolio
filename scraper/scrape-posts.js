import { chromium } from 'playwright';
import { config } from 'dotenv';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { parsePost } from './parse-post.js';
import { harvestPosts, assertExtracted, mergeExport, readExisting } from './collect-posts.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, 'posts_data.json');
const SESSION_FILE = join(__dirname, 'session.json');
const USER_DATA_DIR = join(__dirname, '.chrome-profile');

const LINKEDIN_EMAIL = process.env.LINKEDIN_EMAIL;
const LINKEDIN_PASSWORD = process.env.LINKEDIN_PASSWORD;
// No personal default (#66): the scraper targets YOUR profile — set PROFILE_URL.
const PROFILE_URL = process.env.PROFILE_URL;
if (!PROFILE_URL) {
    console.error('PROFILE_URL is required, e.g. PROFILE_URL=https://www.linkedin.com/in/<your-handle>/');
    process.exit(1);
}
// Be gentle with LinkedIn (avoid anti-bot / account risk): cap posts per run and
// use small randomized scroll delays. Session is reused (never re-login per run).
const MAX_POSTS = parseInt(process.env.SCRAPE_MAX_POSTS || '50', 10);

async function login(page, context) {
    // Prefer the shared persistent profile session (same as scrape-linkedin.js).
    try {
        const liCookies = await context.cookies('https://www.linkedin.com');
        if (liCookies.some((c) => c.name === 'li_at' && c.value)) {
            console.log('✓ Already authenticated (persistent profile)');
            return;
        }
    } catch { }

    if (existsSync(SESSION_FILE)) {
        console.log('Restoring session...');
        const cookies = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
        await context.addCookies(cookies);
        // Go directly to the feeds page to check auth
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        if (page.url().includes('/feed')) {
            console.log('✓ Session restored');
            return;
        }
    }

    console.log('Logging in...');
    await page.goto('https://www.linkedin.com/login');
    await page.waitForTimeout(1000);
    await page.fill('input[name="session_key"]', LINKEDIN_EMAIL);
    await page.fill('input[name="session_password"]', LINKEDIN_PASSWORD);
    await page.click('button[type="submit"]');

    const maxWait = 180000;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        if (page.url().includes('/feed')) {
            const cookies = await context.cookies();
            writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
            console.log('✓ Logged in & session saved');
            return;
        }
        if (page.url().includes('checkpoint') || page.url().includes('challenge')) {
            console.log('⚠️  Complete MFA in browser...');
        }
        await page.waitForTimeout(1000);
    }
    throw new Error('Login timeout');
}

// Collect every image src under a set of locators (post media may have several).
async function collectImageSrcs(item, selector) {
    const srcs = [];
    try {
        const imgs = await item.locator(selector).all();
        for (const img of imgs) {
            const src = await img.getAttribute('src', { timeout: 500 }).catch(() => null);
            if (src) srcs.push(src);
        }
    } catch { }
    return srcs;
}

// Get text from first matching element safely
async function getText(locator, timeout = 1000) {
    try {
        if (await locator.count() > 0) {
            return (await locator.first().innerText({ timeout })).trim();
        }
    } catch { }
    return '';
}

// LinkedIn serves hashed, rotating CSS classes, so the extractor anchors on the
// stable hooks instead: the per-post analytics link (carries the activity URN),
// `data-testid=expandable-text-box` (the body) and `role=listitem` (the card).
const POST_ITEM = '[role="listitem"]';
const POST_URN_LINK = 'a[href*="post-summary/urn:li:activity:"]';

// Browser glue around harvestPosts (the loop and its stop rules live in collect-posts.js,
// where they are unit-tested): scroll, give the lazily appended cards a few seconds to
// land, and press a "show more" control if the feed offers one.
async function advanceFeed(page) {
    await page.evaluate(() => window.scrollBy(0, 900));
    await page.waitForTimeout(2000 + Math.floor(Math.random() * 800));
    const showMore = page.getByRole('button', { name: /show more|load more/i }).first();
    if (await showMore.count() > 0) {
        await showMore.click({ timeout: 1000 }).catch(() => { });
        await page.waitForTimeout(1500);
    }
}

async function extractPosts(page, seen = new Set()) {
    const posts = [];
    const items = await page.locator(`${POST_ITEM}:has(${POST_URN_LINK})`).all();

    for (const item of items) {
        try {
            const href = await item.locator(POST_URN_LINK).first().getAttribute('href', { timeout: 500 });
            const urn = (href || '').match(/urn:li:activity:\d+/)?.[0] || '';
            if (!urn || seen.has(urn)) continue;

            const raw = { urn, content: '', imageCandidates: [], authorImageUrl: null, time: '' };

            // Expand a truncated body ("… more") then read it.
            const more = item.locator('[data-testid="expandable-text-button"]').first();
            if (await more.count() > 0) {
                await more.click({ timeout: 1000 }).catch(() => { });
                await page.waitForTimeout(200);
            }
            raw.content = await getText(item.locator('[data-testid="expandable-text-box"]'), 2000);

            // The author's avatar - captured ONLY so parsePost can exclude it.
            raw.authorImageUrl = await item
                .locator('figure img')
                .first()
                .getAttribute('src', { timeout: 500 })
                .catch(() => null);

            // The post's OWN media; parsePost drops avatars and de-duplicates.
            raw.imageCandidates = await collectImageSrcs(item, 'img[src*="media.licdn.com/dms/image"]');

            const post = parsePost(raw);
            if (post) posts.push(post);
        } catch (e) {
            console.log(`  Error extracting a post: ${e.message}`);
        }
    }

    return posts;
}

async function main() {
    if (!LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
        console.error('Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD in .env');
        process.exit(1);
    }

    console.log('LinkedIn Posts Scraper');
    console.log('===========================\n');

    // Command line: --scrolls=N caps the scroll loop (default 60); --replace writes only this
    // run's posts instead of merging them into the existing posts_data.json.
    const scrollsArg = process.argv.find(arg => arg.startsWith('--scrolls='));
    const numScrolls = scrollsArg ? parseInt(scrollsArg.split('=')[1], 10) : 60;
    const replace = process.argv.includes('--replace');
    console.log(`Will scroll up to ${numScrolls} times to load posts.`);

    const isHeadless = process.env.HEADLESS !== 'false';
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: isHeadless,
        slowMo: 30,
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });
    const page = context.pages()[0] || await context.newPage();

    try {
        await login(page, context);

        const postsUrl = `${PROFILE_URL.replace(/\/$/, '')}/recent-activity/all/`;
        console.log(`\nNavigating to: ${postsUrl}`);
        await page.goto(postsUrl);
        await page.waitForTimeout(4000);

        console.log('Scrolling to load posts...');
        const harvested = await harvestPosts({
            extract: (seen) => extractPosts(page, seen),
            advance: () => advanceFeed(page),
            maxScrolls: numScrolls,
            maxPosts: MAX_POSTS,
            log: (step, total) => console.log(`  scroll ${step}: ${total} posts`),
        });
        // Never clobber the last good export with an empty one (a selector rot once
        // silently replaced 25 posts with []).
        assertExtracted(harvested);

        const existing = readExisting(
            existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, 'utf-8') : null,
            { replace },
        );
        const posts = mergeExport(existing, harvested, { replace });
        writeFileSync(OUTPUT_FILE, JSON.stringify(posts, null, 2), 'utf-8');

        console.log('\n========== RESULT ==========');
        console.log(`Extracted ${harvested.length} posts this run; ${posts.length} in the export${replace ? ' (replaced)' : ''}`);
        console.log(`\n✓ Saved to ${OUTPUT_FILE}`);

    } catch (e) {
        console.error('Error:', e.message);
        process.exitCode = 1;
    } finally {
        await context.close();
    }
}

main();
