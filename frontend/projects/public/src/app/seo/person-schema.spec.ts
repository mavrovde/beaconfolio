import { describe, it, expect } from 'vitest';
import {
    buildAddress,
    buildAlumniOf,
    buildCredentials,
    buildPersonSchema,
    buildSameAs,
    buildSeeks,
    buildWorksFor,
    isOngoingRole,
    MAX_CREDENTIALS,
    personId,
    toIsoDate,
} from './person-schema';
import { MAX_SCHEMA_SKILLS } from './identity';
import { Experience, Profile } from '../services/profile.service';
import { SiteConfig } from '../services/site-config.service';

const role = (over: Partial<Experience> = {}): Experience => ({
    title: 'Senior Software Engineer',
    company: 'Acme Cloud GmbH',
    startDate: 'Mar 2022',
    endDate: 'Present',
    ...over,
});

const FULL_PROFILE: Profile = {
    name: 'Jane Doe',
    headline: 'Senior Software Engineer',
    location: 'Berlin, Germany',
    about: 'Builds distributed systems.',
    skills: ['Python', 'Angular'],
    experience: [
        role({ company: 'Initech Solutions', endDate: 'Feb 2022' }),
        role({ companyLinkedInUrl: 'https://www.linkedin.com/company/acme/' }),
    ],
    education: [
        { school: 'Example Technical University', degree: 'M.Sc.', years: '2014 - 2016' },
        { school: 'Example University', degree: 'B.Sc.', years: '2011 - 2014' },
    ],
};

const FULL_SITE: SiteConfig = {
    siteName: 'My Portfolio',
    siteUrl: 'https://example.com',
    ownerName: 'Jane Doe',
    ownerHeadline: 'Senior Software Engineer',
    ownerDescription: 'Portfolio.',
    socialLinks: ['https://www.linkedin.com/in/jane/'],
    analyticsId: '',
    availability: 'open',
};

describe('isOngoingRole', () => {
    it.each([
        ['Present', true],
        ['Heute', true],
        ['', true],
        ['Feb 2022', false],
        ['1999', false],
    ])('endDate %j is ongoing: %s', (endDate, expected) => {
        expect(isOngoingRole(role({ endDate }))).toBe(expected);
    });

    it('treats a missing endDate as ongoing', () => {
        expect(isOngoingRole({ ...role(), endDate: undefined as unknown as string })).toBe(true);
    });
});

describe('buildAddress', () => {
    it('splits locality and country', () => {
        expect(buildAddress('Berlin, Germany')).toEqual({
            '@type': 'PostalAddress',
            addressLocality: 'Berlin',
            addressCountry: 'Germany',
        });
    });

    it('emits locality only when there is no country part', () => {
        expect(buildAddress('Berlin')).toEqual({
            '@type': 'PostalAddress',
            addressLocality: 'Berlin',
        });
    });

    it.each([undefined, '', '  ', ','])('returns undefined for %j', (location) => {
        expect(buildAddress(location)).toBeUndefined();
    });
});

describe('buildWorksFor', () => {
    it('picks the first role without an end year and carries its company URL', () => {
        expect(
            buildWorksFor([
                role({ company: 'Initech Solutions', endDate: 'Feb 2022' }),
                role({ companyLinkedInUrl: 'https://www.linkedin.com/company/acme/' }),
            ]),
        ).toEqual({
            '@type': 'Organization',
            name: 'Acme Cloud GmbH',
            url: 'https://www.linkedin.com/company/acme/',
        });
    });

    it.each([[{ companyLinkedInUrl: '   ' }], [{ companyLinkedInUrl: undefined }], [{}]])(
        'omits url when the company link is blank or absent (%#)',
        (over) => {
            expect(buildWorksFor([role(over)])).toEqual({
                '@type': 'Organization',
                name: 'Acme Cloud GmbH',
            });
        },
    );

    it('ignores an ongoing role with no company name', () => {
        expect(buildWorksFor([role({ company: '' })])).toBeUndefined();
    });

    it.each([[undefined], [[]], [[role({ endDate: 'Feb 2022' })]]])(
        'returns undefined when nothing is ongoing (%#)',
        (experience) => {
            expect(buildWorksFor(experience)).toBeUndefined();
        },
    );
});

describe('buildAlumniOf', () => {
    it('maps every named school', () => {
        expect(
            buildAlumniOf([
                { school: 'Example Technical University', degree: 'M.Sc.', years: '2014 - 2016' },
                { school: ' Example University ', degree: 'B.Sc.', years: '2011 - 2014' },
            ]),
        ).toEqual([
            { '@type': 'EducationalOrganization', name: 'Example Technical University' },
            { '@type': 'EducationalOrganization', name: 'Example University' },
        ]);
    });

    it.each([
        [undefined],
        [[]],
        [[{ school: '  ', degree: 'M.Sc.', years: '2014' }]],
    ])('returns undefined when there is no named school (%#)', (education) => {
        expect(buildAlumniOf(education)).toBeUndefined();
    });

    it('tolerates an entry with no school field at all', () => {
        expect(buildAlumniOf([{ degree: 'M.Sc.', years: '2014' } as never])).toBeUndefined();
    });
});

