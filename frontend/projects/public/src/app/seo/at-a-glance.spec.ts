import { describe, it, expect } from 'vitest';
import { Profile } from '../services/profile.service';
import { buildAtAGlance } from './at-a-glance';

const PROFILE: Profile = {
    name: 'Jane Doe',
    headline: 'Staff Engineer @ Acme | Go, Rust | Solutions Architect',
    location: 'Berlin, Brandenburg, Germany',
    about: 'Builds Go services.',
    skills: ['Rust', 'Go', 'Kubernetes'],
    experience: [{ title: 'Staff Engineer', company: 'Acme &amp; Co', startDate: '2022', endDate: 'Present' }],
    education: [],
    certifications: [
        { name: 'Cloud Pro', issuer: 'Example Institute', issueDate: 'Aug 2026', credentialUrl: 'https://v.example/1' },
        { name: 'Bare Cert', issuer: '' },
    ],
    languages: [
        { name: 'English', proficiency: 'native' },
        { name: 'German', proficiency: 'professional' },
    ],
};

describe('buildAtAGlance', () => {
    it('states name, role, specialisation and location as plain English sentences', () => {
        const glance = buildAtAGlance(PROFILE, 'open', 'en')!;
        expect(glance.heading).toBe('At a glance');
        expect(glance.lead).toBe(
            'Jane Doe is a Staff Engineer & Solutions Architect based in Berlin, Germany. ' +
                'Specialises in Go, Rust and Kubernetes. Open to new opportunities.',
        );
        expect(glance.items).toEqual([
            {
                question: 'Who is Jane Doe?',
                answer: 'Jane Doe is a Staff Engineer & Solutions Architect at Acme & Co, based in Berlin, Germany.',
            },
            { question: 'What does Jane Doe specialise in?', answer: 'Go, Rust and Kubernetes.' },
            {
                question: 'Which certifications does Jane Doe hold?',
                answer: 'Cloud Pro (Example Institute); Bare Cert.',
            },
            { question: 'Where is Jane Doe based?', answer: 'Berlin, Brandenburg, Germany.' },
            { question: 'Which languages does Jane Doe speak?', answer: 'English and German.' },
            {
                question: 'Is Jane Doe available for new roles?',
                answer: 'Yes — actively looking for new opportunities. Use the contact form below.',
            },
        ]);
    });

    it('speaks German for lang=de', () => {
        const glance = buildAtAGlance(PROFILE, 'not_looking', 'de')!;
        expect(glance.heading).toBe('Auf einen Blick');
        expect(glance.items[0]).toEqual({
            question: 'Wer ist Jane Doe?',
            answer: 'Jane Doe ist Staff Engineer & Solutions Architect bei Acme & Co, ansässig in Berlin, Germany.',
        });
        expect(glance.items.at(-1)).toEqual({
            question: 'Ist Jane Doe offen für neue Aufgaben?',
            answer: 'Derzeit nicht auf der Suche nach neuen Aufgaben.',
        });
    });

    it('omits every answer its data cannot support', () => {
        const sparse: Profile = {
            name: 'Jane Doe',
            headline: 'Engineer',
            location: '',
            about: '',
            skills: [],
            experience: [],
            education: [],
        };
        const glance = buildAtAGlance(sparse, 'unknown', 'en')!;
        expect(glance.lead).toBe('Jane Doe is an Engineer.');
        expect(glance.items).toEqual([{ question: 'Who is Jane Doe?', answer: 'Jane Doe is an Engineer.' }]);
        expect(buildAtAGlance(sparse, 'listening', 'de')!.items[0].answer).toBe('Jane Doe ist Engineer.');
    });

    it('is null without a profile, a name or a role', () => {
        expect(buildAtAGlance(null, 'open', 'en')).toBeNull();
        expect(buildAtAGlance(undefined, 'open', 'en')).toBeNull();
        expect(buildAtAGlance({ ...PROFILE, name: '' }, 'open', 'en')).toBeNull();
        expect(buildAtAGlance({ ...PROFILE, headline: '' }, 'open', 'en')).toBeNull();
    });
});
