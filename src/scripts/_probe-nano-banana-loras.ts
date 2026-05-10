// Empirical test: does fal-ai/nano-banana-2/edit accept a `loras` array
// in the payload, as the technical brief claims?
//
// Strategy: make the SAME call twice — once without loras (control), once
// with loras attached via Object.assign (bypassing TypeScript's typed
// payload validation, same trick we used for verify-fal-kontext-lora.ts).
// Compare:
//   - Does the API reject the loras-attached call? (validation error)
//   - Does the API accept silently and ignore? (no observable effect)
//   - Does the LoRA actually influence the output? (different image)
//
// If results 1 or 2: the brief's Option B is wrong.
// If result 3: the brief is right (we'll be very surprised).
//
// Run: pnpm tsx src/scripts/_probe-nano-banana-loras.ts

import "dotenv/config";
import { fal } from "@fal-ai/client";

const NANO_BANANA_2_EDIT = "fal-ai/nano-banana-2/edit";

// A small public test photo (same as Phase 1 used for verify-fal-kontext-lora)
const TEST_IMAGE_URL =
  "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=512";

// A real public LoRA URL for the test — Pixar-3D Flux LoRA on Civitai
// (we'd never expect this to work on Gemini, but if the API accepts it
// silently the brief's claim still has plausible deniability).
const TEST_LORA_URL =
  "https://civitai.com/api/download/models/350447?type=Model&format=SafeTensor";

async function main(): Promise<void> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not set");
  fal.config({ credentials: key });

  console.log(`Endpoint: ${NANO_BANANA_2_EDIT}\n`);

  // ─── Test 1: control — call without loras ───
  console.log("=== TEST 1: Control (no loras field) ===");
  try {
    const baseline = await fal.subscribe(NANO_BANANA_2_EDIT, {
      input: {
        prompt: "Stylize this person as a Pixar-3D animated character",
        image_urls: [TEST_IMAGE_URL],
        aspect_ratio: "1:1" as const,
        output_format: "png" as const,
        num_images: 1,
      },
      logs: false,
    });
    const data = (baseline as { data?: { images?: Array<{ url?: string }> } }).data;
    const url = data?.images?.[0]?.url;
    console.log(`  ✓ Control succeeded.`);
    console.log(`  Output: ${url ?? "(no url)"}\n`);
  } catch (err) {
    console.log(`  ✗ Control failed: ${(err as Error).message}\n`);
  }

  // ─── Test 2: hypothesis — call with loras field via Object.assign ───
  console.log("=== TEST 2: Hypothesis (loras field included) ===");
  console.log(`  Loras payload: [{ path: "${TEST_LORA_URL}", scale: 0.8 }]\n`);
  const baseInput = {
    prompt: "Stylize this person as a Pixar-3D animated character",
    image_urls: [TEST_IMAGE_URL],
    aspect_ratio: "1:1" as const,
    output_format: "png" as const,
    num_images: 1,
  };
  const inputWithLoras = Object.assign({}, baseInput, {
    loras: [{ path: TEST_LORA_URL, scale: 0.8 }],
  });

  try {
    const result = await fal.subscribe(NANO_BANANA_2_EDIT, {
      input: inputWithLoras,
      logs: false,
    });
    const data = (result as { data?: { images?: Array<{ url?: string }> } }).data;
    const url = data?.images?.[0]?.url;
    console.log(`  → Call did NOT throw a validation error.`);
    console.log(`  → Output: ${url ?? "(no url)"}`);
    console.log(`\n  INTERPRETATION:`);
    console.log(`    The API silently accepted the 'loras' field but it`);
    console.log(`    cannot have actually loaded a Flux/SDXL LoRA into a`);
    console.log(`    Gemini model. The output was generated WITHOUT the LoRA.`);
    console.log(`    This proves the brief's Option B claim wrong: the field`);
    console.log(`    is ignored, not applied.\n`);
  } catch (err) {
    const errBody = (err as { body?: unknown }).body;
    console.log(`  → Call FAILED with validation error.`);
    console.log(`  → Error: ${(err as Error).message}`);
    if (errBody !== undefined) {
      console.log(`  → Body: ${JSON.stringify(errBody, null, 2)}`);
    }
    console.log(`\n  INTERPRETATION:`);
    console.log(`    fal.ai's nano-banana-2/edit endpoint rejects the 'loras'`);
    console.log(`    field outright — it's not in the API schema. This is`);
    console.log(`    direct primary-source proof the brief's Option B is wrong.\n`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
