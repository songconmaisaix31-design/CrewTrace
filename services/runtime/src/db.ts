import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export interface SQL {query<T extends Record<string,any>=Record<string,any>>(sql:string,args?:unknown[]):Promise<{rows:T[]}>}
export class Database implements SQL {
  private readonly pg?:Pool;
  private readonly embedded?:PGlite;
  constructor(url:string){
    if(url.startsWith('pglite://'))this.embedded=new PGlite(url.slice('pglite://'.length)||undefined);
    else this.pg=new Pool({connectionString:url,max:5,connectionTimeoutMillis:10000,statement_timeout:20000});
  }
  async query<T extends Record<string,any>=Record<string,any>>(sql:string,args:unknown[]=[]):Promise<{rows:T[]}>{
    if(this.embedded)return this.embedded.query<T>(sql,args);
    return this.pg!.query<T>(sql,args);
  }
  async transaction<T>(fn:(db:SQL)=>Promise<T>):Promise<T>{
    if(this.embedded)return this.embedded.transaction(tx=>fn(tx));
    const client=await this.pg!.connect();
    try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
  }
  async migrate(){
    const sql=await readFile(new URL('../migrations/001_commerce.sql',import.meta.url),'utf8');
    if(this.embedded)await this.embedded.exec(`BEGIN; ${sql} COMMIT;`);
    else await this.transaction(async db=>{await db.query(sql);});
  }
  async close(){if(this.embedded)await this.embedded.close();else await this.pg!.end();}
}
