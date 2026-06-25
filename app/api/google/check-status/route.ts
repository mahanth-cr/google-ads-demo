import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getToken, setToken } from "@/lib/token-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const requestId = body.requestId as string;
  const connectionId = body.connectionId as string;

if (!connectionId) {
  return NextResponse.json(
    { error: "No connection ID provided." },
    { status: 400 }
  );
}

  if (!requestId) {
    return NextResponse.json(
      { error: "requestId is required" },
      { status: 400 }
    );
  }

  const accessToken = getToken(`google-ads-${connectionId}-access-token`);

  if (!accessToken) {
    return NextResponse.json(
      { error: "No access token found" },
      { status: 401 }
    );
  }

  // ── Token refresh logic ──────────────────────────────────────────────────
  let validAccessToken = accessToken;

  const expiresAt = getToken(`google-ads-${connectionId}-expires-at`);
  const isExpired = expiresAt
    ? Date.now() > parseInt(expiresAt) - 60_000 // refresh 1 min before expiry
    : false;

  if (isExpired) {
    const refreshToken = getToken(`google-ads-${connectionId}-refresh-token`);
    if (refreshToken) {
      try {
        const oAuth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID!,
          process.env.GOOGLE_CLIENT_SECRET!,
          process.env.GOOGLE_ADS_REDIRECT_URI!
        );
        oAuth2Client.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await oAuth2Client.refreshAccessToken();

        if (credentials.access_token) {
          setToken(`google-ads-${connectionId}-access-token`, credentials.access_token);
          validAccessToken = credentials.access_token;
        }
        if (credentials.expiry_date) {
          setToken(`google-ads-${connectionId}-expires-at`, String(credentials.expiry_date));
        }
      } catch (refreshErr: any) {
        console.error("Token refresh failed:", refreshErr.message);
        // Continue with existing token — let Google tell us if it's invalid
      }
    }
  }
  // ── End token refresh logic ──────────────────────────────────────────────

  const url = `https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`;

  const request = {
    url,
    method: "GET",
    headers: {
      Authorization: "Bearer <redacted>",
    },
  };

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${validAccessToken}`,
      },
    });

    const text = await res.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text.slice(0, 500) };
    }

    const response = { status: res.status, ok: res.ok, body: payload };

    // Extract key fields for the UI
    const destinations = payload.requestStatusPerDestination ?? [];
    const firstDest = destinations[0] ?? {};
    const requestStatus = firstDest.requestStatus ?? "PROCESSING";

    const ingestionStatus =
      firstDest.audienceMembersIngestionStatus?.userDataIngestionStatus ?? {};

    const result = {
      requestStatus,
      recordCount: ingestionStatus.recordCount ?? null,
      userIdentifierCount: ingestionStatus.userIdentifierCount ?? null,
      matchRateRange: ingestionStatus.uploadMatchRateRange ?? null,
      errorInfo: firstDest.errorInfo ?? [],
      warningInfo: firstDest.warningInfo ?? [],
      isFinal: ["SUCCESS", "FAILURE", "PARTIAL_SUCCESS"].includes(requestStatus),
    };

    return NextResponse.json({ success: true, request, response, result });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}