describe('buildSeeks (open-to-work signal, #71 AC5)', () => {
    it('emits a Demand for an actively looking owner', () => {
        expect(buildSeeks('open')).toEqual({
            '@type': 'Demand',
            name: 'Open to new opportunities',
        });
    });

    it('emits a softer Demand while only listening', () => {
        expect(buildSeeks('listening')).toEqual({
            '@type': 'Demand',
            name: 'Open to hearing about new opportunities',
        });
    });

    it('emits nothing when the owner is not looking', () => {
        expect(buildSeeks('not_looking')).toBeUndefined();
    });
});

describe('buildPersonSchema', () => {
    it('assembles the enriched Person node from profile + site config', () => {
        expect(buildPersonSchema(FULL_PROFILE, FULL_SITE)).toEqual({
            '@type': 'Person',
            '@id': 'https://example.com/#person',
            name: 'Jane Doe',
            jobTitle: 'Senior Software Engineer',
            url: 'https://example.com/',
            image: 'https://example.com/api/app/profile/photo',
            description: 'Builds distributed systems.',
            sameAs: ['https://www.linkedin.com/in/jane/'],
            knowsAbout: ['Python', 'Angular'],
            hasOccupation: {
                '@type': 'Occupation',
                name: 'Senior Software Engineer',
                skills: ['Python', 'Angular'],
            },
            worksFor: {
                '@type': 'Organization',
                name: 'Acme Cloud GmbH',
                url: 'https://www.linkedin.com/company/acme/',
            },
            alumniOf: [
                { '@type': 'EducationalOrganization', name: 'Example Technical University' },
                { '@type': 'EducationalOrganization', name: 'Example University' },
            ],
            address: { '@type': 'PostalAddress', addressLocality: 'Berlin', addressCountry: 'Germany' },
            seeks: { '@type': 'Demand', name: 'Open to new opportunities' },
        });
    });

    it('omits every optional property rather than emitting an empty one', () => {
        const bare = buildPersonSchema(
            {
                name: 'Jane Doe',
                headline: '',
                location: '',
                about: '',
                skills: [],
                experience: [],
                education: [],
            },
            { ...FULL_SITE, siteUrl: '', socialLinks: [], availability: 'not_looking' },
        );

        expect(bare).toEqual({ '@type': 'Person', name: 'Jane Doe' });
    });

    it('survives a raw uploaded profile whose optional arrays are missing entirely', () => {
        const schema = buildPersonSchema(
            { name: 'Jane Doe', headline: 'Engineer' } as unknown as Profile,
            { ...FULL_SITE, socialLinks: undefined as unknown as string[] },
        );

        expect(schema.hasOccupation).toEqual({ '@type': 'Occupation', name: 'Engineer' });
        expect(schema.knowsAbout).toBeUndefined();
        expect(schema.sameAs).toBeUndefined();
    });
});

describe('buildPersonSchema — search-entity hygiene', () => {
    const LINKEDIN_PROFILE: Profile = {
        ...FULL_PROFILE,
        // The LinkedIn shape: role @ employer | skills | second role.
        headline: 'Staff Engineer @ Acme | Go, Rust | Solutions Architect',
        about: 'Ships Rust &amp; Go services.',
        skills: Array.from({ length: 40 }, (_, i) => `Skill ${i}`).concat(['Rust', 'Go']),
        contact: { email: 'x@example.com', linkedin: 'https://linkedin.com/in/jane' },
        languages: [{ name: 'English', proficiency: 'native' }, { name: '', proficiency: '' }],
        certifications: [
            { name: 'Old Cert', issuer: 'Org A', issueDate: 'Jan 2020' },
            { name: 'New Verified', issuer: 'Org B', issueDate: 'Aug 2026', credentialUrl: 'https://verify.example/1' },
        ],
    };

    it('uses the SHORT role as jobTitle, never the whole headline', () => {
        const schema = buildPersonSchema(LINKEDIN_PROFILE, FULL_SITE);
        expect(schema.jobTitle).toBe('Staff Engineer');
        expect(schema.hasOccupation?.name).toBe('Staff Engineer');
    });

    it('caps knowsAbout at the top skills, the ones the headline names first', () => {
        const schema = buildPersonSchema(LINKEDIN_PROFILE, FULL_SITE);
        expect(schema.knowsAbout).toHaveLength(MAX_SCHEMA_SKILLS);
        // Both are named in headline AND about (score 3); the profile order breaks the tie.
        expect(schema.knowsAbout?.slice(0, 2)).toEqual(['Rust', 'Go']);
        expect(schema.hasOccupation?.skills).toEqual(schema.knowsAbout);
    });

    it('decodes the escaped about text into a plain description', () => {
        expect(buildPersonSchema(LINKEDIN_PROFILE, FULL_SITE).description).toBe('Ships Rust & Go services.');
    });

    it('merges the profile LinkedIn URL into sameAs, deduplicated', () => {
        const schema = buildPersonSchema(LINKEDIN_PROFILE, {
            ...FULL_SITE,
            socialLinks: ['https://www.linkedin.com/in/jane/', 'https://github.com/jane'],
        });
        expect(schema.sameAs).toEqual(['https://www.linkedin.com/in/jane/', 'https://github.com/jane']);
    });

    it('lists spoken languages and the verifiable credentials first', () => {
        const schema = buildPersonSchema(LINKEDIN_PROFILE, FULL_SITE);
        expect(schema.knowsLanguage).toEqual(['English']);
        expect(schema.hasCredential?.map((c) => c.name)).toEqual(['New Verified', 'Old Cert']);
    });

    it('falls back to the configured owner name when the profile has none', () => {
        expect(buildPersonSchema({ ...FULL_PROFILE, name: '' }, FULL_SITE).name).toBe('Jane Doe');
    });

    it('builds the stable id from the site URL, trailing slash or not', () => {
        expect(personId('https://example.com/')).toBe('https://example.com/#person');
        expect(buildPersonSchema(FULL_PROFILE, { ...FULL_SITE, siteUrl: 'https://example.com/' })['@id']).toBe(
            'https://example.com/#person',
        );
    });
});

