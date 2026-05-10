// One-shot: upload src/assets/style-references/watercolor-anchor.jpg to
// Cloudinary and print the resulting URL. Set the URL as
// STATIC_WATERCOLOR_ANCHOR_URL env var locally + on Railway production.
//
// Why a one-shot script: the asset is immutable (Beatrix Potter 1902 PD plate),
// so we upload it ONCE manually and pin the URL. Avoids runtime file-read
// (which breaks on Railway because src/assets/ isn't shipped to the runtime
// container) and the cold-start upload latency of doing this lazily.
//
// Run: pnpm tsx src/scripts/_upload_static_watercolor.ts

import "dotenv/config";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { uploadImage, isCloudinaryConfigured } from "../lib/cloudinary.js";

const ASSET_PATH = path.resolve(
  process.cwd(),
  "src/assets/style-references/watercolor-anchor.jpg",
);

async function main(): Promise<void> {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary not configured — set CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET in .env",
    );
  }

  console.log(`Uploading static watercolor anchor from: ${ASSET_PATH}`);
  const buf = await fs.readFile(ASSET_PATH);
  console.log(`  read ${(buf.length / 1024).toFixed(0)}KB`);

  const uploaded = await uploadImage(
    buf,
    "_static_assets",
    "style-reference/watercolor-anchor",
    "image/jpeg",
  );

  console.log(`\n✓ Uploaded successfully.\n`);
  console.log(`URL:        ${uploaded.url}`);
  console.log(`public_id:  ${uploaded.publicId}`);
  console.log(`bytes:      ${uploaded.fileSize}`);
  console.log(`\n📋 Set this in your env (locally + on Railway):`);
  console.log(`\n   STATIC_WATERCOLOR_ANCHOR_URL=${uploaded.url}\n`);
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exit(1); })
  .then(() => process.exit(0));
