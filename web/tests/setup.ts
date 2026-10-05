// Runs before every test file. Integration tests talk to TEST_DATABASE_URL,
// never DATABASE_URL, so a test run can't touch development data.
process.env.AUTH_SECRET ??= 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.TEST_DATABASE_URL ??= 'postgres://r1:r1@localhost:5432/r1_test';
