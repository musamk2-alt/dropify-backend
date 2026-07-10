const DiscountClaim = require("../models/DiscountClaim");

const CLAIM_LIFETIME_MINUTES = 10;

/**
 * Creates a new pending claim or refreshes an existing pending claim.
 *
 * This does NOT generate a Shopify discount yet.
 */
async function createOrRefreshPendingClaim({
  streamerId,
  twitchChannelId,
  viewerTwitchId,
  viewerLogin,
  viewerDisplayName,
}) {
  if (!streamerId) {
    throw new Error("streamerId is required");
  }

  if (!twitchChannelId) {
    throw new Error("twitchChannelId is required");
  }

  if (!viewerTwitchId) {
    throw new Error("viewerTwitchId is required");
  }

  if (!viewerLogin) {
    throw new Error("viewerLogin is required");
  }

  const expiresAt = new Date(
    Date.now() + CLAIM_LIFETIME_MINUTES * 60 * 1000
  );

  /*
   * Try to find an existing pending claim for this viewer
   * in this streamer's channel.
   */
  const existingClaim = await DiscountClaim.findOne({
    streamerId,
    viewerTwitchId: String(viewerTwitchId),
    status: "pending",
  });

  if (existingClaim) {
    existingClaim.twitchChannelId = String(twitchChannelId);
    existingClaim.viewerLogin = viewerLogin.toLowerCase();
    existingClaim.viewerDisplayName =
      viewerDisplayName || viewerLogin;
    existingClaim.expiresAt = expiresAt;
    existingClaim.errorMessage = null;

    await existingClaim.save();

    return {
      claim: existingClaim,
      created: false,
    };
  }

  const claim = await DiscountClaim.create({
    streamerId,
    twitchChannelId: String(twitchChannelId),
    viewerTwitchId: String(viewerTwitchId),
    viewerLogin: viewerLogin.toLowerCase(),
    viewerDisplayName: viewerDisplayName || viewerLogin,
    status: "pending",
    expiresAt,
  });

  return {
    claim,
    created: true,
  };
}

module.exports = {
  createOrRefreshPendingClaim,
};
