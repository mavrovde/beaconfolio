import { InjectionToken, PLATFORM_ID, inject } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { createInInjectionContext } from './create-in-injection-context';

const GREETING = new InjectionToken<string>('GREETING');
const ABSENT = new InjectionToken<string>('ABSENT');

class Subject {
  greeting = inject(GREETING);
  platformId = inject(PLATFORM_ID);
  absent = inject(ABSENT, { optional: true });
}

describe('createInInjectionContext', () => {
  it('resolves the class dependencies from the supplied providers', () => {
    const made = createInInjectionContext(Subject, [
      { provide: GREETING, useValue: 'hello' },
      { provide: PLATFORM_ID, useValue: 'server' },
    ]);

    expect(made).toBeInstanceOf(Subject);
    expect(made.greeting).toBe('hello');
    expect(made.platformId).toBe('server');
    // An optional dependency nobody provided is null, not a failure.
    expect(made.absent).toBeNull();
  });

  it('THROWS on a required dependency nobody provided — it must not arrive as undefined', () => {
    expect(() => createInInjectionContext(Subject, [{ provide: GREETING, useValue: 'hello' }])).toThrow();
  });
});
