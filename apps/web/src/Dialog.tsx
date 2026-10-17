import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const before=document.activeElement as HTMLElement;
    const dialog=ref.current;dialog?.showModal();
    return()=>{dialog?.close();before?.focus();};
  },[]);
  return <dialog ref={ref} className="drawer public-dialog" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{
    if(event.target!==event.currentTarget)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();
  }}><div className="drawer-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
