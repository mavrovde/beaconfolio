/**
 * IndexNow key-file hosting (Bing, Yandex, Seznam, Naver …).
 *
 * IndexNow proves a submitter owns a host by fetching `https://{host}/{key}.txt`
 * and comparing the body with the key. The key is PER DEPLOYMENT — each
 * forker generates their own — so it comes from the frontend container's
 * `INDEXNOW_KEY` environment variable, never from the repository. Unset or
 * empty means the feature is OFF and no route is registered at all.
 *
 * Pure so it is unit-testable; `src/server.ts` only wires the result.
 */

/** IndexNow spec: 8–128 characters of `a-z`, `A-Z`, `0-9` and `-`. */
const KEY_FORMAT = /^[a-zA-Z0-9-]{8,128}$/;

export interface IndexNowConfig {
    /** The validated key, or `''` when the feature is off. */
    key: string;
    /** A startup warning for a key that was SET but rejected; `''` otherwise. */
    warning: string;
}

export function resolveIndexNowKey(raw: string | undefined): IndexNowConfig {
    const key = (raw ?? '').trim();
    if (!key) {
        return { key: '', warning: '' };
    }
    if (!KEY_FORMAT.test(key)) {
        // The value is a secret-ish owner token; the warning names the rule,
        // not the value, so it is safe in container logs.
        return {
            key: '',
            warning:
                'INDEXNOW_KEY is set but invalid (IndexNow requires 8-128 characters of ' +
                'a-z, A-Z, 0-9 or "-"); the key file is NOT served.',
        };
    }
    return { key, warning: '' };
}

/** The path the key file is served at: `/{key}.txt`. */
export function indexNowKeyPath(key: string): string {
    return `/${key}.txt`;
}
