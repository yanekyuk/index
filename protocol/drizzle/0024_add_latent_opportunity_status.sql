-- Add latent value to opportunity_status enum (draft opportunities)
ALTER TYPE "public"."opportunity_status" ADD VALUE IF NOT EXISTS 'latent' BEFORE 'pending';
