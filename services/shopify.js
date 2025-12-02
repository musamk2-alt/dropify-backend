const axios = require("axios");

/**
 * Ensure there is an orders/create webhook pointing to our backend.
 * - If it already exists: do nothing.
 * - If not: create it.
 */
async function ensureOrderCreateWebhook(shopDomain, accessToken) {
  const apiVersion = "2025-01"; // adjust if you use another version

  const baseUrl = `https://${shopDomain}/admin/api/${apiVersion}`;

  // 1) Get existing webhooks for this topic
  try {
    const listResp = await axios.get(`${baseUrl}/webhooks.json`, {
      params: { topic: "orders/create" },
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    const existing = listResp.data?.webhooks || [];

    const alreadyThere = existing.some(
      (wh) =>
        wh.address === "https://api.dropifybot.com/webhooks/shopify/orders" &&
        wh.topic === "orders/create"
    );

    if (alreadyThere) {
      console.log(
        `✅ orders/create webhook already exists for ${shopDomain}, skipping create`
      );
      return;
    }
  } catch (err) {
    console.error(
      "Failed to list Shopify webhooks (continuing anyway):",
      err.response?.data || err.message || err
    );
    // we continue and try to create anyway
  }

  // 2) Create the webhook if needed
  try {
    const body = {
      webhook: {
        topic: "orders/create",
        address: "https://api.dropifybot.com/webhooks/shopify/orders",
        format: "json",
      },
    };

    await axios.post(`${baseUrl}/webhooks.json`, body, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    console.log(
      `✅ Registered orders/create webhook for ${shopDomain} -> /webhooks/shopify/orders`
    );
  } catch (err) {
    console.error(
      "Failed to register Shopify webhook:",
      err.response?.data || err.message || err
    );
  }
}

module.exports = {
  ensureOrderCreateWebhook,
};
