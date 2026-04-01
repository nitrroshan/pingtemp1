/**
 * Seed Guard
 *
 * Hard gate that prevents seed operations in production.
 * Call this at the start of every seed function.
 */

export function assertSeedAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: Cannot seed in production environment (NODE_ENV=production)",
    );
  }

  if (process.env.SEED_ENABLED !== "true") {
    console.log(
      "[seed] Seeding disabled. Set SEED_ENABLED=true to enable.\n" +
        "       e.g. SEED_ENABLED=true bun run seed",
    );
    process.exit(0);
  }
}
