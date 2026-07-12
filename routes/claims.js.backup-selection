// /var/www/dropify-backend/routes/claims.js
require("dotenv").config();

const express = require("express");

const DiscountClaim = require("../models/DiscountClaim");
const Streamer = require("../models/Streamer");
const Drop = require("../models/Drop");

const requireViewerSession = require(
  "../middleware/requireViewerSession"
);

const {
  createViewerDiscount,
} = require("../services/discounts");

const {
  PLAN_LIMITS,
  getPlanForStreamer,
  reserveMonthlyDrop,
  releaseMonthlyDrop,
} = require("../services/planLimits");

const router = express.Router();

const DISCOUNT_LIFETIME_MS =
  10 * 60 * 1000;

function secondsSince(date) {
  return Math.floor(
    (
      Date.now() -
      new Date(date).getTime()
    ) / 1000
  );
}

async function returnClaimToPending(
  claimId,
  errorMessage
) {
  await DiscountClaim.updateOne(
    {
      _id: claimId,
      status: "processing",
    },
    {
      $set: {
        status: "pending",
        errorMessage:
          errorMessage || null,
      },
    }
  );
}

async function markClaimFailed(
  claimId,
  errorMessage
) {
  await DiscountClaim.updateOne(
    {
      _id: claimId,
      status: "processing",
    },
    {
      $set: {
        status: "failed",
        errorMessage:
          errorMessage || null,
      },
    }
  );
}

/**
 * GET /api/claims/pending
 *
 * Checks whether the authenticated Twitch
 * viewer has an active pending claim.
 */
/**
 * GET /api/claims/pending
 *
 * Returns every active pending claim belonging
 * to the authenticated Twitch viewer.
 */
router.get(
  "/pending",
  requireViewerSession,
  async (req, res) => {
    try {
      const pendingClaims =
        await DiscountClaim.find({
          viewerTwitchId:
            req.viewer.twitchId,

          status: {
            $in: [
              "pending",
              "processing",
            ],
          },

          expiresAt: {
            $gt: new Date(),
          },
        })
          .sort({
            createdAt: -1,
          })
          .lean();

      if (!pendingClaims.length) {
        return res.status(404).json({
          ok: false,
          reason: "no_pending_claim",
          message:
            "No active discount claim was found for this Twitch account.",
        });
      }

      const streamerIds = [
        ...new Set(
          pendingClaims.map((claim) =>
            String(claim.streamerId)
          )
        ),
      ];

      const streamers =
        await Streamer.find({
          _id: {
            $in: streamerIds,
          },
        })
          .select(
            "twitchLogin displayName"
          )
          .lean();

      const streamerMap = new Map(
        streamers.map((streamer) => [
          String(streamer._id),
          streamer,
        ])
      );

      const claims = pendingClaims
        .map((claim) => {
          const streamer =
            streamerMap.get(
              String(claim.streamerId)
            );

          if (!streamer) {
            return null;
          }

          return {
            id: String(claim._id),

            status:
              claim.status,

            viewerLogin:
              claim.viewerLogin,

            viewerDisplayName:
              claim.viewerDisplayName,

            expiresAt:
              claim.expiresAt,

            streamer: {
              twitchLogin:
                streamer.twitchLogin,

              displayName:
                streamer.displayName,
            },
          };
        })
        .filter(Boolean);

      if (!claims.length) {
        return res.status(404).json({
          ok: false,
          reason: "streamer_not_found",
          message:
            "The streamers connected to these claims could not be found.",
        });
      }

      return res.json({
        ok: true,

        /*
         * Keep the old field temporarily so
         * the current claim page still works.
         */
        claim: claims[0],

        /*
         * The improved claim page will use
         * this complete list.
         */
        claims,
      });
    } catch (error) {
      console.error(
        "[CLAIMS] Unable to find pending claims:",
        error?.message || error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Unable to check pending claims.",
      });
    }
  }
);

/**
 * POST /api/claims/redeem
 *
 * Generates a Shopify discount only after
 * the Twitch viewer has been authenticated.
 */
