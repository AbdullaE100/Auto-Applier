import { createClient, SupabaseClient, User } from "npm:@supabase/supabase-js@2";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

export interface AuthContext {
  user: User;
  /** Client acting as the user (RLS applies). */
  userClient: SupabaseClient;
  /** Service-role client (bypasses RLS) - only used for metering. */
  adminClient: SupabaseClient;
}

export async function authenticate(req: Request): Promise<AuthContext> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) throw new HttpError(401, "Missing auth token", "unauthorized");

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Invalid session", "unauthorized");

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  return { user: data.user, userClient, adminClient };
}

export async function meter(ctx: AuthContext, kind: "answer" | "cv") {
  const { data, error } = await ctx.adminClient.rpc("consume_ai_answer", { p_user_id: ctx.user.id, p_kind: kind });
  if (error) throw new HttpError(500, "Usage metering failed");
  if (!data?.allowed) {
    throw new HttpError(
      429,
      kind === "cv"
        ? "Daily CV parsing limit reached. Try again tomorrow."
        : `Daily AI answer limit (${data?.limit}) reached for your plan.`,
      "ai_limit_reached",
    );
  }
  return data;
}

/** Must stay in sync with normalizeQuestion() in extension/shared/text.js */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/\(required\)|\brequired\s*$/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
      console.error(err);
      return json({ error: "Internal error", code: "internal" }, 500);
    }
  });
}
