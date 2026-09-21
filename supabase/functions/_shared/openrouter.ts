import { HttpError } from "./common.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(
  messages: ChatMessage[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new HttpError(500, "AI is not configured (OPENROUTER_API_KEY missing)", "ai_not_configured");
  const model = Deno.env.get("OPENROUTER_MODEL") ?? "anthropic/claude-haiku-4.5";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": Deno.env.get("APP_URL") ?? "https://jobflow.ai",
        "X-Title": "JobFlow AI",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 800,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("OpenRouter error", res.status, detail.slice(0, 500));
      throw new HttpError(502, "AI provider error", "ai_provider_error");
    }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    return content.trim();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(504, "AI request timed out", "ai_timeout");
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts the first JSON object from a model response (tolerates code fences). */
export function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new HttpError(502, "AI returned invalid JSON", "ai_bad_output");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new HttpError(502, "AI returned invalid JSON", "ai_bad_output");
  }
}
