import {validateDocument,DEFAULT_CODE} from './schema.js';
const KEY='ekko:remix:drafts:v1',KEYS='ekko:remix:keys:v1';
export function drafts(storage=localStorage){try{return JSON.parse(storage.getItem(KEY)||'[]');}catch{return [];}}
export function saveDraft(draft,storage=localStorage){
 const item={...draft,document:{...validateDocument({...draft.document,code:DEFAULT_CODE}),code:String(draft.document.code).slice(0,12000)},updatedAt:new Date().toISOString()};
 const items=drafts(storage).filter(d=>d.localId!==item.localId);items.unshift(item);
 storage.setItem(KEY,JSON.stringify(items.slice(0,30)));return item;
}
export function deleteDraft(id,storage=localStorage){storage.setItem(KEY,JSON.stringify(drafts(storage).filter(d=>d.localId!==id)));}
export function keys(storage=localStorage){try{return JSON.parse(storage.getItem(KEYS)||'{}');}catch{return {};}}
export function saveKey(id,key,storage=localStorage){if(!/^[\w-]{43}$/.test(key))throw new Error('Invalid editing key.');storage.setItem(KEYS,JSON.stringify({...keys(storage),[id]:key}));}