describe('toIsoDate', () => {
    it.each([
        ['Aug 2026', '2026-08'],
        ['September 2025', '2025-09'],
        ['Mai 2024', '2024-05'],
        ['März 2023', '2023-03'],
        ['2024', '2024'],
        ['2024-05-01', '2024-05-01'],
        ['Foo 2024', undefined],
        ['soon', undefined],
        ['', undefined],
        [undefined, undefined],
    ])('%j -> %j', (value, expected) => {
        expect(toIsoDate(value)).toBe(expected);
    });
});

describe('buildSameAs', () => {
    it('keeps https only and drops duplicates that differ by case, www or slash', () => {
        expect(
            buildSameAs([
                'https://GitHub.com/jane',
                'https://www.github.com/jane/',
                'http://insecure.example/jane',
                'mailto:jane@example.com',
                '',
                undefined,
                'https://linkedin.com/in/jane',
            ]),
        ).toEqual(['https://GitHub.com/jane', 'https://linkedin.com/in/jane']);
    });

    it('is undefined when nothing qualifies', () => {
        expect(buildSameAs(['http://x.example', undefined])).toBeUndefined();
    });
});

describe('buildCredentials', () => {
    it('maps issuer, dates and a verifiable URL', () => {
        expect(
            buildCredentials([
                {
                    name: 'Cloud Architect',
                    issuer: 'Example Institute',
                    date: 'Jan 2024',
                    expirationDate: 'Jan 2027',
                    credentialUrl: 'https://verify.example/abc',
                },
            ]),
        ).toEqual([
            {
                '@type': 'EducationalOccupationalCredential',
                name: 'Cloud Architect',
                credentialCategory: 'certificate',
                recognizedBy: { '@type': 'Organization', name: 'Example Institute' },
                dateCreated: '2024-01',
                expires: '2027-01',
                url: 'https://verify.example/abc',
            },
        ]);
    });

    it('omits what it cannot state: no issuer, no parsable date, no https URL', () => {
        expect(
            buildCredentials([{ name: 'Bare', issuer: '', date: 'someday', credentialUrl: 'http://x.example' }]),
        ).toEqual([{ '@type': 'EducationalOccupationalCredential', name: 'Bare', credentialCategory: 'certificate' }]);
    });

    it('ranks verifiable first, then newest, and caps the list', () => {
        const many = Array.from({ length: 15 }, (_, i) => ({
            name: `Cert ${i}`,
            issuer: 'Org',
            issueDate: `${2010 + i}`,
        }));
        const ranked = buildCredentials([...many, { name: 'Verified', issuer: 'Org', credentialUrl: 'https://v.example' }]);
        expect(ranked).toHaveLength(MAX_CREDENTIALS);
        expect(ranked?.[0].name).toBe('Verified');
        expect(ranked?.[1].name).toBe('Cert 14');
    });

    it('keeps the profile order between equally ranked credentials', () => {
        const ranked = buildCredentials([
            { name: 'First', issuer: 'Org', issueDate: '2024' },
            { name: 'Second', issuer: 'Org', issueDate: '2024' },
        ]);
        expect(ranked?.map((c) => c.name)).toEqual(['First', 'Second']);
    });

    it('drops nameless entries and yields undefined for none', () => {
        expect(buildCredentials([{ name: '', issuer: 'Org' }])).toBeUndefined();
        expect(buildCredentials(undefined)).toBeUndefined();
    });
});
