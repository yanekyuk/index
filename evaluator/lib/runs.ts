import { db } from "@/lib/db/drizzle";
import { evalRuns, evalRunResults } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

/**
 * Adds scenarios to all non-completed (draft/running) runs so new test cases
 * are automatically picked up by any active evaluation run.
 */
export async function addScenariosToActiveRuns(scenarioIds: string[]) {
  if (scenarioIds.length === 0) return;

  const activeRuns = await db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(inArray(evalRuns.status, ["draft", "running"]));

  if (activeRuns.length === 0) return;

  const rows = activeRuns.flatMap((run) =>
    scenarioIds.map((scenarioId) => ({
      evalRunId: run.id,
      scenarioId,
    }))
  );

  await db.insert(evalRunResults).values(rows);
}
