import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/datamanager",
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_ADS_REDIRECT_URI!
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get("connectionId") ?? `demo-${Date.now()}`;
  const client = createOAuthClient();

  const requestPayload = {
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: connectionId,  // ← from frontend
  };

  const authUrl = client.generateAuthUrl(requestPayload);

  // Log request / response for display in the UI
  const requestLog = {
    description: "generateAuthUrl() called on OAuth2Client",
    params: requestPayload,
    clientId: process.env.GOOGLE_CLIENT_ID,
    redirectUri: process.env.GOOGLE_ADS_REDIRECT_URI,
  };

  const responseLog = {
    authUrl,
    note: "Redirect the user to this URL. Google will ask them to approve the requested scopes.",
  };
  console.log(authUrl);
  return NextResponse.json({ request: requestLog, response: responseLog, authUrl });
}
