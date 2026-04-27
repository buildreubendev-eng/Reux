import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Example: postgres://datalang:datalang@127.0.0.1:5432/datalang_dev");
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const result = await client.query("select current_database() as database, current_user as user");
  const row = result.rows[0];
  console.log(`PostgreSQL reachable: database=${row.database} user=${row.user}`);
} catch (error) {
  console.error(`PostgreSQL preflight failed for DATABASE_URL=${redact(databaseUrl)}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

function redact(value) {
  return value.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}
