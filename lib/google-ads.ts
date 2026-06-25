
const DEFAULT_API_BASE = "https://datamanager.googleapis.com/v1";
const UPLOAD_BATCH_SIZE = 5000;

export type GoogleAdsOptions = {
  accessToken: string;
  customerId: string;
  workspaceName: string;
  timeoutMs?: number;
};

export type UserListResult = {
  userListId: string;
  userListName: string;
};

export type RequestLog = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

export type ResponseLog = {
  status: number;
  ok: boolean;
  body: unknown;
};

export class GoogleAdsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string | null,
    public readonly requestId: string | null
  ) {
    super(message);
    this.name = "GoogleAdsApiError";
  }
}

function normalizeCustomerId(id: string): string {
  return id.replace(/-/g, "").trim();
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export async function fetchDataManager(
  options: GoogleAdsOptions,
  url: string,
  body: unknown
): Promise<{ request: RequestLog; response: ResponseLog; payload: unknown }> {
  const timeoutMs = Math.max(5000, options.timeoutMs ?? 30_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
  };

  const request: RequestLog = {
    url,
    method: "POST",
    headers: { ...headers, Authorization: "Bearer <redacted>" },
    body,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text.slice(0, 500) };
    }

    const response: ResponseLog = { status: res.status, ok: res.ok, body: payload };

    if (!res.ok) {
      const err = (payload as any)?.error ?? {};
      throw new GoogleAdsApiError(
        (strOrNull(err.message) ?? res.statusText ?? "Data Manager API error") +
          " | details: " + JSON.stringify(err.details ?? payload),
        res.status,
        strOrNull(err.code ?? err.status),
        strOrNull(err.requestId ?? (payload as any)?.requestId)
      );
    }

    return { request, response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createUserList(options: GoogleAdsOptions): Promise<{
  result: UserListResult;
  request: RequestLog;
  response: ResponseLog;
}> {
  const customerId = normalizeCustomerId(options.customerId);
  const displayName = `ZapData - ${options.workspaceName} - ${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19)}`;

  const url = `${DEFAULT_API_BASE}/accountTypes/GOOGLE_ADS/accounts/${customerId}/userLists`;

  const body = {
    displayName,
    description: "Customer Match audience created by ZapData Jarvis activation",
    membershipStatus: "OPEN",
    membershipDuration: "7776000s",
    ingestedUserListInfo: {
      uploadKeyTypes: ["CONTACT_ID"],
      contactIdInfo: {
        dataSourceType: "DATA_SOURCE_TYPE_FIRST_PARTY",
      },
    },
  };

  const { request, response, payload } = await fetchDataManager(options, url, body);

  const rawName = strOrNull((payload as any).name) ?? strOrNull((payload as any).id) ?? "";
  const match = rawName.match(/(\d+)$/);
  const userListId = match ? match[1] : rawName;

  return { result: { userListId, userListName: displayName }, request, response };
}

export async function uploadMembers(
  options: GoogleAdsOptions,
  userListId: string,
  hashedPhones: string[]
): Promise<{
  totalUploaded: number;
  totalFailed: number;
  batches: Array<{ request: RequestLog; response: ResponseLog }>;
}> {
  const url = `${DEFAULT_API_BASE}/audienceMembers:ingest`;
  const customerId = normalizeCustomerId(options.customerId);

  let totalUploaded = 0;
  let totalFailed = 0;
  const batches: Array<{ request: RequestLog; response: ResponseLog }> = [];

  for (const batch of chunkArray(hashedPhones, UPLOAD_BATCH_SIZE)) {
    const audienceMembers = batch.map((hashedPhone) => ({
      userData: {
        userIdentifiers: [{ phoneNumber: hashedPhone }],
      },
    }));

    const body = {
      destinations: [
        {
          operatingAccount: {
            product: "GOOGLE_ADS",
            accountId: customerId,
          },
          productDestinationId: userListId,
        },
      ],
      audienceMembers,
      consent: {
        adUserData: "CONSENT_GRANTED",
        adPersonalization: "CONSENT_GRANTED",
      },
      termsOfService: {
        customerMatchTermsOfServiceStatus: "ACCEPTED",
      },
      encoding: "HEX",
    };

    const { request, response, payload } = await fetchDataManager(options, url, body);

    totalUploaded += numOrNull((payload as any).receivedAudienceMemberCount) ?? batch.length;
    totalFailed += numOrNull((payload as any).failedAudienceMemberCount) ?? 0;
    batches.push({ request, response });
  }

  return { totalUploaded, totalFailed, batches };
}
