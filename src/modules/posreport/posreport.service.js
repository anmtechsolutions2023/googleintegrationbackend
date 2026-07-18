// src/modules/posreport/posreport.service.js
// POS Reports service — aggregates across pos_order, pos_bill, pos_kot, pos_customer.

const { withConnection } = require('../../utils/dbHelper');

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

      const [[todayRevenue]] = await conn.execute(
        `SELECT COALESCE(SUM(Total), 0) AS total
         FROM pos_bill
         WHERE TenantId = ?
           AND Status = 'Settled'
           AND DATE(SettledAt) = CURDATE()`,
        [tenantId]
      );

      const [[pendingKots]] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM pos_kot
         WHERE TenantId = ?
           AND Status NOT IN ('Ready', 'Delivered')`,
        [tenantId]
      );

      const [[totalCustomers]] = await conn.execute(
        `SELECT COUNT(*) AS count FROM pos_customer WHERE TenantId = ?`,
        [tenantId]
      );

      const [tableStats] = await conn.execute(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN Status = 'Occupied' THEN 1 ELSE 0 END) AS occupied
         FROM pos_table WHERE TenantId = ?`,
        [tenantId]
      );

      // Revenue trend: last N days
      const [revenueTrend] = await conn.execute(
        `SELECT
           DATE(SettledAt) AS day,
           COALESCE(SUM(Total), 0) AS revenue,
           COUNT(*) AS bills
         FROM pos_bill
         WHERE TenantId = ?
           AND Status = 'Settled'
           AND SettledAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY DATE(SettledAt)
         ORDER BY day ASC`,
        [tenantId, days]
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

      // Recent 10 orders
      const [recentOrders] = await conn.execute(
        `SELECT Id, OrderNo, OrderType, Status, Total, CreatedOn, TableId
         FROM pos_order
         WHERE TenantId = ?
         ORDER BY CreatedOn DESC
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
