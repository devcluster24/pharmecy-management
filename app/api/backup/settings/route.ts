import { getBackupOwner, jsonError } from "@/lib/drive-backup-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user, serviceClient } = await getBackupOwner(request);
    const [{ data: settings, error: settingsError }, { data: secret, error: secretError }, { data: history, error: historyError }] = await Promise.all([
      serviceClient
        .from("pharmacy_drive_backup_settings")
        .select("drive_folder_id, auto_backup_enabled, interval_days, products_exported_at")
        .eq("owner_user_id", user.id)
        .maybeSingle(),
      serviceClient
        .from("pharmacy_drive_backup_secrets")
        .select("owner_user_id")
        .eq("owner_user_id", user.id)
        .maybeSingle(),
      serviceClient
        .from("pharmacy_drive_backup_history")
        .select("id, created_at, details, status, message")
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (settingsError || secretError || historyError) throw new Error("Could not load backup settings and history.");
    return Response.json({
      connected: Boolean(secret),
      autoBackupEnabled: settings?.auto_backup_enabled ?? false,
      intervalDays: settings?.interval_days ?? 1,
      productManagementBackedUp: Boolean(settings?.products_exported_at),
      folderCreated: Boolean(settings?.drive_folder_id),
      history: history ?? [],
    });
  } catch (error) {
    return jsonError(error, error instanceof Error && /sign in|session/i.test(error.message) ? 401 : 500);
  }
}

export async function POST(request: Request) {
  try {
    const { user, serviceClient } = await getBackupOwner(request);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Backup settings are invalid." }, { status: 400 });
    }
    const settings = body as Record<string, unknown>;
    if (typeof settings.autoBackupEnabled !== "boolean"
      || typeof settings.intervalDays !== "number"
      || !Number.isInteger(settings.intervalDays)
      || settings.intervalDays < 1
      || settings.intervalDays > 3650) {
      return Response.json({ error: "Choose an interval from 1 to 3650 days." }, { status: 400 });
    }

    const { data: current, error: readError } = await serviceClient
      .from("pharmacy_drive_backup_secrets")
      .select("owner_user_id")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (readError) throw new Error("Could not verify Google Drive connection.");
    if (settings.autoBackupEnabled && !current?.owner_user_id) {
      return Response.json({ error: "Connect Google Drive before enabling Auto Backup." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const { error } = await serviceClient
      .from("pharmacy_drive_backup_settings")
      .upsert({
        owner_user_id: user.id,
        auto_backup_enabled: settings.autoBackupEnabled,
        interval_days: settings.intervalDays,
        next_backup_at: settings.autoBackupEnabled ? now : null,
        updated_at: now,
      }, { onConflict: "owner_user_id" });
    if (error) throw new Error("Could not save Auto Backup settings.");
    return Response.json({ saved: true });
  } catch (error) {
    return jsonError(error, error instanceof Error && /sign in|session/i.test(error.message) ? 401 : 500);
  }
}