router.post(
  "/redeem",
  requireViewerSession,
  async (req, res) => {
    const requestId =
      Math.random()
        .toString(36)
        .slice(2, 9);

    let claim = null;
    let streamer = null;
    let reservedSlot = null;

    console.log(
      `[CLAIM-REDEEM-${requestId}] Viewer: ${req.viewer.login} (${req.viewer.twitchId})`
    );

    try {
      /*
       * Atomically change pending → processing.
       *
       * Only one request can successfully
       * lock this claim.
       */
      claim =
        await DiscountClaim.findOneAndUpdate(
          {
            viewerTwitchId:
              req.viewer.twitchId,

            status: "pending",

            expiresAt: {
              $gt: new Date(),
            },
          },
          {
            $set: {
              status: "processing",
              errorMessage: null,
            },
          },
          {
            new: true,

            sort: {
              createdAt: -1,
            },
          }
        );

      if (!claim) {
        const processingClaim =
          await DiscountClaim.findOne({
            viewerTwitchId:
              req.viewer.twitchId,

            status: "processing",

            expiresAt: {
              $gt: new Date(),
            },
          }).lean();

        if (processingClaim) {
          return res.status(409).json({
            ok: false,
            reason:
              "already_processing",
            message:
              "Your discount is already being prepared.",
          });
        }

        return res.status(404).json({
          ok: false,
          reason:
            "no_pending_claim",
          message:
            "No active discount claim was found for this Twitch account.",
        });
      }

      streamer =
        await Streamer.findById(
          claim.streamerId
        );

      if (!streamer) {
        await markClaimFailed(
          claim._id,
          "Streamer was not found"
        );

        return res.status(404).json({
          ok: false,
          reason:
            "streamer_not_found",
        });
      }

      if (!streamer.settings?.enabled) {
        await markClaimFailed(
          claim._id,
          "Discounts are disabled"
        );

        return res.status(200).json({
          ok: false,
          reason: "disabled",
          message:
            "Discounts are currently disabled for this channel.",
        });
      }

      if (
        !streamer.shopifyConnected ||
        !streamer.shopifyStoreDomain ||
        !streamer.shopifyAdminToken
      ) {
        await markClaimFailed(
          claim._id,
          "Shopify is not connected"
        );

        return res.status(200).json({
          ok: false,
          reason:
            "not_connected",
          message:
            "This streamer has not fully connected Shopify.",
        });
      }

      /*
       * Check the viewer cooldown before
       * reserving monthly plan usage.
       */
      const plan =
        getPlanForStreamer(streamer);

      const limits =
        PLAN_LIMITS[plan] ||
        PLAN_LIMITS.free;

      const lastViewerDrop =
        await Drop.findOne({
          streamerId:
            streamer._id,

          kind: "viewer",

          viewerId:
            req.viewer.twitchId,
        })
          .sort({
            createdAt: -1,
          })
          .lean();

      const viewerCooldown =
        limits.viewerCooldownSeconds ??
        0;

      if (
        lastViewerDrop &&
        viewerCooldown > 0
      ) {
        const elapsed =
          secondsSince(
            lastViewerDrop.createdAt
          );

        if (
          elapsed <
          viewerCooldown
        ) {
          const remaining =
            viewerCooldown -
            elapsed;

          await returnClaimToPending(
            claim._id,
            `Cooldown active for ${remaining} seconds`
          );

          return res.status(429).json({
            ok: false,
            reason: "cooldown",
            retryAfterSeconds:
              remaining,
            message:
              `Please wait ${remaining}s before claiming another discount.`,
          });
        }
      }

      /*
       * Reserve monthly plan usage before
       * generating the Shopify discount.
       */
      reservedSlot =
        await reserveMonthlyDrop({
          streamer,
          kind: "viewer",
        });

      if (!reservedSlot.ok) {
        await returnClaimToPending(
          claim._id,
          reservedSlot.message ||
            "Plan limit reached"
        );

        return res.status(429).json({
          ok: false,
          reason: "plan_limit",
          message:
            reservedSlot.message,
          plan:
            reservedSlot.plan,
          limit:
            reservedSlot.limit,
          used:
            reservedSlot.used,
        });
      }

      /*
       * This is the only point where the
       * Shopify discount is generated.
       */
      const result =
        await createViewerDiscount(
          streamer.twitchLogin,
          {
            viewerId:
              req.viewer.twitchId,

            viewerLogin:
              req.viewer.login,

            viewerDisplayName:
              req.viewer.displayName,
          }
        );

      if (!result?.ok) {
        await releaseMonthlyDrop({
          streamer,
          kind: "viewer",
        });

        reservedSlot = null;

        if (
          result?.reason ===
          "cooldown"
        ) {
          await returnClaimToPending(
            claim._id,
            "Discount cooldown active"
          );
        } else {
          await markClaimFailed(
            claim._id,
            result?.reason ||
              "Discount generation failed"
          );
        }

        const statusCode =
          result?.reason ===
          "cooldown"
            ? 429
            : 200;

        return res
          .status(statusCode)
          .json(result);
      }

      const claimedAt =
        new Date();

      const discountExpiresAt =
        new Date(
          claimedAt.getTime() +
            DISCOUNT_LIFETIME_MS
        );

      /*
       * Save the generated Drop reference
       * on the claim.
       */
      try {
        await DiscountClaim.updateOne(
          {
            _id: claim._id,
            status: "processing",
          },
          {
            $set: {
              status: "claimed",

              discountId:
                result.dropId,

              claimedAt,

              expiresAt:
                discountExpiresAt,

              errorMessage: null,
            },
          }
        );
      } catch (claimUpdateError) {
        /*
         * The discount already exists, so we
         * still return it to the viewer.
         */
        console.error(
          `[CLAIM-REDEEM-${requestId}] Discount created but claim update failed:`,
          claimUpdateError?.message ||
            claimUpdateError
        );
      }

      console.log(
        `[CLAIM-REDEEM-${requestId}] Discount created for ${req.viewer.login}`
      );

      return res.json({
        ok: true,

        discount: {
          code:
            result.discountCode,

          type:
            result.discountType,

          value:
            result.discountValue,

          expiresAt:
            discountExpiresAt,
        },

        streamer: {
          twitchLogin:
            streamer.twitchLogin,

          displayName:
            streamer.displayName,
        },

        usage: {
          kind: "viewer",
          used:
            reservedSlot.used,
          limit:
            reservedSlot.limit,
        },

        warning:
          reservedSlot.warning ||
          null,
      });
    } catch (error) {
      console.error(
        `[CLAIM-REDEEM-${requestId}] Unexpected error:`,
        {
          message:
            error?.message ||
            "Unknown error",

          status:
            error?.response?.status ||
            null,

          apiError:
            error?.response?.data
              ?.errors ||
            error?.response?.data
              ?.message ||
            null,
        }
      );

      if (
        streamer &&
        reservedSlot?.ok
      ) {
        try {
          await releaseMonthlyDrop({
            streamer,
            kind: "viewer",
          });
        } catch (_) {
          // Ignore secondary release errors.
        }
      }

      if (claim?._id) {
        try {
          await markClaimFailed(
            claim._id,
            "Unexpected discount generation error"
          );
        } catch (_) {
          // Ignore secondary claim errors.
        }
      }

      return res.status(500).json({
        ok: false,
        error:
          "Something went wrong while generating your discount.",
      });
    }
  }
);

module.exports = router;
