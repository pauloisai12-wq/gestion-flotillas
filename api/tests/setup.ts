process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/flotillas_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.JWT_SECRET ??= 'sprint-2-test-secret-'.repeat(4);
process.env.TURNSTILE_ENABLED = 'false';
