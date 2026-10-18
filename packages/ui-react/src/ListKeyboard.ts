import type {KeyboardEvent} from 'react';
export function focusListItem(event:KeyboardEvent<HTMLElement>){
 const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
 const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
 const next=event.key==='ArrowDown'?Math.min(current+1,buttons.length-1):event.key==='ArrowUp'?Math.max(current-1,0):event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;
 if(next>=0){event.preventDefault();buttons[next]?.focus();}
}
