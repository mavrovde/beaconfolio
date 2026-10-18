import { describe, it, expect } from 'vitest';
import { PLAIN_TEXT, XML, sendGeneratedFile } from './send-text';

function fakeResponse() {
    const headers: Record<string, string> = {};
    const sent: string[] = [];
    return {
        headers,
        sent,
        setHeader(name: string, value: string) {
            headers[name.toLowerCase()] = value;
        },
        send(body: string) {
            sent.push(body);
        },
    };
}

describe('sendGeneratedFile', () => {
    it('declares the non-HTML type and forbids sniffing before sending the body', () => {
        const res = fakeResponse();
        sendGeneratedFile(res, PLAIN_TEXT, '# Owner <script>x</script>');
        expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.sent).toEqual(['# Owner <script>x</script>']);
    });

    it('serves XML as application/xml', () => {
        const res = fakeResponse();
        sendGeneratedFile(res, XML, '<urlset/>');
        expect(res.headers['content-type']).toBe('application/xml; charset=utf-8');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
});
