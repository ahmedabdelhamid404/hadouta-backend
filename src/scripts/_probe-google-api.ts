// Quick probe: does Google AI Studio respond at all? Test with minimal call.
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

async function main(): Promise<void> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY not set");
  console.log(`API key present: ${apiKey.slice(0, 8)}...`);

  const ai = new GoogleGenAI({ apiKey });

  console.log(`\nTest 1: List models (lightweight call)`);
  try {
    const t0 = Date.now();
    const list = await ai.models.list();
    const ms = Date.now() - t0;
    console.log(`  ✓ list() succeeded in ${ms}ms`);
    console.log(`  Models count: ${(list as { length?: number }).length ?? "(unknown)"}`);
  } catch (err) {
    console.log(`  ✗ list() failed: ${(err as Error).message?.slice(0, 200)}`);
  }

  console.log(`\nTest 2: Text-only generateContent on gemini-2.5-flash (small)`);
  try {
    const t0 = Date.now();
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Reply with the single word: pong",
    });
    const ms = Date.now() - t0;
    console.log(`  ✓ Text gen succeeded in ${ms}ms`);
    console.log(`  Reply: ${r.text?.slice(0, 100) ?? "(no text)"}`);
  } catch (err) {
    console.log(`  ✗ Text gen failed: ${(err as Error).message?.slice(0, 200)}`);
  }

  console.log(`\nTest 3: Image gen on gemini-3.1-flash-image-preview (no input image)`);
  try {
    const t0 = Date.now();
    const r = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: "A simple watercolor painting of a red apple",
      config: { responseModalities: ["IMAGE"] },
    });
    const ms = Date.now() - t0;
    const candidates = r.candidates ?? [];
    let hasImage = false;
    for (const c of candidates) {
      for (const p of c.content?.parts ?? []) {
        if (p.inlineData?.data) hasImage = true;
      }
    }
    console.log(`  ${hasImage ? "✓" : "✗"} Image gen returned in ${ms}ms (image: ${hasImage})`);
  } catch (err) {
    console.log(`  ✗ Image gen failed: ${(err as Error).message?.slice(0, 200)}`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
