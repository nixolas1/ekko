import {neon} from '@neondatabase/serverless';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function neonStore(connection){
 const sql=neon(connection);
 const publicRow=row=>row&&({id:row.id,parentId:row.parent_id,parentRevision:row.parent_revision,revision:row.revision,visibility:row.visibility,document:row.document,thumbnail:row.thumbnail,createdAt:row.created_at,updatedAt:row.updated_at});
 return {
  async rateLimit(ip){
   const bucket=hash(connection+'|'+ip);
   const counts=await sql`INSERT INTO ekko_remix_limits (bucket,hour) VALUES (${bucket},date_trunc('hour',now())), ('global',date_trunc('hour',now())) ON CONFLICT (bucket,hour) DO UPDATE SET requests=ekko_remix_limits.requests+1 RETURNING bucket,requests`;
   if(Math.random()<.02)await sql`DELETE FROM ekko_remix_limits WHERE hour < now()-interval '2 days'`;
   return counts.every(r=>r.requests<=(r.bucket==='global'?500:60));
  },
  async list(offset=0){
   const rows=await sql`SELECT id,parent_id,parent_revision,revision,visibility,document-'code' AS document,thumbnail,created_at,updated_at FROM ekko_remixes WHERE visibility='public' ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ${offset}`;
   return {items:rows.slice(0,24).map(publicRow),next:rows.length>24?offset+24:null};
  },
  async get(id,revision){
   const [row]=await sql`SELECT id,parent_id,parent_revision,revision,visibility,document,thumbnail,created_at,updated_at FROM ekko_remixes WHERE id=${id}`;
   if(!row)return null;
   if(revision){const [r]=await sql`SELECT document,revision,created_at FROM ekko_remix_revisions WHERE remix_id=${id} AND revision=${revision}`;if(!r)return null;Object.assign(row,r);}
   return publicRow(row);
  },
  async history(id){return sql`SELECT revision,created_at AS "createdAt",document->>'title' AS title FROM ekko_remix_revisions WHERE remix_id=${id} ORDER BY revision DESC LIMIT 100`;},
  async create({document,thumbnail,visibility,parentId,parentRevision}){
   const id=randomUUID(),editKey=randomBytes(32).toString('base64url'),editHash=hash(editKey);
   const result=await sql.transaction([
    sql`INSERT INTO ekko_remixes (id,edit_hash,parent_id,parent_revision,visibility,document,thumbnail) VALUES (${id},${editHash},${parentId},${parentRevision},${visibility},${JSON.stringify(document)}::jsonb,${thumbnail}) RETURNING id,parent_id,parent_revision,revision,visibility,document,thumbnail,created_at,updated_at`,
    sql`INSERT INTO ekko_remix_revisions (remix_id,revision,document) VALUES (${id},1,${JSON.stringify(document)}::jsonb)`,
   ]);
   return {...publicRow(result[0][0]),editKey};
  },
  async update(id,key,{document,thumbnail,visibility,expectedRevision}){
   // The conditional UPDATE is the ownership/concurrency gate. Its CTE creates
   // the immutable revision in the same statement, preventing partial saves.
   const rows=await sql`WITH changed AS (
    UPDATE ekko_remixes SET document=${JSON.stringify(document)}::jsonb,thumbnail=${thumbnail},visibility=${visibility},revision=revision+1,updated_at=now()
    WHERE id=${id} AND edit_hash=${hash(key)} AND revision=${expectedRevision} AND revision<100
    RETURNING *
   ), saved AS (
    INSERT INTO ekko_remix_revisions (remix_id,revision,document) SELECT id,revision,document FROM changed RETURNING remix_id
   ) SELECT id,parent_id,parent_revision,revision,visibility,document,thumbnail,created_at,updated_at FROM changed`;
   if(rows.length)return {item:publicRow(rows[0])};
   const [state]=await sql`SELECT revision FROM ekko_remixes WHERE id=${id} AND edit_hash=${hash(key)}`;
   return {error:state?'conflict':'forbidden'};
  }
 };
}
