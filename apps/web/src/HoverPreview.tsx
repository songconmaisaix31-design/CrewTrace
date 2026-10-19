import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';

export default function HoverPreview({children,preview,onClick,className='text-button',hint,label,dialogOpen,silent=false,active=false,interactive=false}:{children:ReactNode;preview:ReactNode;onClick:()=>void;className?:string;hint?:string;label?:string;dialogOpen?:boolean;silent?:boolean;active?:boolean;interactive?:boolean}){
  const {t}=useI18n();
  const id=useId(), trigger=useRef<HTMLButtonElement>(null), panel=useRef<HTMLDivElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [open,setOpen]=useState(false),[closing,setClosing]=useState(false),[position,setPosition]=useState<{left:number;top:number;maxHeight?:number}>({left:0,top:0});
  function cancel(){clearTimeout(timer.current);setClosing(false);}
  function close(){cancel();setOpen(false);}
  function reveal(){cancel();timer.current=setTimeout(()=>{window.dispatchEvent(new CustomEvent('crewtrace:preview',{detail:id}));setOpen(true);},250);}
  function leave(){cancel();timer.current=setTimeout(()=>{setClosing(true);timer.current=setTimeout(()=>{setOpen(false);setClosing(false);},140);},200);}
  useEffect(()=>{
    const dismiss=()=>{clearTimeout(timer.current);setOpen(false);};
    const other=(event:Event)=>{if((event as CustomEvent).detail!==id)dismiss();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(interactive&&panel.current?.contains(document.activeElement))trigger.current?.focus();dismiss();}};
    const wheel=(event:WheelEvent)=>{if(!interactive||!panel.current?.contains(event.target as Node))dismiss();};
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node))dismiss();};
    window.addEventListener('crewtrace:preview',other);window.addEventListener('keydown',key);window.addEventListener('resize',dismiss);window.addEventListener('wheel',wheel,{passive:true});window.addEventListener('pointerdown',outside);
    return()=>{clearTimeout(timer.current);window.removeEventListener('crewtrace:preview',other);window.removeEventListener('keydown',key);window.removeEventListener('resize',dismiss);window.removeEventListener('wheel',wheel);window.removeEventListener('pointerdown',outside);};
  },[id,interactive]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const anchor=trigger.current!.getBoundingClientRect(), box=panel.current!.getBoundingClientRect();
      const height=Math.min(panel.current!.scrollHeight+2,innerHeight-32);
      const below=innerHeight-anchor.bottom-26,above=anchor.top-26;
      const left=Math.max(16,Math.min(anchor.left+(anchor.width-box.width)/2,innerWidth-box.width-16));
      if(height<=below)setPosition({left,top:anchor.bottom+10,maxHeight:below});
      else if(height<=above)setPosition({left,top:anchor.top-height-10,maxHeight:above});
      else if(anchor.right+box.width+26<=innerWidth)setPosition({left:anchor.right+10,top:Math.max(16,Math.min(anchor.top,innerHeight-height-16)),maxHeight:innerHeight-32});
      else if(anchor.left>=box.width+26)setPosition({left:anchor.left-box.width-10,top:Math.max(16,Math.min(anchor.top,innerHeight-height-16)),maxHeight:innerHeight-32});
      else if(below>=above)setPosition({left,top:anchor.bottom+10,maxHeight:Math.max(0,below)});
      else setPosition({left,top:16,maxHeight:Math.max(0,above)});
    };
    const observer=new ResizeObserver(place);observer.observe(panel.current!);place();
    return()=>observer.disconnect();
  },[open,preview]);
  return <>
    <button type="button" ref={trigger} className={className} aria-label={label} aria-haspopup={dialogOpen===undefined?undefined:'dialog'} aria-expanded={interactive?Boolean(dialogOpen||open):dialogOpen} aria-controls={interactive&&open?id:undefined} data-sound-toggle={silent||undefined} data-active={active||undefined} aria-describedby={open&&!interactive?id:undefined}
      onPointerEnter={event=>{if(event.pointerType==='mouse')reveal();}} onPointerLeave={leave}
      onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))reveal();}}
      onKeyDown={event=>{if(interactive&&open&&event.key==='Tab'&&!event.shiftKey){const first=panel.current?.querySelector<HTMLElement>('button,input,a');if(first){event.preventDefault();first.focus();}}}}
      onBlur={event=>{if(!panel.current?.contains(event.relatedTarget as Node))leave();}}
      onClick={()=>{close();onClick();}}>{children}</button>
    {open&&createPortal(<div ref={panel} id={id} role={interactive?'region':'tooltip'} aria-label={interactive?label:undefined} className={`hover-preview${interactive?' interactive-preview':''}`} data-closing={closing} style={position}
      onPointerEnter={cancel} onPointerLeave={()=>{if(!interactive||!panel.current?.querySelector(':focus-visible'))leave();}}
      onFocusCapture={cancel} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))leave();}}>
      <div className="hover-preview-content">{preview}</div><small>{hint??t('点击入口查看完整内容','Click the entry to open full details')}</small>
    </div>,document.body)}
  </>;
}
