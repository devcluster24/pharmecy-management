import { createClient } from "@supabase/supabase-js";
import { OCR_ACCEPTED_FILE_TYPES, OCR_MAX_FILE_BYTES } from "@/app/component/ocr/constants";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceUrl = process.env.PADDLEOCR_SERVICE_URL;
  const serviceApiKey = process.env.PADDLEOCR_SERVICE_API_KEY;
  const missingConfiguration = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", publicKey],
    ["PADDLEOCR_SERVICE_URL", serviceUrl],
    ["PADDLEOCR_SERVICE_API_KEY", serviceApiKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (!supabaseUrl || !publicKey || !serviceUrl || !serviceApiKey) {
    return jsonError(
      `OCR server configuration is incomplete. Missing ${missingConfiguration.join(", ")}. Add the server values to .env.local and restart Next.js.`,
      503,
    );
  }

  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonError("Sign in is required to use OCR.", 401);

  const verifier = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authResult, error: authError } = await verifier.auth.getUser(accessToken);
  if (authError || !authResult.user) return jsonError("Your session is invalid or expired.", 401);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > OCR_MAX_FILE_BYTES + 128 * 1024) {
    return jsonError("The selected file exceeds the 10 MB limit.", 413);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError("Upload a valid image or PDF file.", 400);
  }
  if (!(file instanceof File)) return jsonError("Upload a valid image or PDF file.", 400);
  if (!OCR_ACCEPTED_FILE_TYPES.some((type) => type === file.type)) {
    return jsonError("Choose a JPEG, PNG, WEBP, BMP, TIFF, or PDF file.", 415);
  }
  if (file.size > OCR_MAX_FILE_BYTES) return jsonError("The selected file exceeds the 10 MB limit.", 413);

  const upstreamBody = new FormData();
  upstreamBody.set("file", file, file.name);
  let upstream: Response;
  try {
    upstream = await fetch(`${serviceUrl.replace(/\/+$/, "")}/api/ocr/recognize`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceApiKey}` },
      body: upstreamBody,
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    return jsonError(isTimeout ? "OCR processing timed out. Try a smaller or clearer file." : "Could not connect to the PaddleOCR service.", isTimeout ? 504 : 502);
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return jsonError("The PaddleOCR service returned an invalid response.", 502);
  }
  if (!upstream.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string"
      ? payload.detail
      : "PaddleOCR could not process this file.";
    return jsonError(detail, upstream.status >= 500 ? 502 : upstream.status);
  }
  return Response.json(payload, { status: upstream.status });
}
