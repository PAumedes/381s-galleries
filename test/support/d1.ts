import { applyD1Migrations, env } from "cloudflare:test";

/** Migrations injected by vitest.config.ts (miniflare binding TEST_MIGRATIONS). */
export function testMigrations(): D1Migration[] {
  return (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;
}

/** Apply every migration to the test D1 (idempotent; call from beforeAll). */
export async function migrateDb(): Promise<void> {
  await applyD1Migrations(env.DB, testMigrations());
}

/** Empty the given tables in one batch, in the order given (children first). */
export async function resetTables(...tables: string[]): Promise<void> {
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}
