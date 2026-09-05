// src/modules/onboarding/onboarding.service.js
// Service for onboarding flow: status lookup and note updates.
// Only called by authenticated guests (pending/rejected users).

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');

/**
 * Returns the current onboarding request status for the calling user.
 * @param {string} userPhone
 * @returns {Promise<Object>}
 */
const getStatus = (userPhone) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(
      QUERIES.ONBOARDING_REQUESTS.SELECT_BY_PHONE,
      [userPhone]
    );
    if (rows.length === 0) {
      throw new HttpError(
        MESSAGES.ERROR.ONBOARDING_REQUEST_NOT_FOUND,
        MESSAGES.HTTP_STATUS.NOT_FOUND
      );
    }
    const { id, status, request_note, rejection_reason, requested_at } = rows[0];
    return {
      id,
      status,
      requestNote: request_note,
      rejectionReason: rejection_reason,
      requestedAt: requested_at,
    };
  });

/**
 * Updates the request note on the user's pending onboarding request.
 * @param {string} userPhone
 * @param {string} requestNote
 * @returns {Promise<void>}
 */
const updateNote = (userPhone, requestNote) =>
  withConnection(async (conn) => {
    await conn.execute(QUERIES.ONBOARDING_REQUESTS.UPDATE_NOTE, [
      requestNote,
      userPhone,
    ]);
  });

module.exports = { getStatus, updateNote };
