import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getBackupEncryptionKey } from "@/lib/drive-backup-auth";

export const runtime = "nodejs";

function isMobileBackupReturnUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const isBackupPage = (url.hostname === "dashboard" && url.pathname === "/menu/backup-file")
      || (url.hostname === "" && url.pathname === "/dashboard/menu/backup-file");
    return url.protocol === "mobile:"
      && isBackupPage
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function resultUrl(
  request: Request,
  status: "connected" | "error",
  message?: string,
  mobileReturnUrl?: string | null,
) {
  if (isMobileBackupReturnUrl(mobileReturnUrl)) {
    const url = new URL(mobileReturnUrl);
    url.searchParams.set("backup_oauth", status);
    if (message) url.searchParams.set("backup_message", message);
    return Response.redirect(url, 303);
  }
  const appUrl = process.env.BACKUP_APP_URL || new URL(request.url).origin;
  const url = new URL("/dashboard/settings", appUrl);
  url.searchParams.set("backup_oauth", status);
  if (message) url.searchParams.set("backup_message", message);
  return Response.redirect(url, 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");
  if (!state || !/^[a-f0-9]{64}$/i.test(state)) {
    return resultUrl(request, "error", "Google authorization response was incomplete.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.BACKUP_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.BACKUP_GOOGLE_CLIENT_SECRET;
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    return resultUrl(request, "error", "Google Drive OAuth server configuration is incomplete.");
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const stateHash = createHash("sha256").update(state).digest("hex");
  const { data: backupSettings, error: settingsError } = await serviceClient
    .from("pharmacy_drive_backup_settings")
    .select("owner_user_id, oauth_state_hash, oauth_state_expires_at, oauth_return_url")
    .eq("oauth_state_hash", stateHash)
    .maybeSingle();
  if (settingsError || !backupSettings) {
    return resultUrl(request, "error", "Google authorization expired. Start the connection again.");
  }
  if (Date.parse(backupSettings.oauth_state_expires_at ?? "") <= Date.now()) {
    return resultUrl(request, "error", "Google authorization expired. Start the connection again.", backupSettings.oauth_return_url);
  }
  if (googleError) {
    return resultUrl(request, "error", "Google Drive access was not granted.", backupSettings.oauth_return_url);
  }
  if (!code) {
    return resultUrl(request, "error", "Google authorization response was incomplete.", backupSettings.oauth_return_url);
  }

  try {
    const appUrl = process.env.BACKUP_APP_URL || url.origin;
    const redirectUri = `${appUrl.replace(/\/+$/, "")}/api/backup/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const tokenPayload: unknown = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload || typeof tokenPayload !== "object") {
      throw new Error("Google could not exchange the authorization code.");
    }
    const tokens = tokenPayload as { refresh_token?: unknown };
    if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) {
      throw new Error("Google did not return a refresh token. Reconnect and approve Drive access.");
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getBackupEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(tokens.refresh_token, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const { error: saveError } = await serviceClient
      .from("pharmacy_drive_backup_secrets")
      .upsert({
        owner_user_id: backupSettings.owner_user_id,
        refresh_token_ciphertext: ciphertext.toString("base64"),
        refresh_token_iv: iv.toString("base64"),
        refresh_token_tag: tag.toString("base64"),
        updated_at: new Date().toISOString(),
      }, { onConflict: "owner_user_id" });
    if (saveError) throw new Error("Could not securely save Google Drive connection.");
    const { error: clearStateError } = await serviceClient
      .from("pharmacy_drive_backup_settings")
      .update({
        oauth_state_hash: null,
        oauth_state_expires_at: null,
        oauth_return_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_user_id", backupSettings.owner_user_id);
    if (clearStateError) throw new Error("Google Drive connected, but the authorization request could not be cleared.");
    return resultUrl(request, "connected", undefined, backupSettings.oauth_return_url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive authorization failed.";
    return resultUrl(request, "error", message, backupSettings.oauth_return_url);
  }
}
