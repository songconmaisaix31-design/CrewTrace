import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';

export default function HoverPreview({children,preview,onClick,className='text-button'}:{children:ReactNode;preview:ReactNode;onClick:()=>void;className?:string}){
  const {t}=useI18n();
  const id=useId(), trigger=useRef<HTMLButtonElement>(null), panel=useRef<HTMLDivElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [open,setOpen]=useState(false),[closing,setClosing]=useState(false),[position,setPosition]=useState({left:0,top:0});
  function cancel(){clearTimeout(timer.current);setClosing(false);}
  function close(){cancel();setOpen(false);}
  function reveal(){cancel();timer.current=setTimeout(()=>{window.dispatchEvent(new CustomEvent('crewtrace:preview',{detail:id}));setOpen(true);},250);}
  function leave(){cancel();timer.current=setTimeout(()=>{setClosing(true);timer.current=setTimeout(()=>{setOpen(false);setClosing(false);},140);},200);}
  useEffect(()=>{
    const dismiss=()=>{clearTimeout(timer.current);setOpen(false);};
    const other=(event:Event)=>{if((event as CustomEvent).detail!==id)dismiss();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')dismiss();};
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node))dismiss();};
    window.addEventListener('crewtrace:preview',other);window.addEventListener('keydown',key);window.addEventListener('resize',dismiss);window.addEventListener('wheel',dismiss,{passive:true});window.addEventListener('pointerdown',outside);
    return()=>{clearTimeout(timer.current);window.removeEventListener('crewtrace:preview',other);window.removeEventListener('keydown',key);window.removeEventListener('resize',dismiss);window.removeEventListener('wheel',dismiss);window.removeEventListener('pointerdown',outside);};
  },[id]);
  useLayoutEffect(()=>{
    if(!open)return;
    const anchor=trigger.current!.getBoundingClientRect(), box=panel.current!.getBoundingClientRect();
    setPosition({left:Math.max(16,Math.min(anchor.left,innerWidth-box.width-16)),top:anchor.bottom+box.height+12<innerHeight?anchor.bottom+10:Math.max(16,anchor.top-box.height-10)});
  },[open,preview]);
  return <><button ref={trigger} className={className} aria-describedby={open?id:undefined} onPointerEnter={event=>{if(event.pointerType==='mouse')reveal();}} onPointerLeave={leave} onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))reveal();}} onBlur={leave} onClick={()=>{close();onClick();}}>{children}</button>{open&&createPortal(<div ref={panel} id={id} role="tooltip" className="hover-preview" data-closing={closing} style={position} onPointerEnter={cancel} onPointerLeave={leave}><div className="hover-preview-content">{preview}</div><small>{t('点击入口查看完整内容','Click the entry to open full details')}</small></div>,document.body)}</>;
}
