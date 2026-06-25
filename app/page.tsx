"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type LogEntry = {
  label: string;
  request: unknown;
  response: unknown;
};

type OAuthSummary = {
  connectionId: string;
  tokensReceived: Record<string, unknown>;
  accounts: string[];
  listAccountsRequest: unknown;
  listAccountsResponse: unknown;
};

type Status = "idle" | "loading" | "success" | "error";

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre style={{
      background: "#f6f8fa",
      border: "1px solid #e1e4e8",
      borderRadius: "6px",
      padding: "12px",
      fontSize: "12px",
      fontFamily: "'JetBrains Mono', monospace",
      overflowX: "auto",
      maxHeight: "320px",
      overflowY: "auto",
      lineHeight: "1.5",
      color: "#24292e",
      margin: 0,
    }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function LogEntry({ entry }: { entry: LogEntry }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{
        fontSize: "12px",
        fontWeight: 600,
        color: "#444",
        marginBottom: "8px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}>
        {entry.label}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "11px", color: "#888", marginBottom: "4px", fontWeight: 500 }}>REQUEST</div>
          <JsonBlock data={entry.request} />
        </div>
        <div>
          <div style={{ fontSize: "11px", color: "#888", marginBottom: "4px", fontWeight: 500 }}>RESPONSE</div>
          <JsonBlock data={entry.response} />
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const styles: Record<Status, { bg: string; color: string; label: string }> = {
    idle: { bg: "#f1f3f5", color: "#666", label: "Ready" },
    loading: { bg: "#fff8e1", color: "#b45309", label: "Running..." },
    success: { bg: "#e6f4ea", color: "#1a7f37", label: "Success" },
    error: { bg: "#ffeef0", color: "#cf222e", label: "Failed" },
  };
  const s = styles[status];
  return (
    <span style={{
      background: s.bg,
      color: s.color,
      padding: "2px 10px",
      borderRadius: "20px",
      fontSize: "12px",
      fontWeight: 500,
    }}>
      {s.label}
    </span>
  );
}

function DemoContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [oauthStatus, setOauthStatus] = useState<Status>("idle");
  const [oauthLogs, setOauthLogs] = useState<LogEntry[]>([]);
  const [oauthSummary, setOauthSummary] = useState<OAuthSummary | null>(null);
  const [connectionId] = useState(() => {
  if (typeof window === "undefined") return "demo-ssr";
  const stored = sessionStorage.getItem("connectionId");
  if (stored) return stored;
  const newId = `demo-${Date.now()}`;
  sessionStorage.setItem("connectionId", newId);
  return newId;
});
  const [uploadStatus, setUploadStatus] = useState<Status>("idle");
  const [uploadLogs, setUploadLogs] = useState<LogEntry[]>([]);
  const [checkStatus, setCheckStatus] = useState<string>("idle");
  const [checkLogs, setCheckLogs] = useState<LogEntry[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  useEffect(() => {
    const success = searchParams.get("oauth_success");
    const error = searchParams.get("oauth_error");
    const rawSummary = searchParams.get("summary");

    if (success && rawSummary) {
      try {
        const summary: OAuthSummary = JSON.parse(decodeURIComponent(rawSummary));
        setOauthSummary(summary);
        setOauthStatus("success");
        setSelectedAccount(summary.accounts[0] ?? null);
        setOauthLogs([
          {
            label: "Step 1 — Generate OAuth URL",
            request: {
              method: "generateAuthUrl()",
              params: {
                access_type: "offline",
                scope: ["https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/datamanager"],
                prompt: "consent",
                state: summary.connectionId,
              },
            },
            response: { note: "Redirected user to Google consent screen", authUrl: "[Google OAuth URL — user approved]" },
          },
          {
            label: "Step 2 — Exchange code for tokens",
            request: { endpoint: "/api/google/callback", params: { code: "[auth_code from Google]", state: summary.connectionId } },
            response: { tokensReceived: summary.tokensReceived, note: "Tokens stored via setToken()" },
          },
          {
            label: "Step 3 — List accessible Google Ads accounts",
            request: summary.listAccountsRequest,
            response: summary.listAccountsResponse,
          },
        ]);
      } catch {
        setOauthStatus("error");
      }
      router.replace("/");
    } else if (error) {
      setOauthStatus("error");
      setOauthLogs([{
        label: "OAuth Error",
        request: { action: "Google OAuth callback" },
        response: { error: decodeURIComponent(error) },
      }]);
      router.replace("/");
    }
  }, [searchParams, router]);

  const handleOAuth = useCallback(async () => {
    setOauthStatus("loading");
    setOauthLogs([]);
    try {
      const res = await fetch(`/api/google/auth-url?connectionId=${connectionId}`);
      const data = await res.json();
      setOauthLogs([{ label: "Step 1 — Generate OAuth URL", request: data.request, response: data.response }]);
      setTimeout(() => { window.location.href = data.authUrl; }, 1000);
    } catch (err: any) {
      setOauthStatus("error");
      setOauthLogs([{ label: "Error", request: { endpoint: "/api/google/auth-url" }, response: { error: err.message } }]);
    }
  }, [connectionId]);

  const checkStatusOnce = useCallback(async (reqId: string): Promise<boolean> => {
    setCheckStatus("checking");
    try {
      const res = await fetch("/api/google/check-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: reqId, connectionId }),
      });
      const data = await res.json();

      setCheckLogs([{
        label: "RetrieveRequestStatus",
        request: data.request,
        response: data.response,
      }]);

      setCheckStatus(data.result.requestStatus);
      return data.result.isFinal;
    } catch (err: any) {
      setCheckStatus("idle");
      return false;
    }
  }, [connectionId]);

  const handleUpload = useCallback(async () => {
    if (!oauthSummary) return;
    setUploadStatus("loading");
    setUploadLogs([]);
    setCheckStatus("idle");
    setCheckLogs([]);
    setRequestId(null);
    try {
      const res = await fetch("/api/google/create-list-and-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
         customerId: selectedAccount ?? oauthSummary.accounts[0],
          workspaceName: "Zapdata Growth Workspace",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Upload failed");

      setUploadStatus("success");
      setUploadLogs([
        { label: "Step 1 — Create Audience List", request: data.steps.createList.request, response: data.steps.createList.response },
        { label: "Step 2 — Upload Hashed Phone Numbers", request: data.steps.uploadMembers.request, response: data.steps.uploadMembers.response },
      ]);

      // Get requestId and start checking status immediately
      const reqId = data.steps.uploadMembers.result.requestId;
      if (reqId) {
        setRequestId(reqId);

        // Immediately check status once
        const isFinal = await checkStatusOnce(reqId);

        // If not final, poll every 5 minutes
        if (!isFinal) {
          const interval = setInterval(async () => {
            const done = await checkStatusOnce(reqId);
            if (done) clearInterval(interval);
          }, 15 * 60 * 1000);
        }
      }
    } catch (err: any) {
      setUploadStatus("error");
      setUploadLogs([{ label: "Error", request: { endpoint: "/api/google/create-list-and-upload" }, response: { error: err.message } }]);
    }
  }, [connectionId, oauthSummary, checkStatusOnce,selectedAccount]);

  const isOAuthDone = oauthStatus === "success" && oauthSummary !== null;
  const isUploadBusy = uploadStatus === "loading" || checkStatus === "checking" || checkStatus === "PROCESSING";

  const divider = <hr style={{ border: "none", borderTop: "1px solid #eaecef", margin: "28px 0" }} />;

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto", padding: "32px 24px" }}>

      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
            <path d="M4 34L16 12L28 34H4Z" fill="#4285F4" />
            <circle cx="38" cy="34" r="8" fill="#34A853" />
            <path d="M20 34L32 12L44 34H20Z" fill="#FBBC05" opacity="0.9" />
          </svg>
          <h1 style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a" }}>
            Google Ads Customer Match — Demo
          </h1>
        </div>
        <p style={{ color: "#666", fontSize: "13px" }}>
          ZapPad Activation Studio 
        </p>
      </div>

      {/* Progress */}
      <div style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        marginBottom: "32px",
        padding: "12px 16px",
        background: "#f6f8fa",
        borderRadius: "8px",
        border: "1px solid #e1e4e8",
        fontSize: "13px",
      }}>
        {[
          { label: "1. Connect via OAuth", done: isOAuthDone },
          { label: "2. Create audience list", done: uploadStatus === "success" },
          { label: "3. Upload hashed phones", done: uploadStatus === "success" },
          { label: "4. Check status", done: checkStatus === "SUCCESS" || checkStatus === "PARTIAL_SUCCESS" },
        ].map((step, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {i > 0 && <span style={{ color: "#ccc" }}>›</span>}
            <span style={{
              color: step.done ? "#1a7f37" : "#666",
              fontWeight: step.done ? 500 : 400,
            }}>
              {step.done ? "✓ " : ""}{step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Button 1 */}
      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div>
            <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "2px" }}>Button 1 — Google OAuth</h2>
            <p style={{ color: "#666", fontSize: "13px" }}>Generates OAuth URL, redirects to Google, exchanges code for tokens, lists accounts.</p>
          </div>
          <StatusPill status={oauthStatus} />
        </div>

        <button
          onClick={handleOAuth}
          disabled={isOAuthDone || oauthStatus === "loading"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            background: isOAuthDone ? "#f6f8fa" : "#2563eb",
            color: isOAuthDone ? "#888" : "#fff",
            border: isOAuthDone ? "1px solid #e1e4e8" : "1px solid #1d4ed8",
            borderRadius: "6px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: isOAuthDone ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {oauthStatus === "loading" ? "Redirecting to Google..." : isOAuthDone ? `✓ Connected · ${selectedAccount ?? oauthSummary?.accounts[0]}` : "Connect Google Ads (OAuth)"}
        </button>

        {oauthLogs.length > 0 && (
          <div style={{ marginTop: "20px", padding: "16px", background: "#fff", border: "1px solid #e1e4e8", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "16px" }}>
              Request / Response Log — OAuth Flow
            </div>
            {oauthLogs.map((entry, i) => (
              <div key={i}>
                {i > 0 && <hr style={{ border: "none", borderTop: "1px solid #f1f3f5", margin: "16px 0" }} />}
                <LogEntry entry={entry} />
              </div>
            ))}
            {oauthSummary && (
              <div style={{ marginTop: "12px", padding: "12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "6px", fontSize: "12px" }}>
                <div style={{ fontWeight: 600, color: "#16a34a", marginBottom: "6px" }}>Tokens stored</div>
                {Object.entries(oauthSummary.tokensReceived).map(([k, v]) => (
                  <div key={k} style={{ color: "#444" }}>
                    <span style={{ color: "#888" }}>{k}:</span> <code style={{ fontFamily: "JetBrains Mono, monospace" }}>{String(v)}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      {isOAuthDone && oauthSummary && oauthSummary.accounts.length > 0 && (
  <div style={{ marginTop: "16px", padding: "12px 16px", background: "#f6f8fa", border: "1px solid #e1e4e8", borderRadius: "8px", display: "flex", alignItems: "center", gap: "12px", fontSize: "13px" }}>
    <span style={{ color: "#666", fontWeight: 500 }}>Google Ads account to use:</span>
    <select
      value={selectedAccount ?? ""}
      onChange={(e) => setSelectedAccount(e.target.value)}
      style={{
        padding: "5px 10px",
        borderRadius: "6px",
        border: "1px solid #e1e4e8",
        background: "#fff",
        fontSize: "13px",
        fontFamily: "inherit",
        color: "#1a1a1a",
        cursor: "pointer",
      }}
    >
      {oauthSummary.accounts.map((acc) => (
        <option key={acc} value={acc}>{acc}</option>
      ))}
    </select>
    <span style={{ color: "#888", fontSize: "12px" }}>Button 2 will create the list on this account</span>
  </div>
)}
      {divider}

      {/* Button 2 */}
      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div>
            <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "2px" }}>Button 2 — Create List & Upload Hashed CSV</h2>
            <p style={{ color: "#666", fontSize: "13px" }}>Creates Customer Match audience list, uploads 200 hashed phones, then checks upload status.</p>
          </div>
          <StatusPill status={uploadStatus} />
        </div>

        <button
          onClick={handleUpload}
          disabled={!isOAuthDone || isUploadBusy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            background: !isOAuthDone ? "#f6f8fa" :
              checkStatus === "SUCCESS" ? "#f0fdf4" :
              checkStatus === "FAILURE" ? "#ffeef0" :
              checkStatus === "PARTIAL_SUCCESS" ? "#fffbeb" :
              uploadStatus === "success" ? "#f0fdf4" :
              "#1a1a1a",
            color: !isOAuthDone ? "#aaa" :
              checkStatus === "SUCCESS" ? "#16a34a" :
              checkStatus === "FAILURE" ? "#cf222e" :
              checkStatus === "PARTIAL_SUCCESS" ? "#d97706" :
              uploadStatus === "success" ? "#16a34a" :
              "#fff",
            border: !isOAuthDone ? "1px solid #e1e4e8" :
              checkStatus === "SUCCESS" ? "1px solid #bbf7d0" :
              checkStatus === "FAILURE" ? "1px solid #fecaca" :
              checkStatus === "PARTIAL_SUCCESS" ? "1px solid #fde68a" :
              uploadStatus === "success" ? "1px solid #bbf7d0" :
              "1px solid #1a1a1a",
            borderRadius: "6px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: !isOAuthDone || isUploadBusy ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {checkStatus === "checking" ? "Checking status..." :
           checkStatus === "PROCESSING" ? "Processing... (checking every 5 mins)" :
           checkStatus === "SUCCESS" ? "✓ Upload Complete" :
           checkStatus === "FAILURE" ? "Upload Failed" :
           checkStatus === "PARTIAL_SUCCESS" ? "Partial Success" :
           uploadStatus === "loading" ? "Uploading..." :
           uploadStatus === "success" ? "✓ Upload complete" :
           "Create List & Upload Hashed Phones"}
        </button>

        {/* CSV info */}
        <div style={{ marginTop: "16px" }}>
          <div style={{ fontSize: "12px", color: "#888", marginBottom: "6px" }}>
            Hashed phones CSV — 1200 records · <code style={{ fontFamily: "monospace" }}>lib/hashed_phones.csv</code>
          </div>
          <pre style={{
            background: "#f6f8fa",
            border: "1px solid #e1e4e8",
            borderRadius: "6px",
            padding: "10px 12px",
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            color: "#555",
            lineHeight: "1.6",
          }}>
{`hashedPhone
4f1d964ba6d23d079ab21133bb5c783fdd183cbc53becab6e8bfc0722a795df3
0fb9b994f3725e91e6a65dd0ac5922131d4ca7aecdc3abd2bdaddfd1527e7d81
... (1200 records total)`}
          </pre>
        </div>

        {uploadLogs.length > 0 && (
          <div style={{ marginTop: "20px", padding: "16px", background: "#fff", border: "1px solid #e1e4e8", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "16px" }}>
              Request / Response Log — Data Manager API
            </div>
            {uploadLogs.map((entry, i) => (
              <div key={i}>
                {i > 0 && <hr style={{ border: "none", borderTop: "1px solid #f1f3f5", margin: "16px 0" }} />}
                <LogEntry entry={entry} />
              </div>
            ))}
          </div>
        )}

        {checkLogs.length > 0 && (
          <div style={{ marginTop: "16px", padding: "16px", background: "#fff", border: "1px solid #e1e4e8", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "16px" }}>
              Request / Response Log — RetrieveRequestStatus
            </div>
            {checkLogs.map((entry, i) => (
              <div key={i}>
                <LogEntry entry={entry} />
              </div>
            ))}
            <div style={{ marginTop: "12px", padding: "10px 12px", background: "#f6f8fa", borderRadius: "6px", fontSize: "12px", display: "flex", gap: "16px", alignItems: "center" }}>
              <div>
                <span style={{ color: "#888" }}>Status: </span>
                <span style={{
                  fontWeight: 600,
                  color: checkStatus === "SUCCESS" ? "#16a34a" :
                         checkStatus === "FAILURE" ? "#cf222e" :
                         checkStatus === "PARTIAL_SUCCESS" ? "#d97706" :
                         checkStatus === "PROCESSING" ? "#b45309" : "#666"
                }}>
                  {checkStatus.toUpperCase()}
                </span>
              </div>
              {requestId && (
                <div>
                  <span style={{ color: "#888" }}>requestId: </span>
                  <code style={{ fontFamily: "monospace", fontSize: "11px", color: "#444" }}>{requestId}</code>
                </div>
              )}
              {checkStatus === "PROCESSING" && (
                <div style={{ color: "#b45309", fontSize: "11px" }}>
                  ⟳ Next check in 5 minutes...
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {divider}

      {/* Gotchas */}
      <section>
        <details>
          <summary style={{ cursor: "pointer", fontSize: "13px", color: "#888", userSelect: "none" }}>
            API field gotchas (from production)
          </summary>
          <table style={{ marginTop: "12px", width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e4e8" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "#666", fontWeight: 500 }}>Field</th>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "#cf222e", fontWeight: 500 }}>❌ Wrong</th>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "#1a7f37", fontWeight: 500 }}>✅ Correct</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Phone field", "hashedPhoneNumber", "phoneNumber"],
                ["Consent value", "GRANTED", "CONSENT_GRANTED"],
                ["Encoding", "(missing)", '"HEX"'],
                ["Terms of service", "(missing)", "customerMatchTermsOfServiceStatus: ACCEPTED"],
                ["List ID", "full resource path", "numeric ID only — regex /(\\d+)$/"],
                ["Developer token", "in headers", "NOT needed for Data Manager API"],
              ].map(([field, wrong, correct]) => (
                <tr key={field} style={{ borderBottom: "1px solid #f1f3f5" }}>
                  <td style={{ padding: "6px 8px", color: "#444" }}>{field}</td>
                  <td style={{ padding: "6px 8px", color: "#cf222e", fontFamily: "JetBrains Mono, monospace" }}>{wrong}</td>
                  <td style={{ padding: "6px 8px", color: "#1a7f37", fontFamily: "JetBrains Mono, monospace" }}>{correct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <DemoContent />
    </Suspense>
  );
}