// hadouta-backend/src/scripts/verify-fal-kontext-lora.ts
//
// One-off script: ping fal-ai/flux-pro/kontext/multi with a `loras` parameter
// to confirm the endpoint accepts LoRA loading. Prints the response.
//
// Run: pnpm tsx src/scripts/verify-fal-kontext-lora.ts
//
// Expected outcomes:
//   - Image returned with no parameter-rejected error → LoRA support confirmed
//   - Error mentioning unknown parameter `loras` → fall back to prompt-only Pixar
//   - Image returned but unchanged from no-LoRA baseline → silent no-op (treat as no support)

import "dotenv/config";
import { fal } from "@fal-ai/client";

const KONTEXT_MULTI = "fal-ai/flux-pro/kontext/multi";

// A free-licensed test LoRA URL on Hugging Face (replace with chosen Pixar LoRA
// URL once Task 1 picks one — for de-risk this just probes API parameter shape).
const TEST_LORA_URL =
  "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors";

// A simple test reference image (public, CDN-stable). Confirmed reachable
// during de-risk; if it ever 404s, swap in any other public 2xx image URL.
const TEST_IMAGE_URL =
  "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=512";

async function main(): Promise<void> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not set in .env");
  fal.config({ credentials: key });

  console.log("Probing", KONTEXT_MULTI, "with `loras` param...");

  try {
    const result = await fal.subscribe(KONTEXT_MULTI, {
      input: {
        prompt: "a smiling dog in 3d pixar animated style",
        image_urls: [TEST_IMAGE_URL],
        loras: [{ path: TEST_LORA_URL, scale: 0.8 }],
        aspect_ratio: "1:1",
        output_format: "png",
        num_images: 1,
      },
      logs: false,
    });
    const data = (result as { data?: { images?: Array<{ url?: string }> } })
      .data;
    const imageUrl = data?.images?.[0]?.url ?? null;
    if (imageUrl) {
      console.log("✅ Kontext-Multi accepted `loras` param.");
      console.log("   Output image:", imageUrl);
      console.log(
        "   Verify visually that the image differs from a no-LoRA call.",
      );
    } else {
      console.log("⚠️  No image in response — inspect:");
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.error("❌ Kontext-Multi rejected the request.");
    console.error(err);
    const errBody = (err as { body?: unknown }).body;
    if (errBody !== undefined) {
      console.error("Full error body:");
      console.error(JSON.stringify(errBody, null, 2));
    }
    console.error(
      "\nFall back to prompt-only Pixar styling per spec §4.5 Fallback A.",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
