import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const demoPassword = process.env.SEED_DEMO_PASSWORD || "ChangeMe123!";
const adminEmail = (process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD || "";

try {
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  await prisma.user.upsert({
    where: { email: "demo@toolaime.local" },
    update: {},
    create: {
      name: "ToolAiMe Demo",
      email: "demo@toolaime.local",
      passwordHash,
      projects: {
        create: {
          title: "រឿងកូនកំលោះក្នុងភូមិ",
          topic: "រឿងខ្លីអំពីការជួយគ្នានៅក្នុងភូមិ",
          language: "km",
          durationMinutes: 1,
          script: "នៅព្រឹកមួយ ក្នុងភូមិតូចមួយ ក្មេងប្រុសម្នាក់បានឃើញអ្នកជិតខាងត្រូវការជំនួយ...",
        },
      },
    },
  });

  if (adminEmail && adminPassword) {
    const adminPasswordHash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { name: "ToolAiMe Admin", passwordHash: adminPasswordHash },
      create: {
        name: "ToolAiMe Admin",
        email: adminEmail,
        passwordHash: adminPasswordHash,
      },
    });
  }
} finally {
  await prisma.$disconnect();
}
