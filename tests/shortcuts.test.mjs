import test from 'node:test';import assert from 'node:assert/strict';import {shortcutAction} from '../src/shortcuts.js';
test('music and fullscreen shortcuts respect editing, modifiers and native buttons',()=>{
 assert.equal(shortcutAction({code:'Space',key:' '},{tagName:'BUTTON'}),'music');
 assert.equal(shortcutAction({code:'Space',key:' '},{tagName:'INPUT',type:'range'}),'music');
 assert.equal(shortcutAction({code:'Space',key:' '},{tagName:'INPUT',type:'url'}),null);
 for(const modifier of ['metaKey','ctrlKey','altKey','shiftKey'])assert.equal(shortcutAction({key:'f',[modifier]:true}),null);
 assert.equal(shortcutAction({key:'f'}),'fullscreen');assert.equal(shortcutAction({code:'Enter',key:'Enter'}),'fullscreen');assert.equal(shortcutAction({code:'NumpadEnter',key:'Enter'}),'fullscreen');
 assert.equal(shortcutAction({code:'Enter',key:'Enter'},{tagName:'SUMMARY'}),null);
 assert.equal(shortcutAction({code:'Enter',key:'Enter'},{tagName:'BUTTON'}),null);assert.equal(shortcutAction({key:'f',repeat:true}),null);
 assert.equal(shortcutAction({key:'F'}),'fullscreen');assert.equal(shortcutAction({key:'f'},{tagName:'INPUT',type:'text'}),null);
 assert.equal(shortcutAction({key:'f'},{isContentEditable:true}),null);assert.equal(shortcutAction({code:'Enter',key:'Enter'},{tagName:'TEXTAREA'}),null);
});
test('M no longer toggles music; Space still does',()=>{
 for(const key of ['m','M'])assert.equal(shortcutAction({code:'KeyM',key}),null);
 assert.equal(shortcutAction({code:'KeyM',key:'M',shiftKey:true}),null);
 assert.equal(shortcutAction({code:'Space',key:' '}),'music');
});

test('N advances the visual mode without stealing text entry or browser shortcuts',()=>{
 assert.equal(shortcutAction({key:'n',code:'KeyN'}),'next-mode');
 assert.equal(shortcutAction({key:'N',code:'KeyN'}),'next-mode');
 for(const target of [{tagName:'INPUT',type:'text'},{tagName:'SELECT'},{tagName:'TEXTAREA'},{isContentEditable:true}])assert.equal(shortcutAction({key:'n'},target),null);
 assert.equal(shortcutAction({key:'n',metaKey:true}),null);assert.equal(shortcutAction({key:'n',repeat:true}),null);
});

test('hidden controls enable physical top-row keys and repeatable arrows only',()=>{
 const actions={Digit1:'palette-0',Digit2:'palette-1',Digit3:'palette-2',Digit4:'palette-3',Digit5:'palette-4',Digit6:'palette-5',Digit7:'palette-6',Period:'next-song',ArrowLeft:'force-down',ArrowRight:'force-up',ArrowDown:'particles-down',ArrowUp:'particles-up'};
 for(const [code,action] of Object.entries(actions)){
  assert.equal(shortcutAction({code},{},true),action);
  assert.equal(shortcutAction({code},{},false),null);
  assert.equal(shortcutAction({code,repeat:true},{},true),code.startsWith('Arrow')?action:null);
  for(const modifier of ['metaKey','ctrlKey','altKey','shiftKey'])assert.equal(shortcutAction({code,[modifier]:true},{},true),null);
  for(const target of [{tagName:'INPUT',type:'text'},{tagName:'SELECT'},{tagName:'TEXTAREA'},{isContentEditable:true}])assert.equal(shortcutAction({code},target,true),null);
 }
 for(const code of ['Digit0','Digit8','Digit9','NumpadDecimal'])assert.equal(shortcutAction({code},{},true),null);
 for(const [code,key] of [['Numpad1','1'],['Numpad2','2'],['Numpad3','3'],['Numpad4','ArrowLeft'],['Numpad6','ArrowRight'],['Numpad8','ArrowUp'],['Numpad2','ArrowDown']])assert.equal(shortcutAction({code,key,location:3},{},true),null);
});
