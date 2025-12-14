-- Custom migration to add missing enum values
ALTER TYPE "public"."connection_action" ADD VALUE IF NOT EXISTS 'OWNER_APPROVE';
ALTER TYPE "public"."connection_action" ADD VALUE IF NOT EXISTS 'OWNER_DENY';
