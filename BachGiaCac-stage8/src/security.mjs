import crypto from 'node:crypto';
import path from 'node:path';

export class SecurityError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'SecurityError'; this.status = status; }
}
export function decodeEncryptionKey(value) {
  if (!value) return null;
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32) return decoded;
  throw new SecurityError('PAGEOPS_ENCRYPTION_KEY phải là 64 ký tự hex hoặc base64 dài 32 byte.', 500);
}
export function encryptSecret(secret, key) {
  if (!secret) return '';
  if (!key || key.length !== 32) throw new SecurityError('Thiếu PAGEOPS_ENCRYPTION_KEY.', 500);
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(String(secret),'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join(':');
}
export function decryptSecret(value, key) {
  if (!value) return '';
  if (!key || key.length !== 32) throw new SecurityError('Thiếu PAGEOPS_ENCRYPTION_KEY.', 500);
  const p=String(value).split(':');
  if (p[0] !== 'v1' || p.length !== 4) throw new SecurityError('Dữ liệu bí mật không đúng định dạng.',500);
  try {
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(p[1],'base64url'));
    decipher.setAuthTag(Buffer.from(p[2],'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(p[3],'base64url')),decipher.final()]).toString('utf8');
  } catch { throw new SecurityError('Không thể giải mã dữ liệu bí mật.',500); }
}
export function safeName(name,fallback='upload.bin') {
  const cleaned=String(name||fallback).normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g,'_').replace(/\.{2,}/g,'.');
  return cleaned.slice(0,180)||fallback;
}
export function safeJoin(root,relativePath) {
  const base=path.resolve(root), candidate=path.resolve(base,String(relativePath||'')), rel=path.relative(base,candidate);
  if (rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)) throw new SecurityError('Đường dẫn không hợp lệ.',403);
  return candidate;
}
export function verifyPassword(candidate,expected) {
  if (!candidate||!expected) return false;
  const a=crypto.createHash('sha256').update(String(candidate)).digest();
  const b=crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a,b);
}
export function newSessionId(){return crypto.randomBytes(32).toString('base64url');}
export function parseCookies(header='') {
  return Object.fromEntries(String(header).split(';').map(part=>{const i=part.indexOf('=');return i<0?[part.trim(),'']:[part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1).trim())]}).filter(([k])=>k));
}
export function isSameOrigin(req,allowed){const o=req.headers.origin;if(!o||o==='null')return true;try{return allowed.has(new URL(o).origin);}catch{return false;}}
export function detectMediaKind(b) {
  if(b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image';
  if(b.length>=3&&b.subarray(0,3).equals(Buffer.from([255,216,255])))return'image';
  if(b.length>=6&&['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()))return'image';
  if(b.length>=12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return'image';
  if(b.length>=12&&b.subarray(4,8).toString()==='ftyp')return'video';
  if(b.length>=4&&b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return'video';
  return'unknown';
}
