-- The development-only demo provider. The API registers its adapter only when
-- ENABLE_MOCK_PROVIDER is set, which boot refuses in production.
ALTER TYPE "ProviderType" ADD VALUE 'MOCK';
