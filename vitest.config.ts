import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts", "extensions/**/*.test.ts"],
		environment: "happy-dom",
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			reportsDirectory: "coverage",
			include: ["extensions/**/*.ts"],
			exclude: ["**/*.d.ts"],
			thresholds: {
				lines: 60,
				functions: 60,
				branches: 60,
				statements: 60,
			},
		},
	},
});