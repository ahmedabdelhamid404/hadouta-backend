// Reset / upsert the ai_settings singleton row to current dev-mode defaults.
// Per ADR-020 + session 9.5 (Ahmed picked OpenAI for dev, Google direct for
// illustrations — has credits/Pro account; switching to Claude in prod later).
//
// Idempotent. Run anytime to reset to current dev defaults:
//   pnpm db:seed:ai-settings

import "dotenv/config";
import { db } from "../db";
import { aiSettings } from "../db/schema";

const DEV_DEFAULTS = {
  id: "singleton",
  storyModel: "gpt-4o-mini",
  storyMaxTokens: 4000,
  illustrationModel: "gemini-2.5-flash-image",
  illustrationCount: 8,
  maxRetries: 1,
  allowIllustrationFallback: true,
  autoApproveThreshold: null,
};

async function seed() {
  await db
    .insert(aiSettings)
    .values(DEV_DEFAULTS)
    .onConflictDoUpdate({
      target: aiSettings.id,
      set: {
        storyModel: DEV_DEFAULTS.storyModel,
        storyMaxTokens: DEV_DEFAULTS.storyMaxTokens,
        illustrationModel: DEV_DEFAULTS.illustrationModel,
        illustrationCount: DEV_DEFAULTS.illustrationCount,
        maxRetries: DEV_DEFAULTS.maxRetries,
        allowIllustrationFallback: DEV_DEFAULTS.allowIllustrationFallback,
        autoApproveThreshold: DEV_DEFAULTS.autoApproveThreshold,
        updatedAt: new Date(),
      },
    });

  console.log("Seeded ai_settings singleton with dev-mode defaults:");
  console.log(JSON.stringify(DEV_DEFAULTS, null, 2));
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
