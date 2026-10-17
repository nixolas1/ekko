// Keep browser shortcuts and text entry intact. Space is safe on a range slider;
// Enter still activates a focused button for keyboard navigation.
export function shortcutAction(event,target={}){
 if(event.repeat||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||target.isContentEditable)return null;
 const tag=target.tagName;
 if(tag==='TEXTAREA'||tag==='SELECT'||(tag==='INPUT'&&target.type!=='range'))return null;
 const key=event.key?.toLowerCase();
 if(event.code==='Space'||key==='m')return 'music';
 if(key==='f'||((event.code==='Enter'||event.code==='NumpadEnter')&&!['BUTTON','SUMMARY'].includes(tag)))return 'fullscreen';
 if(key==='b')return 'burst';if(key==='h')return 'hide';if(key==='escape')return 'escape';
 return null;
}
