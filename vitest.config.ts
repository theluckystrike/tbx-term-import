import { defineConfig } from 'vitest/config';

// obsidian ships typings only, so tests run against obsidian-test-mocks in happy-dom.
export default defineConfig({
	resolve: { alias: { obsidian: 'obsidian-test-mocks/obsidian' } },
	test: {
		environment: 'happy-dom',
		maxWorkers: 1,
		fileParallelism: false,
		setupFiles: ['obsidian-test-mocks/vitest-setup', './tests/setup.ts'],
		include: ['tests/**/*.test.ts'],
		// Large-input regression tests need more than 5 seconds on shared CI runners.
		testTimeout: 30000,
	},
});
