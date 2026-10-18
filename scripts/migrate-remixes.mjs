import {readFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL before running migrations.');
const sql=neon(process.env.DATABASE_URL);
const statements=(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean);
await sql.transaction(statements.map(statement=>sql.query(statement)));
console.log('Remix tables and indexes are ready.');
