// src/modules/poscustomer/poscustomer.profile.service.js
// One customer, and everything they have done here.
//
// The CRM screen listed names, phone numbers and three counters that were
// always zero. It could not answer the only questions a CRM is for: what does
// this person order, how often do they come, and what did they say about it.
//
// Read-only composition of existing reads. Writes nothing, owns no state.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');

const num = (v) => Number(v || 0);

/**
 * Find a customer at the counter, by phone or name.
 *
 * Capped at ten: this backs a type-ahead beside a queue, not a mailing list
 * export. An exact phone match sorts first because that is what the customer
 * just recited.
 *
 * @param {string} term
 * @param {string} tenantId
 * @returns {Promise<Array>}
 */
const search = (term, tenantId) =>
  withConnection(async (conn) => {
    const like = `%${String(term || '').trim()}%`;
    const exact = String(term || '').trim();
    const [rows] = await conn.execute(QUERIES.POS_CUSTOMER.SEARCH, [
      tenantId, like, like, exact,
    ]);
    return rows.map((r) => ({
      ...r,
      Visits: num(r.Visits),
      TotalSpent: num(r.TotalSpent),
      LoyaltyPoints: num(r.LoyaltyPoints),
    }));
  });

/**
 * A customer's full profile: who they are, what they have spent, every round
 * they have ordered, and every rating they have left.
 *
 * @param {string} id
 * @param {string} tenantId
 * @returns {Promise<Object>} { Customer, Orders, Feedback, Summary }
 */
const getProfile = (id, tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.POS_CUSTOMER.SELECT_BY_ID, [id, tenantId]);
    if (rows.length === 0) throw new HttpError('POS Customer not found', 404);
    const c = rows[0];

    const [orders] = await conn.execute(QUERIES.POS_CUSTOMER.ORDER_HISTORY, [id, tenantId]);
    const [feedback] = await conn.execute(QUERIES.POS_CUSTOMER.FEEDBACK_HISTORY, [id, tenantId]);

    const rated = feedback.filter((f) => f.Rating != null);

    return {
      Customer: {
        ...c,
        Visits: num(c.Visits),
        TotalSpent: num(c.TotalSpent),
        LoyaltyPoints: num(c.LoyaltyPoints),
      },
      Orders: orders.map((o) => ({ ...o, Total: num(o.Total) })),
      Feedback: feedback,
      Summary: {
        // Derived from the history in hand rather than from the projection, so
        // the two can be compared: a stored Visits that disagrees with the rows
        // below is a signal, and hiding it behind one number would lose that.
        OrdersShown: orders.length,
        AverageOrderValue: orders.length
          ? Math.round((orders.reduce((s, o) => s + num(o.Total), 0) / orders.length) * 100) / 100
          : 0,
        AverageRating: rated.length
          ? Math.round((rated.reduce((s, f) => s + num(f.Rating), 0) / rated.length) * 10) / 10
          : null,
        RatingsLeft: rated.length,
      },
    };
  });

module.exports = { search, getProfile };
