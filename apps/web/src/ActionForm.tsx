import { useState, type FormEvent, type ReactNode } from 'react';
import { collaborationError } from './collaboration-api';
import { useI18n } from './i18n';
import {useSoundFeedback} from './SoundFeedback';

export const field=(data:FormData,name:string)=>String(data.get(name)??'');
export const fields=(data:FormData,name:string)=>data.getAll(name).map(value=>String(value).trim()).filter(Boolean);

export default function ActionForm({children,label,onSubmit}:{children:ReactNode;label:string;onSubmit:(data:FormData)=>Promise<void>}){
  const {t,error:translateError}=useI18n();
  const {play}=useSoundFeedback();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;
    const form=event.currentTarget,data=new FormData(form);setBusy(true);setError('');
    try{await onSubmit(data);play('success');form.reset();}
    catch(problem){setError(collaborationError(problem));}
    finally{setBusy(false);}
  }
  return <form className="public-form" onSubmit={submit}>{children}{error&&<p className="error" role="alert">{translateError(error)}</p>}<button className="primary" disabled={busy}>{busy?t('正在提交…','Submitting…'):label}</button></form>;
}

export function CapabilityFields({name,label}:{name:string;label:string}){
  const {t}=useI18n();
  const [rows,setRows]=useState([0]);
  return <fieldset><legend>{label}</legend>{rows.map(row=><label key={row} className="public-capability"><span className="sr-only">{label} {row+1}</span><input name={name} maxLength={100}/></label>)}<button className="text-button" type="button" disabled={rows.length>=32} onClick={()=>setRows(items=>[...items,items.length])}>{t('添加一项','Add another')}</button></fieldset>;
}
