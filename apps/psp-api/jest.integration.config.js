/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
  setupFiles: ['<rootDir>/test/integration/jest.integration.setup.ts'],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.integration.json',
      },
    ],
  },
  testEnvironment: 'node',
};
