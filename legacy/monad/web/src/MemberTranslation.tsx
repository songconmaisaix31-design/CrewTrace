import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {z} from 'zod';
import {useI18n} from './i18n';
import './member-translation.css';

const fields=new Set(['title','description','body','name','scope','reason','content','requiredCapabilities','capabilities']);
const needsTranslation=(text:string)=>/\p{L}/u.test(text.replace(/\p{Script=Latin}/gu,''));
// 长成果按字符边界分段，避免截断代理对；原文始终完整保留。
function parts(text:string){const chars=Array.from(text),result:string[]=[];for(let i=0;i<chars.length;i+=5000)result.push(chars.slice(i,i+5000).join(''));return result;}
function collect(value:unknown,result:Set<string>,enabled=false){
  if(typeof value==='string'){if(enabled&&needsTranslation(value))parts(value).filter(needsTranslation).forEach(text=>result.add(text));return;}
  if(Array.isArray(value)){value.forEach(item=>collect(item,result,enabled));return;}
  if(value&&typeof value==='object')Object.entries(value).forEach(([key,item])=>collect(item,result,fields.has(key)));
}
const translations=new Map<string,string>(),failures=new Set<string>(),queue=new Set<string>(),pending=new Set<string>(),listeners=new Set<()=>void>();
let running=false;
function notify(){listeners.forEach(listener=>listener());}
async function drain(){
  if(running)return;running=true;
  try{
    while(queue.size){
      const texts:string[]=[];let size=0;
      for(const text of queue){if(texts.length===24||size+text.length>20000)break;texts.push(text);size+=text.length;}
      if(!texts.length){const text=queue.values().next().value!;queue.delete(text);failures.add(text);notify();continue;}
      texts.forEach(text=>{queue.delete(text);pending.add(text);});
      try{
        const response=await fetch('/api/web?action=translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texts}),signal:AbortSignal.timeout(50000)});
        if(!response.ok)throw new Error('Translation unavailable');
        const result=z.object({translations:z.array(z.string().min(1))}).parse(await response.json());
        if(result.translations.length!==texts.length)throw new Error('Translation count mismatch');
        texts.forEach((text,index)=>translations.set(text,result.translations[index]));
      }catch{ texts.forEach(text=>failures.add(text)); }
      finally{texts.forEach(text=>pending.delete(text));}
      notify();
    }
  }finally{running=false;}
}
const Context=createContext({original:false,setOriginal:(_value:boolean)=>{}});
export function MemberTranslationProvider({children}:{children:ReactNode}){
  const [original,setOriginal]=useState(false);
  const {language}=useI18n();
  useEffect(()=>setOriginal(false),[language]);
  return <Context.Provider value={{original,setOriginal}}>{children}</Context.Provider>;
}
export function useMemberText(records:unknown){
  const {language}=useI18n(),{original}=useContext(Context);
  const [,update]=useState(0);
  useEffect(()=>{const listener=()=>update(n=>n+1);listeners.add(listener);return()=>{listeners.delete(listener);};},[]);
  useEffect(()=>{
    if(language!=='en'||original)return;
    const texts=new Set<string>();collect(records,texts);
    texts.forEach(text=>{if(!translations.has(text)&&!failures.has(text)&&!pending.has(text))queue.add(text);});
    void drain();
  },[records,language,original]);
  return (text:string)=>{
    if(language!=='en'||original||!needsTranslation(text))return text;
    const chunks=parts(text);
    if(chunks.some(chunk=>failures.has(chunk)))return 'Translation unavailable';
    if(chunks.some(chunk=>needsTranslation(chunk)&&!translations.has(chunk)))return 'Translating…';
    return chunks.map(chunk=>translations.get(chunk)??chunk).join('');
  };
}
export function useMemberView<T>(record:T):T{
  const text=useMemberText(record);
  function display(value:unknown,enabled=false):unknown{
    if(typeof value==='string')return enabled?text(value):value;
    if(Array.isArray(value))return value.map(item=>display(item,enabled));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,display(item,fields.has(key))]));
    return value;
  }
  return display(record) as T;
}
export function TranslationControl(){
  const {language}=useI18n(),{original,setOriginal}=useContext(Context);
  const [,update]=useState(0);
  useEffect(()=>{const listener=()=>update(n=>n+1);listeners.add(listener);return()=>{listeners.delete(listener);};},[]);
  if(language!=='en')return null;
  return <div className="translation-control"><span>{original?'Showing original member content':'Member content · Machine translation'}</span><button type="button" onClick={()=>setOriginal(!original)}>{original?'Show English':'View original'}</button>{!original&&failures.size>0&&<button type="button" onClick={()=>{failures.forEach(text=>queue.add(text));failures.clear();notify();void drain();}}>Retry translation</button>}</div>;
}
