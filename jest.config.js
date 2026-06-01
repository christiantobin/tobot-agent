/**
 * Jest config for the TypeScript side (CDK lib + front-door Lambdas).
 *
 * The Python agent-runtime is tested separately with pytest (see
 * agent-runtime/tests and the CI workflow).
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // Keep CDK's heavy synth out of the unit-test path.
  testPathIgnorePatterns: ['/node_modules/', '/cdk.out/'],
  clearMocks: true,
};
