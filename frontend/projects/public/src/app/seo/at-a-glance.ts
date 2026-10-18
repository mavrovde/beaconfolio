import { Profile } from '../services/profile.service';
import { phrasesFor, rankSkills, rolesLabel, shortLocation, skillLabel } from './identity';
import { buildCredentials, buildWorksFor } from './person-schema';
import { affix, indefiniteArticle, toPlainText } from './text';

/**
 * The "At a glance" block: a short, VISIBLE, server-rendered summary plus
 * question/answer pairs, composed entirely from the profile data and the
 * site-config availability.
 *
 * Why it exists: answer engines and search snippets quote the first plain
 * sentences a page states. The hero is a greeting and a pipe-joined headline;
 * nothing in the first screen said "X is a Y based in Z who specialises in…"
 * as a sentence. This block does, in the visitor's language, and every fact
 * in it is the owner's own data.
 *
 * It is deliberately NOT emitted as `FAQPage` JSON-LD: Google restricts that
 * rich result to authoritative government/health sites, so the markup would
 * claim something it cannot earn. Real text on the page is the signal.
 */

export interface GlanceItem {
    question: string;
    answer: string;
}

export interface AtAGlance {
    heading: string;
    lead: string;
    items: GlanceItem[];
}

const MAX_GLANCE_SKILLS = 8;
const MAX_GLANCE_CREDENTIALS = 5;

const TEXT = {
    en: {
        heading: 'At a glance',
        who: (name: string) => `Who is ${name}?`,
        whoAnswer: (name: string, roles: string, employer: string, where: string) =>
            `${name} is ${indefiniteArticle(roles)} ${roles}${affix(' at ', employer)}${affix(', based in ', where)}.`,
        focus: (name: string) => `What does ${name} specialise in?`,
        certs: (name: string) => `Which certifications does ${name} hold?`,
        where: (name: string) => `Where is ${name} based?`,
        languages: (name: string) => `Which languages does ${name} speak?`,
        available: (name: string) => `Is ${name} available for new roles?`,
        availability: {
            open: 'Yes — actively looking for new opportunities. Use the contact form below.',
            listening: 'Open to hearing about new opportunities. Use the contact form below.',
            not_looking: 'Not currently looking for new opportunities.',
        } as Record<string, string | undefined>,
    },
    de: {
        heading: 'Auf einen Blick',
        who: (name: string) => `Wer ist ${name}?`,
        whoAnswer: (name: string, roles: string, employer: string, where: string) =>
            `${name} ist ${roles}${affix(' bei ', employer)}${affix(', ansässig in ', where)}.`,
        focus: (name: string) => `Worauf ist ${name} spezialisiert?`,
        certs: (name: string) => `Welche Zertifizierungen hat ${name}?`,
        where: (name: string) => `Wo ist ${name} ansässig?`,
        languages: (name: string) => `Welche Sprachen spricht ${name}?`,
        available: (name: string) => `Ist ${name} offen für neue Aufgaben?`,
        availability: {
            open: 'Ja — aktiv auf der Suche nach neuen Aufgaben. Nutzen Sie das Kontaktformular unten.',
            listening: 'Offen für Gespräche über neue Aufgaben. Nutzen Sie das Kontaktformular unten.',
            not_looking: 'Derzeit nicht auf der Suche nach neuen Aufgaben.',
        } as Record<string, string | undefined>,
    },
};

function list(items: readonly string[], and: string): string {
    return items.length > 1
        ? `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)}`
        : items.join('');
}

/** Compose the block; `null` when the profile cannot support even its first answer. */
export function buildAtAGlance(
    profile: Profile | null | undefined,
    availability: string,
    lang: string,
): AtAGlance | null {
    const name = toPlainText(profile?.name);
    const roles = rolesLabel(profile?.headline);
    if (!profile || !name || !roles) {
        return null;
    }
    const text = lang === 'de' ? TEXT.de : TEXT.en;
    const phrases = phrasesFor(lang);
    const where = shortLocation(profile.location);
    const employer = toPlainText(buildWorksFor(profile.experience)?.name);
    const skills = rankSkills(profile.skills, profile.headline, profile.about)
        .slice(0, MAX_GLANCE_SKILLS)
        .map(skillLabel);

    const lead = [
        phrases.is(name, roles, where),
        skills.length ? phrases.skills(list(skills.slice(0, 5), phrases.and)) : '',
        phrases.availability[availability] ?? '',
    ]
        .filter(Boolean)
        .join(' ');

    const items: GlanceItem[] = [
        { question: text.who(name), answer: text.whoAnswer(name, roles, employer, where) },
    ];
    if (skills.length) {
        items.push({ question: text.focus(name), answer: `${list(skills, phrases.and)}.` });
    }
    const credentials = (buildCredentials(profile.certifications) ?? []).slice(
        0,
        MAX_GLANCE_CREDENTIALS,
    );
    if (credentials.length) {
        items.push({
            question: text.certs(name),
            answer: `${credentials
                .map((credential) =>
                    credential.recognizedBy
                        ? `${credential.name} (${credential.recognizedBy.name})`
                        : credential.name,
                )
                .join('; ')}.`,
        });
    }
    const location = toPlainText(profile.location);
    if (location) {
        items.push({ question: text.where(name), answer: `${location}.` });
    }
    const languages = (profile.languages ?? [])
        .map((language) => toPlainText(language.name))
        .filter(Boolean);
    if (languages.length) {
        items.push({ question: text.languages(name), answer: `${list(languages, phrases.and)}.` });
    }
    const availabilityAnswer = text.availability[availability];
    if (availabilityAnswer) {
        items.push({ question: text.available(name), answer: availabilityAnswer });
    }
    return { heading: text.heading, lead, items };
}
