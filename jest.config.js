const nextJest = require('next/jest');

// Pin the clock the tests run against. Anything that reads local time — the
// hourly checklist files its rows under the operator's own date — otherwise
// asserts one thing on a machine in Jakarta and another in a UTC CI runner.
// Set here, before the workers are forked, because a test file's own
// `process.env.TZ` assignment comes too late for the environment it runs in.
process.env.TZ = 'Asia/Jakarta';

const createJestConfig = nextJest({
  // Path to the Next.js app to load next.config.js and .env files
  dir: './',
});

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: [
    '<rootDir>/__tests__/**/*.test.{js,jsx,ts,tsx}',
    '<rootDir>/components/**/*.test.{js,jsx,ts,tsx}',
  ],
};

module.exports = createJestConfig(customJestConfig);
