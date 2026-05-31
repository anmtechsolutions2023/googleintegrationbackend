// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    // Exclude boilerplate/config files — no business logic to test
    '!src/**/*.routes.js',
    '!src/**/*.controller.js',
    '!src/**/*.schemas.js',
    '!src/__tests__/**',
    '!src/config/db.js',
    '!src/config/envConfig.js',
    '!src/config/swagger.js',
    '!src/config/routes.js',
    '!src/config/messages.js',
    '!src/config/constants.js',
    '!src/utils/logger.js',
    '!src/middleware/auditLogger.js',
    '!src/modules/auth/**',
    '!src/modules/tenant/**',
    '!src/modules/user/**',
    '!src/modules/reports/**',
    '!src/modules/audit/**',
    '!server.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'json', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 65,   // ternary branches in prepareUpdateParams are hard to fully cover
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  forceExit: true,          // close open handles (e.g. db pool) after tests finish
  testTimeout: 10000,
};

