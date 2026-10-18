import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { LanguageSwitch, useI18n } from './i18n';

export default function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const {t}=useI18n();
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const before=document.activeElement as HTMLElement;
    const dialog=ref.current;dialog?.showModal();
    return()=>{dialog?.close();before?.focus();};
  },[]);
  return <dialog ref={ref} className="drawer public-dialog centered-dialog" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{
    if(event.target!==event.currentTarget)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();
  }}><div className="drawer-head"><h2>{title}</h2><LanguageSwitch/><button className="icon-button" aria-label={t('关闭详情','Close dialog')} onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
