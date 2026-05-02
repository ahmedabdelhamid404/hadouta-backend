// Seed the system's super-admin account.
// Per Ahmed's directive (session 9.8): no signup for admins. The system
// starts with one seeded admin (Ahmed), who then invites other admins by
// email. Default invite password is "1234" with must_change_password=true.
//
// Idempotent — re-running won't duplicate or reset Ahmed's password.
//
// Usage:
//   pnpm db:seed:admin
//
// Override defaults via env:
//   ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... ADMIN_SEED_NAME=... pnpm db:seed:admin

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";
import { auth } from "../auth/index.js";

const SEED = {
  email: process.env.ADMIN_SEED_EMAIL ?? "ahmed41997@gmail.com",
  password: process.env.ADMIN_SEED_PASSWORD ?? "A7med@hadouta",
  name: process.env.ADMIN_SEED_NAME ?? "Ahmed Mohamed",
};

async function main() {
  console.log(`Seeding super-admin: ${SEED.email}`);

  const existing = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.email, SEED.email))
    .limit(1);

  if (existing[0]) {
    // Just ensure role + must_change_password are correct. Don't touch password.
    if (existing[0].role !== "admin") {
      await db
        .update(user)
        .set({ role: "admin", mustChangePassword: false })
        .where(eq(user.id, existing[0].id));
      console.log(
        `  → existing user ${existing[0].id} promoted to role='admin'`,
      );
    } else {
      await db
        .update(user)
        .set({ mustChangePassword: false })
        .where(eq(user.id, existing[0].id));
      console.log(`  → already admin (id=${existing[0].id}); flag refreshed`);
    }
    process.exit(0);
  }

  // New user — sign up via Better-Auth so password is hashed correctly + an
  // account row is created. signUpEmail returns the new user.
  const signUpResult = await auth.api.signUpEmail({
    body: {
      email: SEED.email,
      password: SEED.password,
      name: SEED.name,
    },
  });

  if (!signUpResult.user?.id) {
    throw new Error(
      `Better-Auth signUpEmail did not return a user. Result: ${JSON.stringify(signUpResult)}`,
    );
  }

  // Promote to admin (role is input:false, so signUp leaves it as 'customer').
  await db
    .update(user)
    .set({ role: "admin", mustChangePassword: false })
    .where(eq(user.id, signUpResult.user.id));

  console.log(`  ✓ Created admin user id=${signUpResult.user.id}`);
  console.log(`    email: ${SEED.email}`);
  console.log(`    role: admin`);
  console.log(`    must_change_password: false`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:");
  console.error(err);
  process.exit(1);
});
