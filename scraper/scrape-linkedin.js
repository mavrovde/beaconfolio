import { chromium } from 'playwright';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractPhotoUrl } from './extract-photo.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, 'profile_data.json');
// #333: the avatar lands in a GITIGNORED file — a real face must never enter
// this PUBLIC repo (#66); it reaches the site only via the admin photo upload.
const PHOTO_FILE = join(__dirname, 'profile_photo.jpg');
const USER_DATA_DIR = join(__dirname, '.chrome-profile');

const LINKEDIN_EMAIL = process.env.LINKEDIN_EMAIL;
const LINKEDIN_PASSWORD = process.env.LINKEDIN_PASSWORD;
// No personal default (#66): the scraper targets YOUR profile — set PROFILE_URL.
const PROFILE_URL = process.env.PROFILE_URL;
if (!PROFILE_URL) {
    console.error('PROFILE_URL is required, e.g. PROFILE_URL=https://www.linkedin.com/in/<your-handle>/');
    process.exit(1);
}
const PUBLIC_ID = PROFILE_URL.replace(/\/+$/, '').split('/in/')[1];

// Realistic UA — LinkedIn serves a degraded page to truncated user agents.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─────────────────────────── Auth ───────────────────────────
// li_at is LinkedIn's session cookie — the definitive "logged in" signal.
async function isAuthenticated(context) {
  try {
    const cookies = await context.cookies('https://www.linkedin.com');
    return cookies.some((c) => c.name === 'li_at' && c.value);
  } catch {
    return false;
  }
}

async function login(page, context) {
  if (await isAuthenticated(context)) {
    console.log('✓ Already authenticated (persistent profile)');
    return;
  }

  console.log('Not authenticated. Opening login page...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  try {
    await page.waitForSelector('input[name="session_key"]', { timeout: 8000 });
    if (LINKEDIN_EMAIL) await page.fill('input[name="session_key"]', LINKEDIN_EMAIL);
    if (LINKEDIN_PASSWORD) await page.fill('input[name="session_password"]', LINKEDIN_PASSWORD);
    await page.click('button[type="submit"]');
    console.log('Submitted credentials...');
  } catch {
    console.log('Auto-fill unavailable — please log in manually.');
  }

  console.log('⚠️  If needed, finish login / MFA / CAPTCHA in the browser window.');
  console.log('    Waiting for login (up to 5 minutes)...');
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    if (await isAuthenticated(context)) {
      console.log('✓ Logged in — session persisted to disk');
      return;
    }
    await page.waitForTimeout(2500);
  }
  throw new Error('Login timeout — authentication not completed within 5 minutes');
}

// ─────────────────────── Date helpers ───────────────────────
function fmtDate(d) {
  if (!d) return '';
  const mon = d.month ? MONTHS[d.month - 1] : '';
  return [mon, d.year].filter(Boolean).join(' ');
}
function fmtRange(dr) {
  if (!dr) return { startDate: '', endDate: '' };
  return { startDate: fmtDate(dr.start), endDate: dr.end ? fmtDate(dr.end) : 'Present' };
}
const enUS = (v) => (v && typeof v === 'object' ? v.en_US : v) || '';

