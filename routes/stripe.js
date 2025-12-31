const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const Streamer = require("../models/Streamer");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getPriceId(plan) {
  if (plan === "pro") return process.env.STRIPE_PRO_PRICE_ID;
  if (plan === "creator") return process.env.STRIPE_CREATOR_PRICE_ID;
  return null;
}

// POST /api/stripe/create-checkout
router.post("/create-checkout", async (req, res) => {
  try {
    const login = String(req.body?.login || "").toLowerCase();
    const plan = String(req.body?.plan || "").toLowerCase();

    const priceId = getPriceId(plan);
    if (!login || !priceId) {
      return res.status(400).json({ ok: false, error: "login + valid plan required" });
    }

    const streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer) return res.status(404).json({ ok: false, error: "Streamer not found" });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://dropifybot.com/dashboard?login=${encodeURIComponent(login)}&upgrade=success`,
      cancel_url: `https://dropifybot.com/dashboard?login=${encodeURIComponent(login)}&upgrade=cancel`,
      client_reference_id: login,
      metadata: { twitchLogin: login, plan },
    });

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("❌ Stripe create-checkout error", err);
    return res.status(500).json({ ok: false, error: "Stripe error" });
  }
});

// POST /api/stripe/webhook  (RAW body!)
router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const login = session?.metadata?.twitchLogin;
      const plan = session?.metadata?.plan;

      if (login && plan) {
        await Streamer.findOneAndUpdate(
          { twitchLogin: String(login).toLowerCase() },
          {
            plan,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
          }
        );
        console.log(`✅ Upgraded ${login} to ${plan}`);
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Stripe webhook handler error", err);
    return res.status(500).json({ received: true });
  }
});

module.exports = router;
