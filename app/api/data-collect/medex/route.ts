import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MEDEx_HOST = "medex.com.bd";
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

class SourceVerificationError extends Error {
  constructor() {
    super("The source site returned a CAPTCHA/security check instead of product data. Automatic collection is blocked by the source; try again later or use a permitted data export.");
    this.name = "SourceVerificationError";
  }
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isAllowedMedexUrl(url: URL) {
  if (
    url.protocol !== "https:" ||
    url.hostname !== MEDEx_HOST ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    return false;
  }

  if (
    url.pathname !== "/brands" &&
    !/^\/brands\/\d+\/[a-z0-9-]+(?:\/bn)?$/i.test(url.pathname)
  ) {
    return false;
  }

  for (const [key, value] of url.searchParams) {
    if (
      !["page", "alpha", "herbal", "__m_asn"].includes(key) ||
      value.length > 120 ||
      /[\u0000-\u001f]/.test(value)
    ) {
      return false;
    }

    if (key === "page" && (!/^\d+$/.test(value) || Number(value) > 10000)) {
      return false;
    }
    if (key === "alpha" && !/^[a-z]$/i.test(value)) {
      return false;
    }
    if (key === "herbal" && value !== "1") {
      return false;
    }
  }

  return true;
}

async function fetchMedexHtml(startUrl: URL) {
  let currentUrl = startUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(currentUrl, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; PharmecyDataCollector/1.0)",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error("The source redirected too many times.");
      }

      currentUrl = new URL(location, currentUrl);
      if (currentUrl.hostname === MEDEx_HOST && currentUrl.pathname === "/captcha-challenge") {
        throw new SourceVerificationError();
      }
      if (!isAllowedMedexUrl(currentUrl)) {
        throw new Error("The source redirected to an unsupported page.");
      }
      continue;
    }

    if (!response.ok) {
      throw new Error(`The source returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      throw new Error("The MedEx link did not return an HTML page.");
    }

    const html = await response.text();
    if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
      throw new Error("The MedEx page is larger than the 5 MB limit.");
    }

    return { html, finalUrl: currentUrl.href };
  }

  throw new Error("Could not load the source page.");
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !publicKey) {
    return jsonError("Server Supabase configuration is incomplete.", 503);
  }

  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return jsonError("Sign in is required to collect data.", 401);
  }

  const verifier = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authResult, error: authError } = await verifier.auth.getUser(accessToken);
  if (authError || !authResult.user) {
    return jsonError("Your session is invalid or expired.", 401);
  }

  const userClient = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: profile, error: profileError } = await userClient
    .from("user_profiles")
    .select("role")
    .eq("id", authResult.user.id)
    .maybeSingle();

  if (profileError) {
    return jsonError("Could not verify admin access.", 500);
  }
  if (profile?.role !== "admin" && profile?.role !== "superadmin") {
    return jsonError("Only an admin can collect MedEx product data.", 403);
  }

  const requestedUrl = new URL(request.url).searchParams.get("url");
  if (!requestedUrl || requestedUrl.length > 2048) {
    return jsonError("Enter a valid supported product listing URL.", 400);
  }

  let medexUrl: URL;
  try {
    medexUrl = new URL(requestedUrl);
  } catch {
    return jsonError("Enter a valid supported product listing URL.", 400);
  }
  if (!isAllowedMedexUrl(medexUrl)) {
    return jsonError("Only HTTPS product listing and detail pages from the supported source are allowed.", 400);
  }

  try {
    const page = await fetchMedexHtml(medexUrl);
    return Response.json(page, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch the source page.";
    if (error instanceof SourceVerificationError) {
      return jsonError(message, 503);
    }
    const status = error instanceof Error && error.name === "TimeoutError" ? 504 : 502;
    return jsonError(message, status);
  }
}
