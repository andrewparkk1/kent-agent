/** GET /api/ollama/models — proxy to local Ollama to list installed models. */

export async function handleOllamaModels(req: Request) {
  const url = new URL(req.url);
  const baseUrl = url.searchParams.get("base_url") || "http://localhost:11434";

  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return Response.json({ models: [], error: "Ollama not reachable" });
    const data = await res.json();
    const models = (data.models || []).map((m: any) => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at,
    }));
    return Response.json({ models });
  } catch {
    return Response.json({ models: [], error: "Ollama not running" });
  }
}
