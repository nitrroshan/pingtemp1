import { Pool } from 'pg';

// Configure the database connection
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/mydb',
});