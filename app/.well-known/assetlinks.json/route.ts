const androidPackageName = "com.anonymous.Mobile";
const noStoreHeaders = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

export function GET() {
  const configuredFingerprints = process.env.ANDROID_APP_LINKS_SHA256;
  const fingerprints = configuredFingerprints
    ?.split(",")
    .map((fingerprint) => fingerprint.trim().toUpperCase())
    .filter(Boolean);

  if (
    !fingerprints?.length
    || fingerprints.some((fingerprint) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint))
  ) {
    return Response.json(
      { error: "Configure ANDROID_APP_LINKS_SHA256 with the app signing certificate SHA-256 fingerprint." },
      { status: 503, headers: noStoreHeaders },
    );
  }

  return Response.json(
    [{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: androidPackageName,
        sha256_cert_fingerprints: [...new Set(fingerprints)],
      },
    }],
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
