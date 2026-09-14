import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {Storage} from '../src/storage.mjs';
test('SQLite lưu và đọc lại dữ liệu',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'pageops-')),s=new Storage(path.join(d,'pageops.sqlite'),crypto.randomBytes(32)),now=new Date().toISOString(),state={groups:[{id:'g',name:'Nhom',color:'#123456'}],pages:[{id:'p',name:'Page',pageId:'1',groupId:'g',token:'secret',tasks:[]}],contents:[{id:'c',title:'Bai',caption:'Noi dung',mediaName:'',mediaType:'text',groupIds:['g'],pageIds:['p'],scheduledAt:'',status:'draft',createdAt:now}],logs:[]};s.replaceState(state);const out=s.loadState();assert.equal(out.pages[0].token,'secret');assert.equal(out.contents[0].pageIds[0],'p');s.close();fs.rmSync(d,{recursive:true,force:true});});
