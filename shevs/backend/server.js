require("dotenv").config();

const createApp = require("./src/app");
const { pool, verifyConnection } = require("./src/config/db");

const PORT = process.env.PORT || 4000;

function checkConfig() {
  const digits = (process.env.WHATSAPP_NUMBER || "").replace(/[^0-9]/g, "");
  if (digits.length < 10) {
    console.warn(
      `WARNING: WHATSAPP_NUMBER ("${process.env.WHATSAPP_NUMBER}") doesn't look like a real phone number ` +
        `once non-digits are stripped — order WhatsApp links will be broken until this is fixed in .env.`
    );
  }
  if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.length < 16) {
    console.warn("WARNING: ADMIN_API_KEY is missing or short. Use a long random value in production.");
  }
}

async function start() {
  checkConfig();
  try {
    await verifyConnection();
    console.log("Connected to MySQL.");
  } catch (err) {
    console.error("Could not connect to MySQL on startup:", err.message);
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`Shevs API listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await pool.end();
      console.log("Closed out remaining connections.");
      process.exit(0);
    });
    // Force-exit if connections don't close in time.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
