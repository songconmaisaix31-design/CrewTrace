import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useI18n } from './i18n';
import './collaboration-stage.css';

export default function CollaborationStage({tasks,discussion}:{tasks:ReactNode;discussion:ReactNode}){
  const root=useRef<HTMLDivElement>(null);
  const [active,setActive]=useState(0);
  const {t}=useI18n();
  function show(index:number){
    const section=root.current!.closest<HTMLElement>('.public-content')!;
    const distance=section.offsetHeight-innerHeight;
    window.scrollTo({top:section.getBoundingClientRect().top+scrollY+index*distance,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  useEffect(()=>{
    const element=root.current!,section=element.closest<HTMLElement>('.public-content')!;
    let frame=0;
    const update=()=>{
      frame=0;
      const distance=Math.max(1,section.offsetHeight-innerHeight);
      const progress=Math.max(0,Math.min(1,-section.getBoundingClientRect().top/distance));
      element.style.setProperty('--stage-progress',String(progress));
      setActive(progress<.5?0:1);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const task=()=>show(0);
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
    window.addEventListener('crewtrace:show-tasks',task);
    update();
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);window.removeEventListener('crewtrace:show-tasks',task);};
  },[]);
  return <div className="collaboration-stage" ref={root}>
    <div className="stage-switch" role="group" aria-label={t('切换协作面板','Switch collaboration panel')}>
      <button aria-pressed={active===0} onClick={()=>show(0)}>01 <span>{t('协作任务','Tasks')}</span></button>
      <span className="stage-switch-line" aria-hidden="true"/>
      <button aria-pressed={active===1} onClick={()=>show(1)}>02 <span>{t('交流与公告','Discussion & announcements')}</span></button>
    </div>
    <div className="stage-window">
      <div className="stage-card stage-tasks" aria-hidden={active!==0} inert={active!==0}><div className="stage-card-scroll" tabIndex={active===0?0:-1} aria-label={t('滚动查看协作任务','Scroll through tasks')}>{tasks}</div></div>
      <div className="stage-card stage-discussion" aria-hidden={active!==1} inert={active!==1}><div className="stage-card-scroll" tabIndex={active===1?0:-1} aria-label={t('滚动查看交流与公告','Scroll through discussion and announcements')}>{discussion}</div></div>
    </div>
    <button className="stage-direction" onClick={()=>show(active===0?1:0)}>{active===0?<ArrowDown size={14}/>:<ArrowUp size={14}/>} {active===0?t('继续下滑 · 交流与公告','Scroll down · Discussion & announcements'):t('向上滑动 · 返回任务','Scroll up · Back to tasks')}</button>
  </div>;
}
