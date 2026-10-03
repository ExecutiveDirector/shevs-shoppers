// Applies every .sql file in /migrations, in filename order, against the
// database in .env. Safe to re-run: schema statements use IF NOT EXISTS
// and the seed coupon uses ON DUPLICATE KEY UPDATE. The product/category
// seed INSERTs are not re-run-safe (they'd duplicate rows), so only run
// this against a fresh database, or edit 002_seed.sql after first use.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function main() {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    for (const file of files) {
      console.log(`Applying ${file}...`);
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await connection.query(sql);
    }
    console.log("Done.");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
