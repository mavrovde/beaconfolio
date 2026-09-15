import { test, expect } from '@playwright/test';
import { API_PREFIX } from '../config';

/**
 * UNMOCKED contract test for POST /ai/multi-chat (issue #187).
 *
 * `multi-agent.spec.ts` — the spec named after this endpoint — `page.route`-mocks
 * it, so nothing in the suite exercised the real thing. That is how #180 hid:
 * crewai 1.x rejected the LangChain client and the endpoint raised *before* the
 * generator's first yield, which (the body having already started) surfaces as
 * **HTTP 200 with a truncated body**, not a 500. `response.ok` was true, every
 * guard passed, and 778 unit tests stayed green while the public /llm page showed
 * "Connection Error".
 *
 * `max_turns: 1` keeps this to a single generation (~5 s) instead of the default
 * twenty sequential ones (~85 s locally, and multiples of that on a CPU-only
 * runner) — the failure mode being guarded against is structural, so one turn
 * proves it exactly as well as twenty.
 *
 * Rule 10: the E2E stack runs with an empty BEACONFOLIO_GEMINI_API_KEY, so generation falls
 * back to the in-stack Ollama. No paid API is reachable.
 */
test.describe('Multi-Agent Conversation — unmocked contract', () => {
  // 180s, not 90s (#337): the stack allows only 2 concurrent Ollama requests
  // (OLLAMA_NUM_PARALLEL=2 in docker-compose.prod.yml), so under full-suite
  // load this generation queues behind whatever embedding/generation requests
  // earlier specs left in flight. This is a
  // CONTRACT test, not a latency benchmark — the budget must absorb the queue,
  // and the issue's proposed action sanctions exactly this ("serialize or
  // extend timeout").
  test.setTimeout(180_000);

  test('streams well-formed NDJSON and terminates with done:true', async ({ request }) => {
    const response = await request.post(`${API_PREFIX}/ai/multi-chat`, {
      data: {
        topic: 'One short sentence about testing.',
        agents: [
          { id: 1, description: 'Answers in one short sentence.', role: 'Tester', goal: 'Be brief' },
        ],
        max_turns: 1,
      },
      timeout: 170_000,
    });

    // A pre-yield crash also returns 200, so the status proves nothing on its own
    // — the body is what has to be checked.
    expect(response.status()).toBe(200);

    const lines = (await response.text()).split('\n').filter(l => l.trim().length > 0);
    expect(lines.length, 'the stream must carry chunks, not an empty body').toBeGreaterThan(0);

    // Every chunk must parse: a mid-body abort leaves a truncated tail.
    const chunks = lines.map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`chunk ${i} is not valid JSON (truncated stream?): ${line.slice(0, 200)}`);
      }
    });

    // The terminator is what tells a reader the conversation ended rather than
    // the connection dropping — the exact signal missing in the #180 failure.
    const last = chunks[chunks.length - 1];
    expect(last.done, `stream must end with done:true, got: ${JSON.stringify(last)}`).toBe(true);

    // The turn must have completed, and must NOT be the service's degraded path:
    // the backend substitutes canned text when generation fails, so asserting
    // merely "some content" would pass with no model at all.
    expect(chunks.some(c => c.turn_complete === true), 'a turn must complete').toBe(true);
    const produced = chunks
      .filter(c => c.agent === 1)
      .map(c => String(c.content ?? ''))
      .join('');
    expect(produced).not.toContain('could not be generated');
    expect(produced).not.toContain('Infrastructure Error');
    // A pulled-but-missing model answers 404; the degraded text survives the
    // label-stripping post-process as this bare sentence, so a model-less stack
    // would otherwise pass this gate — the exact blindness #199 was filed about.
    expect(produced).not.toContain('language model is unavailable');
    // ...and the canned goal-fallback, which the service substitutes when a turn
    // produces nothing, must not be mistaken for generated content either.
    expect(produced).not.toContain('we must focus on my goal');
    expect(produced.trim().length, 'agent 1 must produce content').toBeGreaterThan(0);
  });

  test('rejects an out-of-range max_turns instead of streaming', async ({ request }) => {
    // The bound exists so one request cannot pin the model indefinitely. A schema
    // rejection is a real 422 — unlike a mid-stream failure, it happens before the
    // body starts, which is exactly the distinction #180 turned on.
    const response = await request.post(`${API_PREFIX}/ai/multi-chat`, {
      data: {
        topic: 'Bounds',
        agents: [{ id: 1, description: 'x', role: 'Tester' }],
        max_turns: 999,
      },
      timeout: 30_000,
    });

    expect(response.status()).toBe(422);
  });
});
