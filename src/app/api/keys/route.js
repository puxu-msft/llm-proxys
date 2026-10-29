import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getApiKeyByKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { validateCustomApiKey } from "@/shared/utils/apiKey";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - 创建密钥（可传 key 存手工值，允许弱值；不传则生成）
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, key } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let customKey = null;
    if (key !== undefined && key !== null && String(key).trim() !== "") {
      const checked = validateCustomApiKey(key);
      if (!checked.ok) {
        return NextResponse.json({ error: checked.error }, { status: 400 });
      }
      if (await getApiKeyByKey(checked.value)) {
        return NextResponse.json({ error: "This key value already exists" }, { status: 409 });
      }
      customKey = checked.value;
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, { key: customKey });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
