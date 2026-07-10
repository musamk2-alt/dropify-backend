const mongoose = require("mongoose");

const discountClaimSchema = new mongoose.Schema(
  {
    streamerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Streamer",
      required: true,
      index: true,
    },

    twitchChannelId: {
      type: String,
      required: true,
    },

    viewerTwitchId: {
      type: String,
      required: true,
      index: true,
    },

    viewerLogin: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    viewerDisplayName: {
      type: String,
      trim: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "claimed",
        "expired",
        "failed",
      ],
      default: "pending",
      index: true,
    },

    discountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Drop",
      default: null,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    claimedAt: {
      type: Date,
      default: null,
    },

    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/*
 * Automatically delete old claim records after their expiration date.
 *
 * MongoDB's cleanup process is not immediate, so the backend must still
 * manually check expiresAt before allowing a claim.
 */
discountClaimSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
  }
);

/*
 * A viewer may only have one active pending claim per streamer.
 *
 * This prevents !discount spam from creating many pending claims.
 */
discountClaimSchema.index(
  {
    streamerId: 1,
    viewerTwitchId: 1,
    status: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      status: "pending",
    },
  }
);

module.exports = mongoose.model(
  "DiscountClaim",
  discountClaimSchema
);
