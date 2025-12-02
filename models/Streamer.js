// /opt/dropify/Discount API/dropify-backend/models/Streamer.js
const mongoose = require("mongoose");

const StreamerSettingsSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },

    // "percentage" or "fixed_amount"
    discountType: {
      type: String,
      enum: ["percentage", "fixed_amount"],
      default: "percentage",
    },

    // e.g. 10 (10% or 10 in store currency)
    discountValue: {
      type: Number,
      default: 10,
      min: 0,
    },

    // Prefix for generated codes, e.g. "DROP-"
    discountPrefix: {
      type: String,
      default: "DROP-",
    },

    // How many codes a viewer can claim per stream
    maxPerViewerPerStream: {
      type: Number,
      default: 1,
      min: 0,
    },

    // Global cooldown between redemptions (seconds)
    globalCooldownSeconds: {
      type: Number,
      default: 120,
      min: 0,
    },

    // Minimum order subtotal required (Shopify side)
    orderMinSubtotal: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Should Dropify auto-enable when the streamer goes live?
    autoEnableOnStreamStart: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const StreamerSchema = new mongoose.Schema(
  {
    // Twitch identity
    twitchId: { type: String, required: true, unique: true },
    twitchLogin: { type: String, required: true, index: true },
    displayName: { type: String, required: true },
    email: { type: String },

    scopes: [{ type: String }],

    connectedAt: { type: Date, default: Date.now },

    // Shopify connection
    shopifyConnected: { type: Boolean, default: false },
    shopifyStoreDomain: { type: String },
    shopifyAdminToken: { type: String },
    shopifyApiVersion: { type: String },

    // Dropify settings (per streamer)
    settings: {
      type: StreamerSettingsSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

// You may already have this index, but it's safe to define/redefine
StreamerSchema.index({ twitchLogin: 1 });

module.exports = mongoose.model("Streamer", StreamerSchema);
