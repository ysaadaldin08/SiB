// Supabase Edge Function: audit-log
// Path: /functions/v1/audit-log
// Deploy: supabase functions deploy audit-log
//
// Purpose: Append-only audit log writer. Validates the caller's JWT before
// inserting a record into the audit_logs table. The table itself has no
// client-accessible INSERT policy — only this function (running as service_role)
// can write audit events.
//
// Legal basis: PIPEDA Principle 1 (accountability) — every sensitive action
// involving personal information must be logged with actor and timestamp.
// Security basis: Pillar 1.7
//
// IMPORTANT: This function uses the service_role key from environment variables.
// NEVER expose the service_role key to the frontend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Valid action types — all audit events must use one of these values.
// Add new types here and update this list before deploying.
const VALID_ACTION_TYPES = new Set([
  "user_signup",
  "user_login",
  "user_login_failed",
  "user_logout",
  "user_email_verified",
  "coordinator_login",
  "coordinator_approve_employer",
  "coordinator_reject_employer",
  "coordinator_review_thread",
  "coordinator_close_thread",
  "coordinator_verify_user",
  "employer_create_posting",
  "employer_update_posting",
  "employer_archive_posting",
  "student_submit_application",
  "employer_update_application_status",
  "message_sent",
  "message_flagged",
  "thread_reported",
  "rate_limit_hit",
  "parental_consent_sent",
  "parental_consent_confirmed",
  "data_export_requested",
  "account_delete_requested",
  "concern_report_submitted",
]);

const VALID_ROLES = new Set(["student", "employer", "coordinator", "system", "anonymous"]);

serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate required fields
  const { actor_role, action_type, target_id, metadata } = body;

  if (!actor_role || !VALID_ROLES.has(String(actor_role))) {
    return new Response(JSON.stringify({ error: "Invalid actor_role" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!action_type || !VALID_ACTION_TYPES.has(String(action_type))) {
    return new Response(JSON.stringify({ error: "Invalid action_type" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Extract caller's JWT to get actor_id — anonymous calls (login_failed) skip this
  let actor_id: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    // Verify the JWT using Supabase Auth
    const supabaseAuthClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error: authError } = await supabaseAuthClient.auth.getUser(token);
    if (!authError && user) {
      actor_id = user.id;
    }
  }

  // Extract IP address from request headers (Supabase Edge Functions receive CF headers)
  const ip_address =
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    null;

  // Insert using service_role client (bypasses RLS — only this function can insert)
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // NEVER expose this key to the frontend
  );

  // Sanitise metadata: never log passwords, tokens, or full email addresses
  // Caller is responsible for omitting sensitive fields before calling this function.
  const safeMetadata = typeof metadata === "object" && metadata !== null ? metadata : {};

  const { error } = await adminClient
    .from("audit_logs")
    .insert({
      actor_id:    actor_id,
      actor_role:  String(actor_role),
      action_type: String(action_type),
      target_id:   target_id ? String(target_id) : null,
      ip_address:  ip_address,
      metadata:    safeMetadata,
    });

  if (error) {
    // Log to Deno stderr (visible in Supabase Edge Function logs) but don't expose to caller
    console.error("audit-log insert error:", error.message);
    return new Response(JSON.stringify({ success: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
