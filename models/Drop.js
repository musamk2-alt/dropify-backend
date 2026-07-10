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
    kind: {
      type: String,
      enum: ["viewer", "global"],
      default: "viewer",
      index: true,
    },
    
    // Viewer identity (only required for viewer drops)
    viewerId: {
      type: String,
      index: true,
      required: function () {
        return this.kind === "viewer";
      },
    },
    viewerLogin: {
      type: String,
      required: function () {
        return this.kind === "viewer";
      },
    },
    viewerDisplayName: {
      type: String,
    },
    
    // Discount info
    discountCode: {
      type: String,
      required: true,
      index: true, // Added index for fast lookups by code
    },
    discountType: {
      type: String,
    },
    discountValue: {
      type: Number,
    },
    metadata: {
      type: Object,
    },

    // 🆕 REDEMPTION TRACKING
    redeemed: {
      type: Boolean,
      default: false,
      index: true,
    },
    redeemedAt: {
      type: Date,
      default: null,
    },
    orderId: {
      type: String,
      default: null,
    },
    orderNumber: {
      type: String,
      default: null,
    },
    orderTotal: {
      type: Number,
      default: null,
    },
    orderCurrency: {
      type: String,
      default: "USD",
    },
    customerEmail: {
      type: String,
      default: null,
    },
    discountAmount: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Existing indexes
DropSchema.index({ streamerId: 1, createdAt: -1 });
DropSchema.index({ streamerId: 1, kind: 1, createdAt: -1 });
DropSchema.index({ streamerId: 1, viewerId: 1, createdAt: -1 });

// 🆕 New indexes for redemption queries
DropSchema.index({ streamerId: 1, redeemed: 1, createdAt: -1 });
DropSchema.index({ discountCode: 1 }); // Fast lookup when order webhook fires

module.exports = mongoose.model("Drop", DropSchema);
