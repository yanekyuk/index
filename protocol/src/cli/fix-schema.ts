import dotenv from 'dotenv';
import path from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

// Force load env
const envPath = path.resolve(__dirname, '../../.env.development');
dotenv.config({ path: envPath });

async function fixSchema() {
  console.log('🔧 Starting Manual Schema Fix (Direct Client)...');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing');
  }

  // Force explicit connection params
  const url = new URL(process.env.DATABASE_URL);
  console.log(`Host: ${url.hostname}, Port: ${url.port}`);

  const client = postgres(process.env.DATABASE_URL, {
    prepare: false,
    onnotice: () => { }, // silence notices
    max: 1
  });

  const db = drizzle(client);

  try {
    console.log('Testing connectivity...');
    const res = await client`SELECT 1 as v`;
    console.log(`Connectivity OK: ${res[0].v}`);

    // 1. Ensure Vector Extension
    console.log('Checking vector extension...');
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
    console.log('✅ Extension "vector" ensured.');

    // 2. Add embedding column
    console.log('Adding "embedding" column...');
    await db.execute(sql`
            ALTER TABLE "user_profiles" 
            ADD COLUMN IF NOT EXISTS "embedding" vector(2000);
        `);
    // Add index for embedding
    await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "user_profiles_embedding_idx" 
            ON "user_profiles" 
            USING hnsw ("embedding" vector_cosine_ops);
        `);
    console.log('✅ Column "embedding" and index ensured.');

    // 3. Add hyde_description column
    console.log('Adding "hyde_description" column...');
    await db.execute(sql`
            ALTER TABLE "user_profiles" 
            ADD COLUMN IF NOT EXISTS "hyde_description" text;
        `);
    console.log('✅ Column "hyde_description" ensured.');

    // 4. Add hyde_embedding column
    console.log('Adding "hyde_embedding" column...');
    await db.execute(sql`
            ALTER TABLE "user_profiles" 
            ADD COLUMN IF NOT EXISTS "hyde_embedding" vector(2000);
        `);
    // Add index for hyde_embedding
    await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "user_profiles_hyde_embedding_idx" 
            ON "user_profiles" 
            USING hnsw ("hyde_embedding" vector_cosine_ops);
        `);
    console.log('✅ Column "hyde_embedding" and index ensured.');

    console.log('🎉 Schema fix completed successfully.');

  } catch (error) {
    console.error('❌ Schema fix failed:', error);
  } finally {
    await client.end();
  }
}

fixSchema().catch(console.error);
