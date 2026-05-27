// Supabase Edge Function: daily-export
// Path: /functions/v1/daily-export
// Deploy: supabase functions deploy daily-export
//
// Purpose: Nightly backup of critical tables to Supabase Storage.
// Exports students, employers, postings, applications, message_threads,
// and messages as JSON files with a 30-day retention window.
//
// HOW TO SCHEDULE:
//   1. Deploy this function: supabase functions deploy daily-export
//   2. In Supabase Dashboard → Edge Functions → daily-export → Settings
//      set the CRON schedule: 0 3 * * * (3:00 AM UTC daily)
//   3. Alternatively, add to supabase/config.toml:
//        [functions.daily-export]
//        verify_jwt = false
//        schedule = "0 3 * * *"
//
// BACKUP POLICY NOTE (SECURITY.md Pillar 1.8):
//   Supabase Point-in-Time Recovery (PITR) requires the Pro plan.
//   If this project is on the Free plan, this nightly export is the ONLY
//   backup mechanism. Confirm the plan tier with the school board IT team
//   before submission.
//
// IMPORTANT: Uses SUPABASE_SERVICE_ROLE_KEY — runs server-side only.
// NEVER expose this function's key to the frontend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TABLES_TO_EXPORT = [
  "students",
  "employers",
  "postings",
  "applications",
  "message_threads",
  "messages",
  "notifications",
  "audit_logs",
];

const RETENTION_DAYS = 30;
const STORAGE_BUCKET  = "sib-backups"; // Create this bucket in Supabase Storage manually

serve(async (_req: Request) => {
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // service_role — server-side only
  );

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const results: Record<string, string> = {};

  for (const table of TABLES_TO_EXPORT) {
    try {
      // Fetch all rows — for large tables consider paginating with .range()
      const { data, error } = await adminClient
        .from(table)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error(`Export error on ${table}:`, error.message);
        results[table] = `ERROR: ${error.message}`;
        continue;
      }

      const filename = `${dateStr}/${table}.json`;
      const fileContent = JSON.stringify(data, null, 2);

      const { error: uploadError } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .upload(filename, fileContent, {
          contentType: "application/json",
          upsert: true,
        });

      if (uploadError) {
        console.error(`Upload error on ${table}:`, uploadError.message);
        results[table] = `UPLOAD_ERROR: ${uploadError.message}`;
      } else {
        results[table] = `OK: ${data?.length ?? 0} rows`;
      }
    } catch (err) {
      results[table] = `EXCEPTION: ${String(err)}`;
    }
  }

  // Clean up backups older than RETENTION_DAYS days
  // PIPEDA data minimization: IP addresses in audit_logs should not be retained indefinitely.
  // After RETENTION_DAYS, delete backup files (actual DB rows are kept but exports purged).
  try {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const { data: files } = await adminClient.storage
      .from(STORAGE_BUCKET)
      .list("", { limit: 1000 });

    if (files) {
      const toDelete = files
        .filter(f => f.name < cutoffStr)
        .map(f => f.name);

      if (toDelete.length > 0) {
        await adminClient.storage.from(STORAGE_BUCKET).remove(toDelete);
        console.log(`Cleaned ${toDelete.length} old backup(s) older than ${cutoffStr}`);
      }
    }
  } catch (cleanErr) {
    console.error("Cleanup error:", String(cleanErr));
  }

  // Write audit event for this backup run
  try {
    await adminClient.from("audit_logs").insert({
      actor_role:  "system",
      action_type: "data_export_requested",
      metadata:    { tables: TABLES_TO_EXPORT, results, date: dateStr },
    });
  } catch (_) { /* non-fatal */ }

  return new Response(
    JSON.stringify({ success: true, date: dateStr, tables: results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
