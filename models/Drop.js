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
  },
  {
    timestamps: true,
  }
);

DropSchema.index({ streamerId: 1, createdAt: -1 });
DropSchema.index({ streamerId: 1, kind: 1, createdAt: -1 });
DropSchema.index({ streamerId: 1, viewerId: 1, createdAt: -1 });

module.exports = mongoose.model("Drop", DropSchema);
