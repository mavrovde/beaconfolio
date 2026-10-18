import { describe, it, expect } from 'vitest';
import {
    buildHomeDescription,
    buildHomeTitle,
    buildKeywords,
    buildPageTitle,
    extractRoles,
    IdentityInput,
    locality,
    MAX_DESCRIPTION_LENGTH,
    MAX_TITLE_LENGTH,
    phrasesFor,
    primaryRole,
    rankSkills,
    rolesLabel,
    shortLocation,
    skillLabel,
} from './identity';

/**
 * Fixtures are the demo persona's SHAPE with LinkedIn-style data — the
 * builders must reproduce the measured live problems (a pipe-joined headline
 * with an employer, an escaped `&amp;`, a 3-part location) without any of it
 * being written into the code.
 */
const LINKEDIN: IdentityInput = {
    name: 'Jane Doe',
    headline: 'Principal Software Engineer @ Acme SE | Java Enterprise, Python, AI &amp; MCP | Solutions Architect',
    location: 'Aachen, North Rhine-Westphalia, Germany',
    about: 'Principal Software Engineer &amp; Architect focused on Kubernetes platforms.',
    skills: ['Physics', 'Kubernetes', 'Model Context Protocol (MCP)', 'Python (Programming Language)', 'Java'],
    availability: 'listening',
    lang: 'en',
};

describe('extractRoles / primaryRole / rolesLabel', () => {
    it('takes the first segment without its employer, plus later role-like segments', () => {
        expect(extractRoles(LINKEDIN.headline)).toEqual(['Principal Software Engineer', 'Solutions Architect']);
        expect(primaryRole(LINKEDIN.headline)).toBe('Principal Software Engineer');
        expect(rolesLabel(LINKEDIN.headline)).toBe('Principal Software Engineer & Solutions Architect');
    });

    it.each([
        ['Staff Engineer at Initech', 'Staff Engineer'],
        ['Data Scientist - Machine Learning', 'Data Scientist'],
        ['Photographer', 'Photographer'],
        ['Softwareentwickler | Berater', 'Softwareentwickler'],
    ])('%j -> %j', (headline, expected) => {
        expect(primaryRole(headline)).toBe(expected);
    });

    it('keeps a German role segment and drops duplicates and blanks', () => {
        expect(extractRoles('Entwickler | | Berater | entwickler')).toEqual(['Entwickler', 'Berater']);
    });

    it('is empty without a headline', () => {
        expect(extractRoles(undefined)).toEqual([]);
        expect(primaryRole('')).toBe('');
        expect(rolesLabel(undefined)).toBe('');
    });
});

describe('locality / shortLocation', () => {
    it('reduces a three-part location', () => {
        expect(locality(LINKEDIN.location)).toBe('Aachen');
        expect(shortLocation(LINKEDIN.location)).toBe('Aachen, Germany');
    });

    it('handles one part and none', () => {
        expect(shortLocation('Berlin')).toBe('Berlin');
        expect(shortLocation(undefined)).toBe('');
        expect(locality('')).toBe('');
    });
});

describe('rankSkills / skillLabel', () => {
    it('ranks skills named in the headline, then the about text, then profile order', () => {
        expect(rankSkills(LINKEDIN.skills, LINKEDIN.headline, LINKEDIN.about)).toEqual([
            'Model Context Protocol (MCP)', // headline (MCP)
            'Python (Programming Language)', // headline (Python)
            'Java', // headline ("Java Enterprise")
            'Kubernetes', // about only
            'Physics', // nowhere: profile order
        ]);
    });

    it('matches whole words only, so "Go" does not match "Google"', () => {
        expect(rankSkills(['Rust', 'Go'], 'Google fan', '')).toEqual(['Rust', 'Go']);
    });

    it('drops blanks and case-insensitive duplicates, decoding entities', () => {
        expect(rankSkills(['A&amp;B', 'a&b', '', 'C'])).toEqual(['A&B', 'C']);
        expect(rankSkills(undefined)).toEqual([]);
    });

    it.each([
        ['Model Context Protocol (MCP)', 'MCP'],
        ['Python (Programming Language)', 'Python'],
        ['Retrieval-Augmented Generation (RAG)', 'RAG'],
        ['Kubernetes', 'Kubernetes'],
    ])('labels %j as %j', (skill, expected) => {
        expect(skillLabel(skill)).toBe(expected);
    });
});

