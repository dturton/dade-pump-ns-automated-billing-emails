const SuiteCloudJestConfiguration = require('@oracle/suitecloud-unit-testing/jest-configuration/SuiteCloudJestConfiguration');
const cliConfig = require('./suitecloud.config');

// N/* modules resolve to the SuiteCloud Unit Testing stubs (AMD, transformed by Oracle's transformer);
// our TypeScript sources and tests go through ts-jest as CommonJS.
const suiteCloud = SuiteCloudJestConfiguration.build({
  projectFolder: cliConfig.defaultProjectFolder,
  projectType: SuiteCloudJestConfiguration.ProjectType.ACP,
});

module.exports = {
  ...suiteCloud,
  transform: {
    ...suiteCloud.transform,
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  roots: ['<rootDir>/__tests__', '<rootDir>/src/TypeScript'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
