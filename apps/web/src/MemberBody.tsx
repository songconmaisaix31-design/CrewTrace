import {useI18n} from './i18n';

export default function MemberBody({text}:{text:string}){
  const {t}=useI18n();
  return <>{text.split(/(https?:\/\/[^\s<>]+)/g).map((part,index)=>{
    if(!/^https?:\/\//.test(part))return part;
    const link=part.replace(/[.,;:!?，。；：！？、）)\]】]+$/u,'');
    let url:URL;
    try{url=new URL(link);}catch{return part;}
    if(url.protocol!=='http:'&&url.protocol!=='https:')return part;
    return <span key={index}><a href={url.href} target="_blank" rel="noreferrer" aria-label={`${link} · ${t('在新标签页打开','opens in a new tab')}`}>{link}<span aria-hidden="true"> ↗</span></a>{part.slice(link.length)}</span>;
  })}</>;
}
