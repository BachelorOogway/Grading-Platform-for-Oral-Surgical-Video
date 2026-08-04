import { PrismaClient } from "@prisma/client";

// 避免在开发环境下重复创建 PrismaClient（Next 热更新会多次触发 module 重载）
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

