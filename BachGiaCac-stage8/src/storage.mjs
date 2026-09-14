import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decryptSecret, encryptSecret, SecurityError } from './security.mjs';

const EMPTY={groups:[],pages:[],contents:[],logs:[]};
const parse=(v,f)=>{try{return v?JSON.parse(v):f}catch{return f}};
export class Storage {
  constructor(file,key){
    this.file=file;this.key=key;fs.mkdirSync(path.dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS pages(id TEXT PRIMARY KEY,name TEXT NOT NULL,page_id TEXT NOT NULL DEFAULT "",group_id TEXT NOT NULL DEFAULT "",token_enc TEXT NOT NULL DEFAULT "",tasks_json TEXT NOT NULL DEFAULT "[]",description TEXT NOT NULL DEFAULT "",settings_json TEXT NOT NULL DEFAULT "{}");',
      'CREATE TABLE IF NOT EXISTS contents(id TEXT PRIMARY KEY,title TEXT NOT NULL,caption TEXT NOT NULL DEFAULT "",media_name TEXT NOT NULL DEFAULT "",media_type TEXT NOT NULL,scheduled_at TEXT NOT NULL DEFAULT "",status TEXT NOT NULL,created_at TEXT NOT NULL,last_run_at TEXT);',
      'CREATE TABLE IF NOT EXISTS content_groups(content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,group_id TEXT NOT NULL,PRIMARY KEY(content_id,group_id));',
      'CREATE TABLE IF NOT EXISTS content_pages(content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,page_id TEXT NOT NULL,PRIMARY KEY(content_id,page_id));',
      'CREATE TABLE IF NOT EXISTS logs(id TEXT PRIMARY KEY,content_id TEXT NOT NULL,created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS log_results(id INTEGER PRIMARY KEY AUTOINCREMENT,log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,page_id TEXT NOT NULL,page_name TEXT NOT NULL,status TEXT NOT NULL,message TEXT NOT NULL DEFAULT "",response_json TEXT NOT NULL DEFAULT "{}");'
    ].join('\n'));
  }
  close(){this.db.close();}
  hasRows(){return Number(this.db.prepare('SELECT COUNT(*) count FROM pages').get().count)+Number(this.db.prepare('SELECT COUNT(*) count FROM contents').get().count)>0;}
  loadState(){
    const groups=this.db.prepare('SELECT id,name,color FROM groups ORDER BY rowid').all();
    const pages=this.db.prepare('SELECT id,name,page_id,group_id,token_enc,tasks_json,description,settings_json FROM pages ORDER BY rowid').all().map(p=>({id:p.id,name:p.name,pageId:p.page_id,groupId:p.group_id,token:p.token_enc?decryptSecret(p.token_enc,this.key):'',tasks:parse(p.tasks_json,[]),description:p.description,settings:parse(p.settings_json,{})}));
    const contents=this.db.prepare('SELECT * FROM contents ORDER BY rowid DESC').all().map(c=>({id:c.id,title:c.title,caption:c.caption,mediaName:c.media_name,mediaType:c.media_type,groupIds:this.db.prepare('SELECT group_id FROM content_groups WHERE content_id=? ORDER BY rowid').all(c.id).map(x=>x.group_id),pageIds:this.db.prepare('SELECT page_id FROM content_pages WHERE content_id=? ORDER BY rowid').all(c.id).map(x=>x.page_id),scheduledAt:c.scheduled_at,status:c.status,createdAt:c.created_at,...(c.last_run_at?{lastRunAt:c.last_run_at}:{})}));
    const logs=this.db.prepare('SELECT id,content_id,created_at FROM logs ORDER BY rowid DESC').all().map(l=>({id:l.id,contentId:l.content_id,createdAt:l.created_at,results:this.db.prepare('SELECT page_id,page_name,status,message,response_json FROM log_results WHERE log_id=? ORDER BY id').all(l.id).map(r=>({pageId:r.page_id,pageName:r.page_name,status:r.status,...(r.message?{message:r.message}:{}),response:parse(r.response_json,{})}))}));
    return{groups,pages,contents,logs};
  }
  replaceState(s=EMPTY){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.exec('DELETE FROM log_results;DELETE FROM logs;DELETE FROM content_pages;DELETE FROM content_groups;DELETE FROM contents;DELETE FROM pages;DELETE FROM groups;');
      const gi=this.db.prepare('INSERT INTO groups VALUES(?,?,?)'),pi=this.db.prepare('INSERT INTO pages VALUES(?,?,?,?,?,?,?,?)'),ci=this.db.prepare('INSERT INTO contents VALUES(?,?,?,?,?,?,?,?,?)'),gl=this.db.prepare('INSERT OR IGNORE INTO content_groups VALUES(?,?)'),pl=this.db.prepare('INSERT OR IGNORE INTO content_pages VALUES(?,?)'),li=this.db.prepare('INSERT INTO logs VALUES(?,?,?)'),ri=this.db.prepare('INSERT INTO log_results(log_id,page_id,page_name,status,message,response_json) VALUES(?,?,?,?,?,?)');
      for(const g of s.groups||[])gi.run(String(g.id),String(g.name||''),String(g.color||'#7c5cff'));
      for(const p of s.pages||[])pi.run(String(p.id),String(p.name||''),String(p.pageId||''),String(p.groupId||''),p.token?encryptSecret(p.token,this.key):'',JSON.stringify(p.tasks||[]),String(p.description||''),JSON.stringify(p.settings||{}));
      for(const c of s.contents||[]){ci.run(String(c.id),String(c.title||''),String(c.caption||''),String(c.mediaName||''),String(c.mediaType||'text'),String(c.scheduledAt||''),String(c.status||'draft'),String(c.createdAt||new Date().toISOString()),c.lastRunAt?String(c.lastRunAt):null);for(const g of c.groupIds||[])gl.run(String(c.id),String(g));for(const p of c.pageIds||[])pl.run(String(c.id),String(p));}
      for(const l of s.logs||[]){li.run(String(l.id),String(l.contentId||''),String(l.createdAt||new Date().toISOString()));for(const r of l.results||[])ri.run(String(l.id),String(r.pageId||''),String(r.pageName||''),String(r.status||'failed'),String(r.message||''),JSON.stringify(r.response||{}));}
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  async migrateLegacy(file){
    if(this.hasRows()||!fs.existsSync(file))return false;
    let legacy;try{legacy=JSON.parse(await fsp.readFile(file,'utf8'));}catch(e){throw new SecurityError('Không thể đọc dữ liệu cũ: '+e.message,500);}
    this.replaceState({...EMPTY,...legacy});await fsp.rm(file,{force:true});return true;
  }
}
