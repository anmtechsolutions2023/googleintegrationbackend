// src/modules/posreport/posreport.service.js
// POS Reports service — the OPERATIONS dashboard: orders, kitchen, tables,
// customers, feedback.
//
// Money comes from the ledger, not from pos_bill. Revenue used to be summed off
// pos_bill filtered on Status = 'Settled', a value nothing in the codebase ever
// wrote, so it silently reported zero. Financial figures now read the same
// documents the accountant reads — see modules/ledger/ledger.report.service.js
// for the full financial reporting suite.

const { withConnection } = require('../../utils/dbHelper');
const { LEDGER } = require('../../config/constants');

class PosReportService {
  /**
   * Aggregate dashboard statistics for the given tenant.
   * @param {string} tenantId
   * @param {number} days  - rolling window for trend data (default 7)
   */
  async getSummary(tenantId, days = 7) {
    return withConnection(async (conn) => {
      const [[todayOrders]] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM pos_order
         WHERE TenantId = ?
           AND DATE(CreatedOn) = CURDATE()`,
        [tenantId]
      );

      // Revenue = what was INVOICED today, read from the ledger documents.
      const [[todayRevenue]] = await conn.execute(
        `SELECT COALESCE(SUM(l.GrossAmount), 0) AS total
           FROM transactiondetaillog l
           JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
           JOIN transactiontype t       ON t.Id = l.TransactionTypeId
          WHERE l.TenantId = ?
            AND t.Name = ?
            AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
            AND l.TransactionDate = CURDATE()`,
        [tenantId, LEDGER.TYPE_POS_SALE]
      );

      // Tickets still waiting at the pass. Two bugs lived in this one query:
      // it matched 'Ready'/'Delivered' — title-case values nothing writes, and
      // 'Delivered' is not a status at all — and it had no date bound, so a KOT
      // abandoned months ago inflated a figure labelled "today". Statuses are
      // now the canonical lowercase enum, and the window is today's service.
      const [[pendingKots]] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM pos_kot
         WHERE TenantId = ?
           AND Active = 1
           AND LOWER(COALESCE(Status, 'pending')) NOT IN ('ready', 'cancelled')
           AND DATE(COALESCE(FiredAt, CreatedOn)) = CURDATE()`,
        [tenantId]
      );

      const [[totalCustomers]] = await conn.execute(
        `SELECT COUNT(*) AS count FROM pos_customer WHERE TenantId = ?`,
        [tenantId]
      );

      const [tableStats] = await conn.execute(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN LOWER(COALESCE(Status, '')) = 'occupied' THEN 1 ELSE 0 END) AS occupied
         FROM pos_table WHERE TenantId = ? AND Active = 1`,
        [tenantId]
      );

      // Revenue trend: last N days, from the ledger.
      const [revenueTrend] = await conn.execute(
        `SELECT
           l.TransactionDate AS day,
           COALESCE(SUM(l.GrossAmount), 0) AS revenue,
           COUNT(*) AS bills
         FROM transactiondetaillog l
         JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         JOIN transactiontype t       ON t.Id = l.TransactionTypeId
         WHERE l.TenantId = ?
           AND t.Name = ?
           AND s.Name IN ('SETTLED', 'PARTIALLY_PAID')
           AND l.TransactionDate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY l.TransactionDate
         ORDER BY day ASC`,
        [tenantId, LEDGER.TYPE_POS_SALE, days]
      );

      // Order trend: last N days
      const [orderTrend] = await conn.execute(
        `SELECT
           DATE(CreatedOn) AS day,
           COUNT(*) AS orders
         FROM pos_order
         WHERE TenantId = ?
           AND CreatedOn >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(CreatedOn)
         ORDER BY day ASC`,
        [tenantId, days]
      );

      // Recent 10 rounds. Joined to pos_table so the dashboard can name the table
      // instead of printing a raw uuid, and cancelled rounds are left out —
      // a voided round is not something that happened at the front desk.
      const [recentOrders] = await conn.execute(
        `SELECT o.Id, o.OrderNo, o.OrderType, o.Status, o.Total, o.CreatedOn,
                o.TableId, t.Name AS TableName
         FROM pos_order o
         LEFT JOIN pos_table t ON t.Id = o.TableId AND t.TenantId = o.TenantId
         WHERE o.TenantId = ?
           AND LOWER(COALESCE(o.Status, '')) <> 'cancelled'
         ORDER BY o.CreatedOn DESC
         LIMIT 10`,
        [tenantId]
      );

      // Top feedback ratings
      const [[avgRating]] = await conn.execute(
        `SELECT ROUND(AVG(Rating), 1) AS avg
         FROM pos_feedback WHERE TenantId = ?`,
        [tenantId]
      );

      return {
        today: {
          orders: todayOrders.count,
          revenue: Number(todayRevenue.total),
          pendingKots: pendingKots.count,
        },
        tables: {
          total: tableStats[0]?.total ?? 0,
          occupied: tableStats[0]?.occupied ?? 0,
        },
        customers: {
          total: totalCustomers.count,
        },
        feedback: {
          avgRating: avgRating.avg ?? null,
        },
        trends: {
          revenue: revenueTrend,
          orders: orderTrend,
        },
        recentOrders,
      };
    });
  }
}

module.exports = new PosReportService();
