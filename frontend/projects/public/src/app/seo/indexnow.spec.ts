import { describe, it, expect } from 'vitest';
import { indexNowKeyPath, resolveIndexNowKey } from './indexnow';

describe('resolveIndexNowKey', () => {
    it.each([undefined, '', '   '])('is OFF (no key, no warning) for %j', (raw) => {
        expect(resolveIndexNowKey(raw)).toEqual({ key: '', warning: '' });
    });

    it.each(['abcd1234', 'A-b-C-d-1-2-3-4', 'f'.repeat(128), '  0123456789abcdef0123456789abcdef  '])(
        'accepts a spec-conforming key %j (trimmed)',
        (raw) => {
            expect(resolveIndexNowKey(raw)).toEqual({ key: raw.trim(), warning: '' });
        },
    );

    it.each(['short', 'f'.repeat(129), 'has space1', 'under_score1', 'slash/../x1', 'dots.not.ok'])(
        'rejects %j with a warning that does not echo the value',
        (raw) => {
            const result = resolveIndexNowKey(raw);
            expect(result.key).toBe('');
            expect(result.warning).toContain('INDEXNOW_KEY');
            expect(result.warning).not.toContain(raw);
        },
    );
});

describe('indexNowKeyPath', () => {
    it('serves the key file at the site root', () => {
        expect(indexNowKeyPath('abcd1234')).toBe('/abcd1234.txt');
    });
});
