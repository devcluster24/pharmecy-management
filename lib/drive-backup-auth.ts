import { createClient } from "@supabase/supabase-js";

export async function getBackupOwner(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!supabaseUrl || !publicKey || !serviceRoleKey) {
    throw new Error("Server Supabase configuration is incomplete.");
  }
  if (!accessToken) throw new Error("Sign in to manage Google Drive backups.");

  const verifier = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await verifier.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Your session is invalid or expired.");

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error: profileError } = await serviceClient
    .from("user_profiles")
    .select("role, approval_status")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw new Error("Could not verify pharmacy account access.");
  if (profile?.role !== "pharmacy_user" || profile.approval_status !== "approved") {
    throw new Error("Only an approved pharmacy owner can manage Drive backups.");
  }

  return { user: data.user, serviceClient };
}

export function getBackupEncryptionKey() {
  const keyHex = process.env.BACKUP_TOKEN_ENCRYPTION_KEY;
  if (!keyHex || !/^[a-f0-9]{64}$/i.test(keyHex)) {
    throw new Error("BACKUP_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal key.");
  }
  return Buffer.from(keyHex, "hex");
}

export function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "The backup request failed.";
  return Response.json({ error: message }, { status });
}
