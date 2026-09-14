import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {encryptSecret,decryptSecret,safeJoin,safeName,detectMediaKind,verifyPassword} from '../src/security.mjs';
test('mã hóa AES-GCM',()=>{const k=crypto.randomBytes(32),e=encryptSecret('bi-mat',k);assert.equal(decryptSecret(e,k),'bi-mat');assert.throws(()=>decryptSecret(e,crypto.randomBytes(32)));});
test('chặn đường dẫn thoát thư mục',()=>{const r=path.resolve('/tmp/media');assert.equal(safeJoin(r,'a.png'),path.join(r,'a.png'));assert.throws(()=>safeJoin(r,'../secret'));assert.throws(()=>safeJoin(r,'/etc/passwd'));});
test('làm sạch tên và nhận diện file',()=>{assert.equal(safeName('../anh nguy hiem.png'),'._anh_nguy_hiem.png');assert.equal(detectMediaKind(Buffer.from([137,80,78,71,13,10,26,10])),'image');assert.equal(detectMediaKind(Buffer.from('x')),'unknown');});
test('kiểm tra mật khẩu',()=>{assert.equal(verifyPassword('mat-khau','mat-khau'),true);assert.equal(verifyPassword('sai','mat-khau'),false);});
