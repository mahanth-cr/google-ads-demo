import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { setToken } from "@/lib/token-store";

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_ADS_REDIRECT_URI!
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const connectionId = searchParams.get("state") ?? `demo-${Date.now()}`;

  if (!code) {
    const redirectUrl = new URL("/", req.url);
    redirectUrl.searchParams.set("oauth_error", encodeURIComponent("missing_code"));
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const oAuth2Client = createOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);

    if (tokens.access_token) setToken(`google-ads-${connectionId}-access-token`, tokens.access_token);
    if (tokens.refresh_token) setToken(`google-ads-${connectionId}-refresh-token`, tokens.refresh_token);
    if (tokens.expiry_date) setToken(`google-ads-${connectionId}-expires-at`, String(tokens.expiry_date));

    let listAccountsResponse: any = { status: "skipped", body: {} };
    let resourceNames: string[] = [];

    try {
      const adsRes = await fetch(
        "https://googleads.googleapis.com/v24/customers:listAccessibleCustomers",
        {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
          },
        }
      );
      const text = await adsRes.text();
      let adsBody: any = {};
      try { adsBody = JSON.parse(text); } catch { adsBody = { raw: text.slice(0, 200) }; }
      resourceNames = adsBody.resourceNames ?? [];
      listAccountsResponse = { status: adsRes.status, ok: adsRes.ok, body: adsBody };
    } catch (adsErr: any) {
      listAccountsResponse = { status: "error", ok: false, body: { error: adsErr.message } };
    }

    const summary = {
      connectionId,
      tokensReceived: {
        access_token: tokens.access_token ? "[PRESENT]" : "[MISSING]",
        refresh_token: tokens.refresh_token ? "[PRESENT]" : "[MISSING]",
        expiry_date: tokens.expiry_date,
        token_type: tokens.token_type,
        scope: tokens.scope,
      },
      accounts: resourceNames.map((r: string) => r.replace("customers/", "")),
        listAccountsRequest: {
        url: "https://googleads.googleapis.com/v24/customers:listAccessibleCustomers",
        method: "GET",
        headers: {
          Authorization: "Bearer <redacted>",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
        },
      },
      listAccountsResponse,
    };

    const redirectUrl = new URL("/", req.url);
    redirectUrl.searchParams.set("oauth_success", "1");
    redirectUrl.searchParams.set("summary", encodeURIComponent(JSON.stringify(summary)));
    return NextResponse.redirect(redirectUrl);

  } catch (err: any) {
    console.error("OAuth callback error:", err);
    const redirectUrl = new URL("/", req.url);
    redirectUrl.searchParams.set("oauth_error", encodeURIComponent(err.message ?? "unknown"));
    return NextResponse.redirect(redirectUrl);
  }
}