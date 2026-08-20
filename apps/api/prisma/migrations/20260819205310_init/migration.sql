-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('AZURE_OPENAI', 'OPENAI', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'ROTATED');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('DAILY', 'MONTHLY');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "litellmOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "litellmUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "litellmTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "secretRef" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "litellmCredentialName" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "publicModelName" TEXT NOT NULL,
    "providerModelName" TEXT NOT NULL,
    "litellmModelName" TEXT NOT NULL,
    "litellmModelId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "providerModelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayKeyReference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "keyAlias" TEXT NOT NULL,
    "litellmKeyId" TEXT NOT NULL,
    "keyPrefix" TEXT,
    "status" "KeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayKeyReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "maxBudget" DECIMAL(12,4) NOT NULL,
    "period" "BudgetPeriod" NOT NULL,
    "rpmLimit" INTEGER,
    "tpmLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_litellmOrgId_key" ON "Organization"("litellmOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_litellmUserId_key" ON "Membership"("litellmUserId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_litellmTeamId_key" ON "Team"("litellmTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_slug_key" ON "Team"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_litellmCredentialName_key" ON "Provider"("litellmCredentialName");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_organizationId_name_key" ON "Provider"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderModel_litellmModelName_key" ON "ProviderModel"("litellmModelName");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderModel_litellmModelId_key" ON "ProviderModel"("litellmModelId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderModel_providerId_publicModelName_key" ON "ProviderModel"("providerId", "publicModelName");

-- CreateIndex
CREATE INDEX "ModelAccess_organizationId_idx" ON "ModelAccess"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelAccess_userId_teamId_providerModelId_key" ON "ModelAccess"("userId", "teamId", "providerModelId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayKeyReference_keyAlias_key" ON "GatewayKeyReference"("keyAlias");

-- CreateIndex
CREATE INDEX "GatewayKeyReference_organizationId_status_idx" ON "GatewayKeyReference"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_organizationId_userId_teamId_key" ON "Budget"("organizationId", "userId", "teamId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderModel" ADD CONSTRAINT "ProviderModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAccess" ADD CONSTRAINT "ModelAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAccess" ADD CONSTRAINT "ModelAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAccess" ADD CONSTRAINT "ModelAccess_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAccess" ADD CONSTRAINT "ModelAccess_providerModelId_fkey" FOREIGN KEY ("providerModelId") REFERENCES "ProviderModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayKeyReference" ADD CONSTRAINT "GatewayKeyReference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayKeyReference" ADD CONSTRAINT "GatewayKeyReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayKeyReference" ADD CONSTRAINT "GatewayKeyReference_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
