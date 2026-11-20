import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
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
} finally {
  await prisma.$disconnect();
}