describe('buildHomeTitle', () => {
    it('drops whole parts until the title fits in 60 characters', () => {
        // "{name} - {both roles} | Aachen" is 67 chars → the second role goes first.
        const title = buildHomeTitle(LINKEDIN);
        expect(title).toBe('Jane Doe - Principal Software Engineer & Solutions Architect');
        expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    });

    it('keeps the city when it fits', () => {
        expect(buildHomeTitle({ name: 'Jane Doe', headline: 'Engineer | Architect', location: 'Berlin, DE' })).toBe(
            'Jane Doe - Engineer & Architect | Berlin',
        );
    });

    it('falls back to one role + city, then one role', () => {
        const longSecond = { ...LINKEDIN, name: 'Janet Doe-Smithson', headline: 'Principal Software Engineer | Principal Solutions Architect' };
        expect(buildHomeTitle(longSecond)).toBe('Janet Doe-Smithson - Principal Software Engineer | Aachen');
        expect(buildHomeTitle({ ...longSecond, location: 'Aachen-Oberforstbach-Walheim-Kornelimünster' })).toBe(
            'Janet Doe-Smithson - Principal Software Engineer',
        );
    });

    it('word-cuts a name + role that can never fit', () => {
        const title = buildHomeTitle({ name: 'A Very Long Owner Name Indeed', headline: 'Distinguished Principal Staff Software Engineer' });
        expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
        expect(title).not.toMatch(/…$/);
    });

    it('is just the name without a headline, and honours a configured override', () => {
        expect(buildHomeTitle({ name: 'Jane Doe' })).toBe('Jane Doe');
        expect(buildHomeTitle(LINKEDIN, { seoTitle: '  My &amp; own title  ' })).toBe('My & own title');
    });
});

describe('buildPageTitle', () => {
    it('brands the page title when it fits', () => {
        expect(buildPageTitle('Blog', 'Jane Doe')).toBe('Blog | Jane Doe');
    });

    it('drops the brand, then word-cuts, for a long post title — no ellipsis', () => {
        const page = 'Are Heavy Frameworks Still the Default Choice in the AI Era?';
        expect(buildPageTitle(page, 'Jane Doe')).toBe(page);
        const longer = `${page} A Field Report`;
        const title = buildPageTitle(longer, 'Jane Doe');
        expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
        expect(title).toBe('Are Heavy Frameworks Still the Default Choice in the AI Era?');
    });

    it('works without an owner name', () => {
        expect(buildPageTitle('Blog', '')).toBe('Blog');
    });
});

describe('buildHomeDescription', () => {
    it('composes whole, plain-text sentences within 155 characters', () => {
        const description = buildHomeDescription(LINKEDIN);
        expect(description).toBe(
            'Jane Doe is a Principal Software Engineer & Solutions Architect based in Aachen, Germany. ' +
                'Specialises in MCP, Python, Java and Kubernetes.',
        );
        expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
        expect(description).not.toContain('&amp;');
    });

    it('adds the availability signal and about sentences while they fit', () => {
        expect(
            buildHomeDescription({
                name: 'Jane Doe',
                headline: 'Engineer',
                location: 'Berlin',
                skills: ['Go'],
                about: 'Builds things. ' + 'x'.repeat(200) + '.',
                availability: 'open',
            }),
        ).toBe('Jane Doe is an Engineer based in Berlin. Specialises in Go. Open to new opportunities. Builds things.');
    });

    it('omits the place clause without a location and writes German for lang=de', () => {
        expect(buildHomeDescription({ name: 'Jane Doe', headline: 'Entwicklerin', skills: ['Go', 'Rust'], lang: 'de', availability: 'listening' })).toBe(
            'Jane Doe ist Entwicklerin. Schwerpunkte: Go und Rust. Offen für Gespräche über neue Aufgaben.',
        );
        expect(buildHomeDescription({ name: 'J', headline: 'Dev', location: 'Berlin', lang: 'de' })).toBe('J ist Dev in Berlin.');
    });

    it('falls back to the word-cut about text, then the name, when nothing composes', () => {
        expect(buildHomeDescription({ name: 'Jane', about: 'word '.repeat(50) })).toMatch(/^word( word)+$/);
        expect(buildHomeDescription({ name: 'Jane' })).toBe('Jane');
    });

    it('skips a skills sentence that cannot fit even with one skill', () => {
        const description = buildHomeDescription({
            name: 'Jane Doe',
            headline: 'Engineer',
            skills: ['s'.repeat(150)],
        });
        expect(description).toBe('Jane Doe is an Engineer.');
    });

    it('honours a configured override, word-cut', () => {
        expect(buildHomeDescription(LINKEDIN, { seoDescription: 'Own words.' })).toBe('Own words.');
    });

    it('phrasesFor falls back to English', () => {
        expect(phrasesFor('fr')).toBe(phrasesFor('en'));
    });
});

describe('buildKeywords', () => {
    it('is the roles, the city and the top skills — never the raw headline', () => {
        const keywords = buildKeywords(LINKEDIN);
        expect(keywords).toBe(
            'Principal Software Engineer, Solutions Architect, Aachen, MCP, Python, Java, Kubernetes, Physics',
        );
        expect(keywords).not.toContain('@');
        expect(keywords).not.toContain('|');
    });

    it('deduplicates case-insensitively and skips empty parts', () => {
        expect(buildKeywords({ name: 'J', headline: 'Go', skills: ['go', 'Rust'] })).toBe('Go, Rust');
    });

    it('honours a configured override', () => {
        expect(buildKeywords(LINKEDIN, { seoKeywords: 'a, b' })).toBe('a, b');
    });
});
