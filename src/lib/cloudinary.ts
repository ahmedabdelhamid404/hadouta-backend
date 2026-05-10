// Cloudinary SDK wrapper — Phase 5 Task 1.9 photo storage.
// Configured via CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET.
// Free tier: 25 GB storage + 25 GB bandwidth/month.

import { v2 as cloudinaryV2 } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (cloudName && apiKey && apiSecret) {
  cloudinaryV2.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

export function isCloudinaryConfigured(): boolean {
  return !!(cloudName && apiKey && apiSecret);
}

export interface CloudinaryUploadResult {
  publicId: string;
  url: string;
  contentType: string;
  fileSize: number;
}

/**
 * Upload an image buffer to Cloudinary under hadouta/orders/<orderId>/.
 * Cloudinary auto-handles thumbnail generation (via URL params at view time)
 * and format conversion (HEIC → JPEG/WebP) — no client-side preprocessing needed.
 */
export async function uploadImage(
  buffer: Buffer,
  orderId: string,
  ownerType: string,
  contentType: string,
): Promise<CloudinaryUploadResult> {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary not configured — set CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET",
    );
  }

  // Use upload_stream so we can pipe a Buffer in directly
  const result = await new Promise<{
    public_id: string;
    secure_url: string;
    bytes: number;
    format: string;
  }>((resolve, reject) => {
    const stream = cloudinaryV2.uploader.upload_stream(
      {
        folder: `hadouta/orders/${orderId}/${ownerType}`,
        resource_type: "image",
        // Strip EXIF (privacy + smaller file)
        quality_analysis: false,
        // Don't auto-rename if same public_id used
        unique_filename: true,
        use_filename: false,
      },
      (error, uploaded) => {
        if (error || !uploaded) {
          if (error) {
            // Preserve http_code from Cloudinary SDK error so categorizeError()
            // in callers can match by status code (e.g. 401 auth, 413 too-large,
            // 420 rate-limit) without parsing the message string.
            const httpCode = (error as { http_code?: number }).http_code;
            const wrapped = new Error(error.message ?? "Cloudinary upload error") as Error & { http_code?: number };
            if (httpCode != null) wrapped.http_code = httpCode;
            reject(wrapped);
          } else {
            reject(new Error("Cloudinary upload returned no result"));
          }
          return;
        }
        resolve({
          public_id: uploaded.public_id,
          secure_url: uploaded.secure_url,
          bytes: uploaded.bytes,
          format: uploaded.format,
        });
      },
    );
    stream.end(buffer);
  });

  return {
    publicId: result.public_id,
    url: result.secure_url,
    contentType: `image/${result.format}`,
    fileSize: result.bytes,
  };
}

/**
 * Delete an image from Cloudinary by public_id.
 * Used when parent removes a photo from the wizard before submitting.
 */
export async function deleteImage(publicId: string): Promise<void> {
  if (!isCloudinaryConfigured()) return;
  await cloudinaryV2.uploader.destroy(publicId, { resource_type: "image" });
}
