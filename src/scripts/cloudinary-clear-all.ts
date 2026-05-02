// Wipe all Cloudinary resources from the configured account.
// DESTRUCTIVE — use only on a dev/test account or to clear leftover test data
// before launch.
//
// Run from hadouta-backend root:
//   pnpm tsx src/scripts/cloudinary-clear-all.ts

import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.error(
    "❌ Missing CLOUDINARY_* env vars. Set them in hadouta-backend/.env",
  );
  process.exit(1);
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

interface UsageBlock {
  usage?: number;
}
interface UsageResponse {
  storage?: UsageBlock;
}

async function getStorageBytes(): Promise<number> {
  const usage = (await cloudinary.api.usage()) as UsageResponse;
  return usage.storage?.usage ?? 0;
}

async function deleteAllOfType(
  resourceType: "image" | "raw" | "video",
): Promise<number> {
  let totalDeleted = 0;
  let nextCursor: string | undefined;

  while (true) {
    const list = (await cloudinary.api.resources({
      resource_type: resourceType,
      max_results: 500,
      next_cursor: nextCursor,
    })) as { resources: Array<{ public_id: string }>; next_cursor?: string };

    if (list.resources.length === 0) break;

    const publicIds = list.resources.map((r) => r.public_id);
    const result = (await cloudinary.api.delete_resources(publicIds, {
      resource_type: resourceType,
    })) as { deleted: Record<string, string> };

    const deletedNow = Object.values(result.deleted).filter(
      (s) => s === "deleted",
    ).length;
    totalDeleted += deletedNow;
    console.log(`   batch: ${deletedNow}/${publicIds.length} ${resourceType}(s) deleted`);

    nextCursor = list.next_cursor;
    if (!nextCursor) break;
  }

  // Also delete empty folders that remain after asset deletion
  try {
    const folders = (await cloudinary.api.root_folders()) as {
      folders: Array<{ name: string; path: string }>;
    };
    for (const f of folders.folders) {
      try {
        await cloudinary.api.delete_folder(f.path);
        console.log(`   folder removed: ${f.path}`);
      } catch {
        // Non-empty or already gone — ignore
      }
    }
  } catch {
    // root_folders may 404 on free accounts — ignore
  }

  return totalDeleted;
}

async function main() {
  console.log(`→ Cloud: ${cloudName}`);
  const before = await getStorageBytes();
  console.log(
    `→ Storage before: ${before} bytes (${(before / 1048576).toFixed(2)} MB)`,
  );
  console.log("");

  let total = 0;
  for (const type of ["image", "raw", "video"] as const) {
    console.log(`→ Deleting all ${type} resources...`);
    const deleted = await deleteAllOfType(type);
    console.log(`   total ${type}: ${deleted}`);
    total += deleted;
  }

  // Wait briefly for usage to update
  await new Promise((r) => setTimeout(r, 2000));
  const after = await getStorageBytes();
  console.log("");
  console.log(
    `→ Storage after:  ${after} bytes (${(after / 1048576).toFixed(2)} MB)`,
  );
  console.log(`→ Total deleted: ${total} resources`);

  if (after === 0) {
    console.log("");
    console.log("✅ Account is empty.");
  } else if (after < before) {
    console.log("");
    console.log(
      "ℹ️  Storage reduced but not zero — Cloudinary CDN may take a minute to fully reflect.",
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
