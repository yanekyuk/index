/** PostgreSQL error code for "undefined table" */
const PG_UNDEFINED_TABLE = "42P01";

export function isMissingTableError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === PG_UNDEFINED_TABLE
  );
}

export const MIGRATE_HINT =
  "Run: cd evaluator && bun run db:migrate (ensure DATABASE_URL in .env points to the same DB the app uses)";
