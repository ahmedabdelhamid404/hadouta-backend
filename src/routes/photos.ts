// Wizard photo upload + delete endpoints — Phase 5 Task 1.9.
// Multipart upload to Cloudinary; persists URL to photos table.

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { photos } from "../db/schema.js";
import {
  uploadImage,
  deleteImage,
  isCloudinaryConfigured,
} from "../lib/cloudinary.js";

const photosRouter = new Hono();

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  // Cloudinary auto-handles HEIC conversion server-side, but iOS Safari
  // sends "image/heic" or "image/heif" as the type — accept both.
  "image/heic",
  "image/heif",
]);

// POST /api/photos/upload?orderId=...&ownerType=main_child[&ownerCharacterId=...]
photosRouter.post("/upload", async (c) => {
  if (!isCloudinaryConfigured()) {
    return c.json(
      {
        error:
          "Photo upload backend not configured. Set CLOUDINARY_* env vars.",
      },
      503,
    );
  }

  const orderId = c.req.query("orderId");
  const ownerType = c.req.query("ownerType") ?? "main_child";
  const ownerCharacterId = c.req.query("ownerCharacterId") ?? null;

  if (!orderId) return c.json({ error: "orderId query param required" }, 400);
  if (!["main_child", "supporting_character"].includes(ownerType)) {
    return c.json({ error: "ownerType must be main_child or supporting_character" }, 400);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Multipart body required" }, 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "field 'file' required (multipart/form-data)" }, 400);
  }

  if (file.size > MAX_FILE_BYTES) {
    return c.json(
      { error: `File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)` },
      413,
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return c.json(
      {
        error: `Unsupported file type: ${file.type}. Allowed: JPEG, PNG, WebP, HEIC.`,
      },
      415,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let upload;
  try {
    upload = await uploadImage(buffer, orderId, ownerType, file.type);
  } catch (err) {
    console.error("[photos] Cloudinary upload failed:", err);
    return c.json(
      {
        error:
          err instanceof Error
            ? `Upload failed: ${err.message}`
            : "Upload failed",
      },
      502,
    );
  }

  const inserted = await db
    .insert(photos)
    .values({
      orderId,
      ownerType,
      ownerCharacterId,
      url: upload.url,
      contentType: upload.contentType,
      fileSize: upload.fileSize,
    })
    .returning({ id: photos.id });

  if (!inserted[0]) {
    return c.json({ error: "DB insert returned no row" }, 500);
  }

  return c.json(
    {
      photoId: inserted[0].id,
      url: upload.url,
      // Cloudinary public_id is also worth returning so caller can build
      // transformed URLs (thumbnails, format-converted variants) later.
      publicId: upload.publicId,
    },
    201,
  );
});

// DELETE /api/photos/:id — remove from Cloudinary + DB
photosRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Fetch URL so we can extract Cloudinary public_id for deletion
  const photo = await db
    .select()
    .from(photos)
    .where(eq(photos.id, id))
    .limit(1);

  if (photo.length === 0) {
    return c.json({ error: "Photo not found" }, 404);
  }

  // Cloudinary URLs look like:
  //   https://res.cloudinary.com/<cloud>/image/upload/v<version>/<public_id>.<format>
  // public_id is everything after "/upload/v<version>/" and before the format extension.
  const url = photo[0]!.url;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)\.[a-z]+$/i);
  const publicId = match?.[1];

  if (publicId) {
    try {
      await deleteImage(publicId);
    } catch (err) {
      // Log but don't fail the DB delete — orphaned Cloudinary objects can
      // be reaped by a periodic cleanup job (Sprint 2+).
      console.warn(
        `[photos] Cloudinary delete failed for ${publicId}, removing DB row anyway:`,
        err,
      );
    }
  }

  await db.delete(photos).where(eq(photos.id, id));
  return c.json({ ok: true });
});

export { photosRouter };
