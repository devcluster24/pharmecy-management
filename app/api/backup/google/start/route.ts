import { createHash, randomBytes } from "node:crypto";
import { getBackupOwner, jsonError } from "@/lib/drive-backup-auth";

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

export async function POST(request: Request) {
  try {
    const { user, serviceClient } = await getBackupOwner(request);
    const clientId = process.env.BACKUP_GOOGLE_CLIENT_ID;
    const appUrl = process.env.BACKUP_APP_URL || new URL(request.url).origin;
    if (!clientId) throw new Error("Google Drive OAuth is not configured on the server.");

    let mobileReturnUrl: string | null = null;
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body: unknown = await request.json();
      if (body && typeof body === "object" && "returnUrl" in body) {
        if (!isMobileBackupReturnUrl(body.returnUrl)) {
          return Response.json({ error: "Mobile backup return URL is invalid." }, { status: 400 });
        }
        mobileReturnUrl = body.returnUrl;
      }
    }

    const state = randomBytes(32).toString("hex");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const { error } = await serviceClient
      .from("pharmacy_drive_backup_settings")
      .upsert({
        owner_user_id: user.id,
        oauth_state_hash: stateHash,
        oauth_state_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        oauth_return_url: mobileReturnUrl,
        updated_at: new Date().toISOString(),
      }, { onConflict: "owner_user_id" });
    if (error) throw new Error("Could not prepare Google Drive authorization.");

    const callbackUrl = `${appUrl.replace(/\/+$/, "")}/api/backup/google/callback`;
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", clientId);
    googleUrl.searchParams.set("redirect_uri", callbackUrl);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
    googleUrl.searchParams.set("access_type", "offline");
    googleUrl.searchParams.set("prompt", "consent");
    googleUrl.searchParams.set("state", state);
    return Response.json({ authorizationUrl: googleUrl.toString() });
  } catch (error) {
    return jsonError(error, error instanceof Error && error.message.startsWith("Sign in") ? 401 : 400);
  }
}
