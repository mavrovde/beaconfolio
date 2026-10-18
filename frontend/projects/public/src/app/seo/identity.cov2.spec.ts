import { describe, it, expect } from 'vitest';
import { buildHomeDescription, extractRoles, rankSkills, skillLabel } from './identity';

/**
 * The regex rewrites on #494 (Sonar S5843 / S8786), pinned as behaviour:
 * role words are a word lookup, the separators split on one whitespace
 * character either side, the trailing parenthetical and the sentence split
 * are string scans.
 */
describe('extractRoles after the word-lookup rewrite', () => {
    it('promotes a later segment only when it names a role word', () => {
        expect(extractRoles('Staff Engineer | Java, Kotlin | Co-Founder')).toEqual([
            'Staff Engineer',
            'Co-Founder',
        ]);
        expect(extractRoles('Dev | Java, Kotlin | Spring')).toEqual(['Dev']);
    });

    it('knows the German feminine forms and the umlaut-less spelling', () => {
        expect(extractRoles('X | Softwareentwicklerin | Senior Entwicklerin | Grunderin')).toEqual([
            'X',
            'Senior Entwicklerin',
            'Grunderin',
        ]);
        expect(extractRoles('X | Gründer')).toEqual(['X', 'Gründer']);
    });

    it('does not count a role word inside a longer word', () => {
        expect(extractRoles('X | Leadership, Engineering')).toEqual(['X']);
    });

    it('cuts at a spaced dash and a spaced "at", however much whitespace surrounds them', () => {
        expect(extractRoles('Principal Engineer  —  Platforms')).toEqual(['Principal Engineer']);
        expect(extractRoles('Principal Engineer   at   ACME')).toEqual(['Principal Engineer']);
        // Unspaced: part of the role, not a separator.
        expect(extractRoles('Front-end Engineer')).toEqual(['Front-end Engineer']);
    });
});

describe('skillLabel after the parenthetical scan', () => {
    it('reads the trailing parenthetical', () => {
        expect(skillLabel('Model Context Protocol (MCP)')).toBe('MCP');
        expect(skillLabel('Python (Programming Language)  ')).toBe('Python');
    });

    it('opens the qualifier at its FIRST `(` after any earlier `)`', () => {
        expect(skillLabel('A (b (C)')).toBe('A');
        expect(skillLabel('A (x) B (RAG)')).toBe('RAG');
    });

    it('leaves a skill alone without a usable parenthetical', () => {
        expect(skillLabel('Java')).toBe('Java');
        expect(skillLabel('Java ()')).toBe('Java ()');
        expect(skillLabel('closing only)')).toBe('closing only)');
    });

    it('still ranks a skill by either of its terms', () => {
        expect(rankSkills(['Go', 'Retrieval-Augmented Generation (RAG)'], 'RAG person')).toEqual([
            'Retrieval-Augmented Generation (RAG)',
            'Go',
        ]);
    });
});

describe('buildHomeDescription sentence split', () => {
    it('keeps a decimal number inside its sentence', () => {
        const description = buildHomeDescription({
            name: 'Jane Doe',
            about: 'Shipped 3.5 years of releases. Mentors teams.',
        });
        expect(description).toBe('Shipped 3.5 years of releases. Mentors teams.');
    });

    it('uses the about text word-cut when it has no sentence end', () => {
        expect(buildHomeDescription({ name: 'Jane Doe', about: 'no punctuation here' })).toBe(
            'no punctuation here',
        );
    });

    it('treats a punctuation run as one sentence end', () => {
        expect(buildHomeDescription({ name: 'Jane Doe', about: 'Wow!!! Really?' })).toBe('Wow!!! Really?');
    });
});
