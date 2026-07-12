// server.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const rateLimit = require("express-rate-limit");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");

// Routes
const authRoutes = require("./routes/auth");
const viewerAuthRoutes = require("./routes/viewerAuth");
const streamerRoutes = require("./routes/streamers");
const discountRoutes = require("./routes/discounts");
const claimRoutes = require("./routes/claims");
const shopifyRoutes = require("./routes/shopify");
const webhookRoutes = require("./routes/webhooks");
const redemptionsRouter = require("./routes/redemptions");
const settingsRouter = require("./routes/settings");
const dropsRouter = require("./routes/drops");
const statsRoutes = require("./routes/stats");
const planRoutes = require("./routes/plan");
const stripeRoutes = require("./routes/stripe");

// NEW — import Twitch refresh helper
const { refreshToken } = require("./services/twitchAuth");
const Streamer = require("./models/Streamer");

const app = express();
app.set("trust proxy", 1); // trust first proxy (NGINX)

/* =======================
   CORS
   ======================= */
app.use(
  cors({
    origin: [
      "https://dropifybot.com",
      "https://www.dropifybot.com",
      "https://bot.dropifybot.com",
      "https://api.dropifybot.com",
    ],
    credentials: true,
  })
);

/* =======================
   COOKIES
   ======================= */
app.use(cookieParser());

/* =======================
   BODY PARSER (CRITICAL)
   - Saves raw body for Stripe webhook
   ======================= */
app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl === "/api/stripe/webhook") {
        req.rawBody = buf; // Buffer needed for Stripe signature
      }
    },
  })
);

/* =======================
   RATE LIMIT
   ======================= */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { ok: false, error: "Too many requests, slow down." },
});

// Root health route
app.get("/", (req, res) => {
  res.send("Dropify API is running.");
});

app.use("/api/", apiLimiter);

/* =======================
   ROUTES
   ======================= */
app.use("/api/auth", authRoutes);
app.use("/api/auth/viewer", viewerAuthRoutes);
app.use("/api/streamers", streamerRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/claims", claimRoutes);
app.use("/api/shopify", shopifyRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/api/redemptions", redemptionsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/drops", dropsRouter);
app.use("/api/stats", statsRoutes);
app.use("/api/plan", planRoutes);

// ✅ Stripe routes (webhook lives INSIDE this router)
app.use("/api/stripe", stripeRoutes);

/* =======================
   MONGODB
   ======================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("Mongo error:", err));

/* =======================
   TOKEN AUTO-REFRESH CRON
   ======================= */
setInterval(async () => {
  const streamers = await Streamer.find({});
  if (!streamers.length) return;

  console.log(`⏳ Checking token status for ${streamers.length} streamer(s)...`);

  for (const s of streamers) {
    if (!s.expiresAt) continue;

    const expiresIn = s.expiresAt - Date.now();
    if (expiresIn < 10 * 60 * 1000) {
      await refreshToken(s);
    }
  }
}, 5 * 60 * 1000);

/* =======================
   START SERVER
   ======================= */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running http://localhost:${PORT}`);
});
