import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const DELETE_BATCH_SIZE = 250;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !publicKey || !serviceRoleKey) {
    return jsonError("Server Supabase configuration is incomplete.", 503);
  }

  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return jsonError("Sign in is required to delete catalog data.", 401);
  }

  const verifier = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authResult, error: authError } = await verifier.auth.getUser(accessToken);
  if (authError || !authResult.user) {
    return jsonError("Your session is invalid or expired.", 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error: profileError } = await serviceClient
    .from("user_profiles")
    .select("role, approval_status")
    .eq("id", authResult.user.id)
    .maybeSingle();

  if (profileError) {
    return jsonError("Could not verify admin access.", 500);
  }
  if (
    (profile?.role !== "admin" && profile?.role !== "superadmin") ||
    profile.approval_status !== "approved"
  ) {
    return jsonError("Only an approved admin can delete the shared medicine catalog.", 403);
  }

  const { count: beforeCount, error: countError } = await serviceClient
    .from("admin_medicine_catalog")
    .select("id", { count: "exact", head: true });

  if (countError || beforeCount === null) {
    return jsonError(countError?.message ?? "Could not count catalog records before deletion.", 500);
  }

  let deletedCount = 0;
  while (true) {
    const { data: batch, error: batchError } = await serviceClient
      .from("admin_medicine_catalog")
      .select("id")
      .order("id", { ascending: true })
      .limit(DELETE_BATCH_SIZE);

    if (batchError) {
      return jsonError(
        `Deleted ${deletedCount} of ${beforeCount} catalog record(s), but could not read the next batch: ${batchError.message}`,
        500,
      );
    }

    if (!batch?.length) break;

    const { error: deleteError } = await serviceClient
      .from("admin_medicine_catalog")
      .delete()
      .in("id", batch.map((record) => record.id))
      .select("id");

    if (deleteError) {
      return jsonError(
        `Deleted ${deletedCount} of ${beforeCount} catalog record(s); the next batch failed: ${deleteError.message}`,
        500,
      );
    }

    deletedCount += batch.length;
  }

  const { count: remainingCount, error: verifyError } = await serviceClient
    .from("admin_medicine_catalog")
    .select("id", { count: "exact", head: true });

  if (verifyError || remainingCount === null) {
    return jsonError(verifyError?.message ?? "Could not verify the catalog deletion.", 500);
  }
  if (remainingCount > 0) {
    return Response.json(
      {
        error: `Deletion did not finish: ${remainingCount} catalog record(s) remain.`,
        deletedCount,
        remainingCount,
      },
      { status: 500 },
    );
  }

  return Response.json({
    deletedCount,
    remainingCount: 0,
  });
}
