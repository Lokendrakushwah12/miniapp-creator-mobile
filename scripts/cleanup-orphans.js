// Script to clean up orphaned database records
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env' });

const sql = postgres(process.env.DATABASE_URL);

async function cleanup() {
  try {
    console.log('🧹 Cleaning up orphaned data...');
    
    // Delete orphaned user_sessions
    const sessions = await sql`DELETE FROM user_sessions WHERE user_id NOT IN (SELECT id FROM users) RETURNING id`;
    console.log('Deleted orphaned sessions:', sessions.length);
    
    // Delete orphaned generation_jobs  
    try {
      const jobs = await sql`DELETE FROM generation_jobs WHERE user_id NOT IN (SELECT id FROM users) RETURNING id`;
      console.log('Deleted orphaned jobs:', jobs.length);
    } catch (e) { 
      console.log('generation_jobs cleanup skipped (table may not exist)'); 
    }
    
    // Delete orphaned projects
    try {
      const projects = await sql`DELETE FROM projects WHERE user_id NOT IN (SELECT id FROM users) RETURNING id`;
      console.log('Deleted orphaned projects:', projects.length);
    } catch (e) { 
      console.log('No orphaned projects to delete'); 
    }
    
    console.log('✅ Cleanup done! Run npm run db:migrate again');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

cleanup();



