// Applies every .sql file in /migrations in filename order, once each.
// Applied files are recorded in the schema_migrations table, so this is safe
// to run on every deploy. A database that was set up before this tracker
// existed (001 + 002 already applied by hand) is detected and adopted.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const LEGACY = ["001_init.sql", "002_seed.sql"];

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
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name VARCHAR(120) NOT NULL PRIMARY KEY,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    const [rows] = await connection.query("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => r.name));

    if (done.size === 0) {
      const [[{ n }]] = await connection.query(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'products'"
      );
      if (n > 0) {
        for (const name of LEGACY) {
          await connection.query("INSERT INTO schema_migrations (name) VALUES (?)", [name]);
          done.add(name);
        }
        console.log("Existing database detected — marked 001_init and 002_seed as applied.");
      }
    }

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      console.log(`Applying ${file}...`);
      await connection.query(fs.readFileSync(path.join(dir, file), "utf8"));
      await connection.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
      applied++;
    }
    console.log(applied ? `Done — applied ${applied} migration(s).` : "Database is up to date.");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
