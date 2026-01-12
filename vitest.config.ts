import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts', '**/*.test.js'],
        exclude: [
            'node_modules/',
            'output/',
            'test-results/',
            'tests/**/*.spec.ts',
            '**/*.spec.ts',
            '**/types/**',
            '**/templates/**'
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'output/',
                'test-results/',
                '**/*.spec.ts',
                '**/*.test.ts',
                '**/types/**',
                '**/templates/**'
            ]
        }
    }
});
