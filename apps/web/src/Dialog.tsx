import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from './i18n';

export default function Dialog({title,children,onClose,variant='default'}:{title:string;children:ReactNode;onClose:()=>void;variant?:'default'|'identity'|'create'|'mcp'}){
  const {t}=useI18n();
  const ref=useRef<HTMLDialogElement>(null);
  const [closing,setClosing]=useState(false);
  const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  function dismiss(){
    if(closeTimer.current!==null)return;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}
    setClosing(true);closeTimer.current=setTimeout(onClose,140);
  }
  useEffect(()=>{
    const before=document.activeElement as HTMLElement;
    const dialog=ref.current;dialog?.showModal();
    return()=>{if(closeTimer.current!==null)clearTimeout(closeTimer.current);dialog?.close();before?.focus();};
  },[]);
  return <dialog ref={ref} className="drawer public-dialog centered-dialog" data-variant={variant} data-closing={closing} aria-label={title} onCancel={event=>{event.preventDefault();dismiss();}} onClick={event=>{
    if(event.target!==event.currentTarget)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dismiss();
  }}><div className="drawer-head"><h2>{title}</h2><button className="icon-button" aria-label={t('关闭详情','Close dialog')} onClick={dismiss}><X size={20}/></button></div>{children}</dialog>;
}
