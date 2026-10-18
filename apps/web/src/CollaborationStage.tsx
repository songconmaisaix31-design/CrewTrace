import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpLeft } from 'lucide-react';
import { useI18n } from './i18n';
import { useExperienceNavigation } from './ExperienceNavigation';
import './collaboration-stage.css';

export default function CollaborationStage({tasks,discussion}:{tasks:ReactNode;discussion:ReactNode}){
  const {panel:active,setPanel,home,screen}=useExperienceNavigation();
  const {t}=useI18n();
  const [reading,setReading]=useState(false);
  useEffect(()=>setReading(false),[active,screen]);
  useEffect(()=>{const show=()=>setPanel(0);window.addEventListener('crewtrace:show-tasks',show);return()=>window.removeEventListener('crewtrace:show-tasks',show);},[setPanel]);
  return <div className="collaboration-stage" data-panel={active}>
    <div className="stage-switch" role="group" aria-label={t('切换协作面板','Switch collaboration panel')}>
      <button aria-pressed={active===0} onClick={()=>setPanel(0)}>01 <span>{t('协作任务','Tasks')}</span></button>
      <span className="stage-switch-line" aria-hidden="true"/>
      <button aria-pressed={active===1} onClick={()=>setPanel(1)}>02 <span>{t('交流与公告','Discussion & announcements')}</span></button>
      <button className="stage-read" aria-pressed={reading} onClick={()=>setReading(value=>!value)}>{reading?t('退出阅读','Exit reading'):t('阅读内容','Read content')}</button>
      <button className="stage-home" onClick={home}><ArrowUpLeft size={14}/><span>{t('返回首页','Back to home')}</span></button>
    </div>
    <div className="stage-window">
      <div className="stage-card stage-tasks" data-reading={reading&&active===0} aria-hidden={active!==0} inert={active!==0}><div className="stage-card-scroll" tabIndex={active===0?0:-1} aria-label={t('滚动查看协作任务','Scroll through tasks')}>{tasks}</div></div>
      <div className="stage-card stage-discussion" data-reading={reading&&active===1} aria-hidden={active!==1} inert={active!==1}><div className="stage-card-scroll" tabIndex={active===1?0:-1} aria-label={t('滚动查看交流与公告','Scroll through discussion and announcements')}>{discussion}</div></div>
    </div>
    <button className="stage-direction" onClick={()=>setPanel(active===0?1:0)}>{active===0?<ArrowDown size={14}/>:<ArrowUp size={14}/>} {active===0?t('继续下滑 · 交流与公告','Scroll down · Discussion & announcements'):t('向上滑动 · 返回任务','Scroll up · Back to tasks')}</button>
  </div>;
}
