// /opt/dropify/Discount API/dropify-backend/models/Drop.js
// /opt/dropify/Discount API/dropify-backend/models/Drop.js
const mongoose = require("mongoose");

const DropSchema = new mongoose.Schema(
  {
    streamerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Streamer",
      required: true,
      index: true,
    },
    twitchLogin: {
      type: String,
      required: true,
      index: true,
    },

    // Kind of drop: viewer personal code or global stream drop
    kind: {
      type: String,
      enum: ["viewer", "global"],
      default: "viewer",
      index: true,
    },

    // Viewer identity from Twitch
    viewerId: {
      type: String,
      required: true,
      index: true,
    },
    viewerLogin: {
      type: String,
      required: true,
    },
    viewerDisplayName: {
      type: String,
    },

    // Generated discount code and basic info
    discountCode: {
      type: String,
      required: true,
    },
    discountType: {
      type: String, // "percentage" | "fixed_amount"
    },
    discountValue: {
      type: Number,
    },

    // You can later link this to a Shopify price_rule or discount_id
    metadata: {
      type: Object,
    },
  },
  {
    timestamps: true, // createdAt used for cooldowns & per-viewer limits
  }
);

// Useful compound indexes
DropSchema.index({ streamerId: 1, createdAt: -1 });
DropSchema.index({ streamerId: 1, viewerId: 1, createdAt: -1 });

module.exports = mongoose.model("Drop", DropSchema);