// Authenticated same-origin GET against the Voyager API from the page context,
// so cookies + CSRF token flow automatically. Returns the parsed JSON or null.
async function voyagerGet(page, url) {
  return page.evaluate(async (u) => {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    try {
      const res = await fetch(u, {
        headers: {
          'csrf-token': m ? m[1] : '',
          accept: 'application/vnd.linkedin.normalized+json+2.1',
          'x-restli-protocol-version': '2.0.0',
        },
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }, url);
}

// The full-profile dash entity — carries the rich Profile (name, headline,
// about, location) plus Company/Geo entities used to resolve references.
function dashUrl() {
  const decoration =
    'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101';
  return (
    `/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${PUBLIC_ID}` +
    `&decorationId=${decoration}`
  );
}

// Dedicated finders return the COMPLETE list per section (the FullProfile dash
// caps each at ~20/10). count=100 covers every realistic profile.
function finderUrl(resource, profileUrn) {
  return (
    `/voyager/api/identity/dash/${resource}?q=viewee` +
    `&profileUrn=${encodeURIComponent(profileUrn)}&count=100`
  );
}

// Derive the fsd_profile URN from any entity in the dash response.
function extractProfileUrn(included) {
  const p = (included || []).find((e) => (e['$type'] || '').endsWith('profile.Profile'));
  if (p && /^urn:li:fsd_profile:/.test(p.entityUrn || '')) return p.entityUrn;
  for (const e of included || []) {
    const m = /urn:li:fsd_profile(?:Position|Education|Skill|Certification|Language)?:\(?([^,)]+)/.exec(
      e.entityUrn || ''
    );
    if (m && /^urn:li:fsd_profile:/.test(e.entityUrn)) return e.entityUrn;
    if (m && m[1] && m[1].startsWith('ACoA')) return `urn:li:fsd_profile:${m[1]}`;
  }
  return null;
}

// ───────────────────────── Parsing ──────────────────────────
function buildProfile(included) {
  const typed = (suffix) => included.filter((e) => (e['$type'] || '').endsWith(suffix));
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter((e) => {
      const k = e.entityUrn || JSON.stringify(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const companyByUrn = {};
  for (const c of typed('organization.Company')) {
    if (c.entityUrn) companyByUrn[c.entityUrn] = c.url || '';
  }
  const geoByUrn = {};
  for (const g of typed('common.Geo')) {
    if (g.entityUrn) geoByUrn[g.entityUrn] = g.defaultLocalizedName || '';
  }

  const profile = {
    name: '', headline: '', location: '', about: '',
    experience: [], education: [], skills: [], certifications: [],
    languages: [], projects: [], recommendations: [],
  };

  // Several calls return a Profile entity; keep the richest (the one with the
  // summary / geo), not whichever arrived first.
  const p = typed('profile.Profile').sort(
    (a, b) => Object.keys(b).length - Object.keys(a).length
  )[0];
  if (p) {
    profile.name = [p.firstName || enUS(p.multiLocaleFirstName), p.lastName || enUS(p.multiLocaleLastName)]
      .filter(Boolean).join(' ').trim();
    profile.headline = p.headline || enUS(p.multiLocaleHeadline) || '';
    profile.about = p.summary || enUS(p.multiLocaleSummary) || '';
    const geoUrn = p.geoLocation && p.geoLocation.geoUrn;
    profile.location = (geoUrn && geoByUrn[geoUrn]) || p.locationName || '';
  }

  // Experience — Positions carry the full detail; PositionGroups only group them.
  profile.experience = dedupe(typed('profile.Position')).map((pos) => {
    const r = fmtRange(pos.dateRange);
    const exp = {
      title: pos.title || enUS(pos.multiLocaleTitle) || '',
      company: pos.companyName || enUS(pos.multiLocaleCompanyName) || '',
      location: pos.locationName || pos.geoLocationName || enUS(pos.multiLocaleLocationName) || '',
      startDate: r.startDate,
      endDate: r.endDate,
      description: pos.description || enUS(pos.multiLocaleDescription) || '',
    };
    const url = companyByUrn[pos.companyUrn];
    if (url) exp.companyLinkedInUrl = url;
    return exp;
  });

  profile.education = dedupe(typed('profile.Education')).map((ed) => {
    const r = fmtRange(ed.dateRange);
    return {
      school: ed.schoolName || enUS(ed.multiLocaleSchoolName) || '',
      degree: ed.degreeName || enUS(ed.multiLocaleDegreeName) || '',
      fieldOfStudy: ed.fieldOfStudy || enUS(ed.multiLocaleFieldOfStudy) || '',
      startDate: r.startDate,
      endDate: r.endDate,
      description: ed.description || enUS(ed.multiLocaleDescription) || '',
    };
  });

  profile.skills = dedupe(typed('profile.Skill'))
    .map((s) => s.name || enUS(s.multiLocaleName) || '')
    .filter(Boolean);

  profile.certifications = dedupe(typed('profile.Certification')).map((c) => {
    const r = fmtRange(c.dateRange);
    return {
      name: c.name || enUS(c.multiLocaleName) || '',
      issuer: c.authority || enUS(c.multiLocaleAuthority) || '',
      issueDate: r.startDate,
      credentialId: c.licenseNumber || enUS(c.multiLocaleLicenseNumber) || '',
      credentialUrl: c.url || '',
    };
  });

  profile.languages = dedupe(typed('profile.Language')).map((l) => ({
    name: l.name || enUS(l.multiLocaleName) || '',
    proficiency: (l.proficiency || '').replace(/_/g, ' ').toLowerCase(),
  }));

  return profile;
}

// ─────────────────────────── Main ───────────────────────────
async function main() {
  console.log('LinkedIn Profile Scraper v4 (Voyager API)');
  console.log('=========================================\n');
  console.log(`Profile: ${PROFILE_URL}  (id: ${PUBLIC_ID})`);

  const isHeadless = process.env.HEADLESS !== 'false';
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: isHeadless,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    slowMo: 20,
    viewport: { width: 1280, height: 900 },
    userAgent: USER_AGENT,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = context.pages()[0] || (await context.newPage());

  const included = [];

  try {
    await login(page, context);

    // Land on the profile origin so same-origin fetch + cookies work.
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    console.log('\nFetching profile core...');
    const dash = await voyagerGet(page, dashUrl());
    if (!dash || !dash.included) throw new Error('Could not load profile core (dash empty)');
    included.push(...dash.included);

    const profileUrn = extractProfileUrn(dash.included);
    if (!profileUrn) throw new Error('Could not derive profile URN');
    console.log(`Profile URN: ${profileUrn}`);

    // Complete, un-capped lists per section.
    const finders = [
      ['profilePositions', 'experience'],
      ['profileEducations', 'education'],
      ['profileSkills', 'skills'],
      ['profileCertifications', 'certifications'],
      ['profileLanguages', 'languages'],
    ];
    for (const [resource, label] of finders) {
      const res = await voyagerGet(page, finderUrl(resource, profileUrn));
      const n = res && res.included ? res.included.length : 0;
      if (res && res.included) included.push(...res.included);
      console.log(`  ${label}: +${n} entities`);
    }

    const profile = buildProfile(included);
    writeFileSync(OUTPUT_FILE, JSON.stringify(profile, null, 2), 'utf-8');
    await downloadPhoto(page, included);

    console.log('\n========== RESULT ==========');
    console.log(`Name:            ${profile.name}`);
    console.log(`Headline:        ${profile.headline}`);
    console.log(`Location:        ${profile.location}`);
    console.log(`About:           ${profile.about ? profile.about.length + ' chars' : '—'}`);
    console.log(`Experience:      ${profile.experience.length}`);
    console.log(`Education:       ${profile.education.length}`);
    console.log(`Skills:          ${profile.skills.length}`);
    console.log(`Certifications:  ${profile.certifications.length}`);
    console.log(`Languages:       ${profile.languages.length}`);
    console.log(`\n✓ Saved to ${OUTPUT_FILE}`);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await context.close();
  }
}

// ─────────────────────────── Avatar (#333) ───────────────────────────
// LinkedIn is the designated portrait source when no other exists (owner
// directive 2026-09-14). Extraction lives in extract-photo.js so it is
// unit-tested (extract-photo.test.js) without a live session.

async function downloadPhoto(page, included) {
  // Everything — extraction included — stays inside the try: this leg must
  // never abort main() after profile_data.json is written (#422 round 1,
  // finding 3: an extraction throw used to suppress the RESULT block).
  try {
    const url = extractPhotoUrl(included);
    if (!url) {
      console.log('Photo:           — (no avatar in the profile payload)');
      return;
    }
    // page.request rides the authenticated session's cookies.
    const res = await page.request.get(url);
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
    const body = await res.body();
    writeFileSync(PHOTO_FILE, body);
    console.log(`Photo:           ${body.length} bytes -> ${PHOTO_FILE} (gitignored; upload via /linkedin-sync step 3)`);
  } catch (err) {
    // The photo is a nice-to-have leg of the scrape — never fail the profile run over it.
    console.log(`Photo:           download failed (${err.message}) — continuing without`);
  }
}

main();
