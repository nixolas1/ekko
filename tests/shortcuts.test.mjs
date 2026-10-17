import test from 'node:test';import assert from 'node:assert/strict';import {shortcutAction} from '../src/shortcuts.js';
test('music and fullscreen shortcuts respect editing, modifiers and native buttons',()=>{
 assert.equal(shortcutAction({code:'Space',key:' '},{tagName:'BUTTON'}),'music');
 assert.equal(shortcutAction({code:'Space',key:' '},{tagName:'INPUT',type:'range'}),'music');
 assert.equal(shortcutAction({code:'Space',key:' '},{tagName:'INPUT',type:'url'}),null);
 for(const modifier of ['metaKey','ctrlKey','altKey','shiftKey'])assert.equal(shortcutAction({key:'f',[modifier]:true}),null);
 assert.equal(shortcutAction({key:'f'}),'fullscreen');assert.equal(shortcutAction({code:'Enter',key:'Enter'}),'fullscreen');assert.equal(shortcutAction({code:'NumpadEnter',key:'Enter'}),'fullscreen');
 assert.equal(shortcutAction({code:'Enter',key:'Enter'},{tagName:'SUMMARY'}),null);
 assert.equal(shortcutAction({code:'Enter',key:'Enter'},{tagName:'BUTTON'}),null);assert.equal(shortcutAction({key:'f',repeat:true}),null);
});
