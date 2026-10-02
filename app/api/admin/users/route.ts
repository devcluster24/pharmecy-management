import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonError("Sign in is required.", 401);

  const verifier = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authResult, error: authError } = await verifier.auth.getUser(accessToken);
  if (authError || !authResult.user) return jsonError("Your session is invalid or expired.", 401);

  const { data: requester, error: requesterError } = await serviceClient
    .from("user_profiles")
    .select("role")
    .eq("id", authResult.user.id)
    .maybeSingle();

  if (requesterError) return jsonError("Could not verify superadmin access.", 500);
  if (requester?.role !== "superadmin") {
    return jsonError("Only an approved superadmin can create admin users.", 403);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  if (!input || typeof input !== "object") return jsonError("Invalid user details.", 400);
  const body = input as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address.", 400);
  if (fullName.length < 2) return jsonError("Full name must contain at least 2 characters.", 400);
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return jsonError("Username must be 3-32 letters, numbers, dots, underscores, or hyphens.", 400);
  if (password.length < 8) return jsonError("Password must be at least 8 characters.", 400);

  const { data: existingUsername, error: usernameError } = await serviceClient
    .from("user_profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();

  if (usernameError) return jsonError("Could not check username availability.", 500);
  if (existingUsername) return jsonError("That username is already in use.", 409);

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      registration_type: "pharmacy_user",
      full_name: fullName,
      username,
      phone,
    },
  });

  if (createError || !created.user) {
    return jsonError(createError?.message ?? "Could not create the Auth user.", 400);
  }

  const { error: promoteError } = await serviceClient
    .from("user_profiles")
    .update({ role: "admin", approval_status: "approved" })
    .eq("id", created.user.id);

  if (promoteError) {
    await serviceClient.auth.admin.deleteUser(created.user.id);
    return jsonError("The user was created but admin access could not be assigned; the user creation was rolled back.", 500);
  }

  return Response.json({
    user: { id: created.user.id, email: created.user.email, fullName, username },
  }, { status: 201 });
}
