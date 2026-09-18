/*
 * Testing entry point of @beaconfolio/shared — mocks for consumers' unit tests.
 * Kept out of the primary barrel so mocks never reach production bundles.
 */
export * from '../src/lib/testing/mock-language.service';
export * from '../src/lib/testing/mock-translate.pipe';
export * from '../src/lib/testing/create-in-injection-context';
