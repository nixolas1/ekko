// Keep browser shortcuts and text entry intact. Space is safe on a range slider;
// Enter still activates a focused button for keyboard navigation. Space alone toggles music.
export function shortcutAction(event,target={},controlsHidden=false){
 if(event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||target.isContentEditable)return null;
 const tag=target.tagName;
 if(tag==='TEXTAREA'||tag==='SELECT'||(tag==='INPUT'&&target.type!=='range'))return null;
 if(controlsHidden&&event.location!==3){
  const adjustment={ArrowLeft:'force-down',ArrowRight:'force-up',ArrowDown:'particles-down',ArrowUp:'particles-up'}[event.code];
  if(adjustment)return adjustment;
  if(!event.repeat){
   if(/^Digit[1-7]$/.test(event.code))return `palette-${Number(event.code.slice(-1))-1}`;
   if(event.code==='Period')return 'next-song';
  }
 }
 if(event.repeat)return null;
 const key=event.key?.toLowerCase();
 if(event.code==='Space')return 'music';
 if(key==='f'||((event.code==='Enter'||event.code==='NumpadEnter')&&!['BUTTON','SUMMARY'].includes(tag)))return 'fullscreen';
 if(key==='n')return 'next-mode';
 if(key==='b')return 'burst';if(key==='h')return 'hide';if(key==='escape')return 'escape';
 return null;
}
