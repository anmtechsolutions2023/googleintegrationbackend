// src/__tests__/auth.service.test.js
const { validateGoogleToken } = require('../../modules/auth/auth.service');

describe('Auth Service', () => {
  test('validateGoogleToken should throw for invalid token', async () => {
    await expect(validateGoogleToken('invalid')).rejects.toThrow();
  });
});
