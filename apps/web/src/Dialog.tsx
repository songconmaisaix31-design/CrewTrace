import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from './i18n';

export default function Dialog({title,children,onClose,variant='default'}:{title:string;children:ReactNode;onClose:()=>void;variant?:'default'|'identity'|'create'|'mcp'|'sound'}){
  const {t}=useI18n();
  const ref=useRef<HTMLDialogElement>(null);
  const [closing,setClosing]=useState(false);
  const [discard,setDiscard]=useState(false),[blocked,setBlocked]=useState(false);
  const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  function dismiss(force=false){
    if(ref.current?.querySelector('[data-busy="true"]')){setBlocked(true);return;}
    if(!force&&ref.current?.querySelector('form[data-dirty="true"]')){setDiscard(true);return;}
    if(closeTimer.current!==null)return;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}
    setClosing(true);closeTimer.current=setTimeout(onClose,140);
  }
  useEffect(()=>{
    const before=document.activeElement as HTMLElement;
    const dialog=ref.current;dialog?.showModal();
    const protect=(event:BeforeUnloadEvent)=>{if(dialog?.querySelector('[data-busy="true"],form[data-dirty="true"]')){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',protect);
    return()=>{window.removeEventListener('beforeunload',protect);if(closeTimer.current!==null)clearTimeout(closeTimer.current);dialog?.close();before?.focus();};
  },[]);
  return <dialog ref={ref} className="drawer public-dialog centered-dialog" data-variant={variant} data-closing={closing} aria-label={title} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss();}}} onCancel={event=>{event.preventDefault();event.stopPropagation();dismiss();}} onClick={event=>{
    if(event.target!==event.currentTarget)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dismiss();
  }}><div className="drawer-head"><h2>{title}</h2><button className="icon-button" aria-label={t('关闭详情','Close dialog')} onClick={()=>dismiss()}><X size={20}/></button></div>{blocked&&<p role="status" className="notice">{t('正在提交，请等待结果后再关闭。','Submitting. Please wait for the result before closing.')}</p>}{discard&&<div className="dialog-discard" role="alert"><p>{t('关闭后将丢弃尚未提交的内容。','Closing will discard your unsent changes.')}</p><div className="public-actions"><button type="button" className="secondary" onClick={()=>{setDiscard(false);ref.current?.querySelector<HTMLElement>('form[data-dirty="true"] :is(input,textarea,select)')?.focus();}}>{t('继续编辑','Keep editing')}</button><button type="button" className="secondary" onClick={()=>dismiss(true)}>{t('丢弃并关闭','Discard and close')}</button></div></div>}{children}</dialog>;
}
