-- Migration: Remove Privy, migrate to Farcaster authentication
-- This migration renames privy_user_id to farcaster_fid and adds username column

-- Step 1: Add new username column if it doesn't exist
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;

-- Step 2: Rename privy_user_id column to farcaster_fid
ALTER TABLE "users" RENAME COLUMN "privy_user_id" TO "farcaster_fid";

-- Step 3: Drop the old unique constraint and create a new one
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_privy_user_id_unique";
ALTER TABLE "users" ADD CONSTRAINT "users_farcaster_fid_unique" UNIQUE ("farcaster_fid");

-- Step 4: Drop the email column as Farcaster doesn't use email
ALTER TABLE "users" DROP COLUMN IF EXISTS "email";

