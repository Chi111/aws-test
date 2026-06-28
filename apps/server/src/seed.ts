import { db } from "@github-profile-sam/db";
import { adminUsers } from "@github-profile-sam/db/schema";
import { createPasswordHash, type Role } from "./auth";

const users: Array<{ email: string; name: string; role: Role; password: string }> = [
  { email: "admin@example.com", name: "Admin", role: "admin", password: "Admin123!" },
  { email: "operator@example.com", name: "Operator", role: "operator", password: "Operator123!" },
  { email: "viewer@example.com", name: "Viewer", role: "viewer", password: "Viewer123!" }
];

for (const user of users) {
  await db
    .insert(adminUsers)
    .values({
      email: user.email,
      name: user.name,
      role: user.role,
      passwordHash: await createPasswordHash(user.password)
    })
    .onConflictDoUpdate({
      target: adminUsers.email,
      set: {
        name: user.name,
        role: user.role,
        passwordHash: await createPasswordHash(user.password)
      }
    });
}

console.log(`Seeded ${users.length} admin users.`);
