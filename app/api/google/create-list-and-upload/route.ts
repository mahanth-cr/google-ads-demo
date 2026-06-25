import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "@/lib/token-store";
import { createUserList, uploadMembers } from "@/lib/google-ads";

function loadHashedPhones(): string[] {
  const csvPath = path.join(process.cwd(), "lib/hashed_phones.csv");
  const content = fs.readFileSync(csvPath, "utf-8");
  return content
    .split("\n")
    .slice(1)                     // skip header "hashedPhone"
    .map(line => line.trim())     // trim whitespace
    .filter(Boolean) as string[]; // remove empty lines
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
 const connectionId = body.connectionId as string;

if (!connectionId) {
  return NextResponse.json(
    { error: "No connection ID provided." },
    { status: 400 }
  );
}
  const customerId = (body.customerId as string) ?? "";
  const workspaceName = (body.workspaceName as string) ?? "Zapdata Growth Workspace";

  if (!customerId) {
    return NextResponse.json(
      { error: "No customer ID provided. Please select a Google Ads account first." },
      { status: 400 }
    );
  }

  const accessToken = getToken(`google-ads-${connectionId}-access-token`);

  if (!accessToken) {
    return NextResponse.json(
      {
        error: "No access token found. Please complete OAuth first.",
        tip: "Click the 'Connect Google Ads (OAuth)' button first.",
      },
      { status: 401 }
    );
  }
  const hashedPhones = loadHashedPhones();
  const options = { accessToken, customerId, workspaceName };

  try {
    // Step 1: Create audience list
    const {
      result: userList,
      request: createRequest,
      response: createResponse,
    } = await createUserList(options);

    // Step 2: Upload hashed phones
    const {
      totalUploaded,
      totalFailed,
      batches,
    } = await uploadMembers(options, userList.userListId, hashedPhones);

    return NextResponse.json({
      success: true,
      steps: {
        createList: {
          request: createRequest,
          response: createResponse,
          result: userList,
        },
        uploadMembers: {
     request: batches[0]?.request ?? null,
     response: batches[0]?.response ?? null,
     result: {
     totalUploaded,
     totalFailed,
     status: totalFailed === 0 ? "SUCCESS" : "PARTIAL_FAILURE",
     totalRecords: hashedPhones.length,
     totalBatches: batches.length,
     requestId: (batches[0]?.response?.body as any)?.requestId ?? null,
  },
},
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message ?? "Unknown error",
        details: err.statusCode
          ? {
              httpStatus: err.statusCode,
              code: err.code,
              requestId: err.requestId,
            }
          : undefined,
      },
      { status: 500 }
    );
  }
}
