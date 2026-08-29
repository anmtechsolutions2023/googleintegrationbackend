// src/modules/posoffer/campaign.report.service.js
//
// What a campaign cost, and what it moved.
//
// THE TWO ARE NOT THE SAME KIND OF FACT, and this file never adds them together.
// What a campaign GAVE AWAY is exact — every redemption is written against its
// offer, which is the whole reason pos_offer_redemption exists. What a campaign
// CAUSED is an estimate. Presenting an estimate as a measurement is how a
// campaign gets renewed on a number nobody checked.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');

const num = (v) => Number(v || 0);
const round2 = (v) => Math.round(num(v) * 100) / 100;

/**
 * One campaign's performance.
 *
 * @param {string} campaignId
 * @param {string} tenantId
 * @returns {Promise<Object>}
 */
const forCampaign = (campaignId, tenantId) => withConnection(async (conn) => {
  const [[summary]] = await conn.execute(
    QUERIES.POS_OFFER_REDEMPTION.SUMMARY, [tenantId, campaignId, tenantId, campaignId],
  );
  const [byOffer] = await conn.execute(
    QUERIES.POS_OFFER_REDEMPTION.BY_OFFER, [tenantId, campaignId],
  );
  const [byHour] = await conn.execute(
    QUERIES.POS_OFFER_REDEMPTION.BY_HOUR, [tenantId, campaignId],
  );
  const [recent] = await conn.execute(
    QUERIES.POS_OFFER_REDEMPTION.SELECT_BY_CAMPAIGN, [tenantId, campaignId],
  );

  const redemptions = num(summary?.Redemptions);
  const bills = num(summary?.Bills);
  const givenAway = round2(summary?.GivenAway);
  const revenue = round2(summary?.RevenueOnThoseBills);

  return {
    campaignId,
    summary: {
      redemptions,
      bills,
      givenAway,
      // What those bills came to. NOT uplift, and never labelled as such —
      // the people who order two chai were always going to spend more.
      revenueOnThoseBills: revenue,
      averageBill: bills > 0 ? round2(revenue / bills) : 0,
      costPerRedemption: redemptions > 0 ? round2(givenAway / redemptions) : 0,
      // Given away as a share of what those bills earned. The one ratio that
      // says whether a promotion is a discount or a business model.
      costAsShareOfRevenue: revenue > 0 ? round2((givenAway / revenue) * 100) : 0,
    },
    offers: (byOffer || []).map((r) => ({
      offerId: r.OfferId,
      offerName: r.OfferName,
      redemptions: num(r.Redemptions),
      givenAway: round2(r.GivenAway),
      bills: num(r.Bills),
      costPerRedemption: num(r.Redemptions) > 0 ? round2(num(r.GivenAway) / num(r.Redemptions)) : 0,
    })),
    // When it fires. A chai offer running all day is being paid for at hours it
    // is not changing anybody's mind.
    byHour: (byHour || []).map((r) => ({ hour: num(r.Hour), redemptions: num(r.Redemptions) })),
    // Every redemption, so any figure above can be traced to the bills behind
    // it — a discount with no reason attached is indistinguishable from a
    // cashier being generous.
    recent: (recent || []).map((r) => ({
      id: r.Id,
      offerId: r.OfferId,
      offerName: r.OfferName,
      itemName: r.ItemName,
      quantity: num(r.Quantity),
      discountAmount: round2(r.DiscountAmount),
      billGrossAmount: round2(r.BillGrossAmount),
      transactionNo: r.TransactionNo,
      transactionDetailLogId: r.TransactionDetailLogId,
      branchName: r.BranchName,
      redeemedOn: r.RedeemedOn,
      redeemedBy: r.RedeemedBy,
    })),
  };
});

module.exports = { forCampaign };
