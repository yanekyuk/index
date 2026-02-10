import { NextRequest } from "next/server";
import { loadPregeneratedScenarios } from "@/lib/scenarios";
import { scenarioToGenerated, runChatEvaluation } from "@/lib/evaluator";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token)
    return Response.json({ error: "Missing Authorization header" }, { status: 401 });

  let body: { scenarioId?: string; scenarioIds?: string[]; apiUrl?: string };
  try {
    body = (await req.json()) as { scenarioId?: string; scenarioIds?: string[]; apiUrl?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiUrl =
    body.apiUrl?.trim() ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3001/api";

  const scenarios = loadPregeneratedScenarios();
  const ids = body.scenarioIds?.length
    ? body.scenarioIds
    : body.scenarioId
      ? [body.scenarioId]
      : [];

  if (ids.length === 0)
    return Response.json({ error: "Provide scenarioId or scenarioIds" }, { status: 400 });

  const results = [];

  for (const scenarioId of ids) {
    const s = scenarios.find((x) => x.id === scenarioId);
    if (!s) {
      results.push({ scenarioId, error: "Scenario not found" });
      continue;
    }

    try {
      const generated = scenarioToGenerated(s);
      const result = await runChatEvaluation(generated, { apiUrl, token });
      results.push(result);
    } catch (err) {
      results.push({
        scenarioId,
        error: err instanceof Error ? err.message : "Evaluation failed",
      });
    }
  }

  return Response.json({ results });
}
