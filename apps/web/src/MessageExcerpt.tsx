import {useLayoutEffect,useRef,useState} from 'react';
import HoverPreview from './HoverPreview';
import {useI18n} from './i18n';

export default function MessageExcerpt({body,onRead}:{body:string;onRead:()=>void}){
  const {t}=useI18n();
  const paragraph=useRef<HTMLParagraphElement>(null);
  const [truncated,setTruncated]=useState(false);
  useLayoutEffect(()=>{
    const element=paragraph.current!;
    const measure=()=>setTruncated(element.scrollHeight>element.clientHeight+1);
    const observer=new ResizeObserver(measure);
    observer.observe(element);measure();
    return()=>observer.disconnect();
  },[body]);
  return <><p ref={paragraph} className="record-excerpt">{body}</p>{truncated&&<HoverPreview onClick={onRead} preview={<p>{body}</p>}>{t('展开阅读','Read message')}</HoverPreview>}</>;
}
