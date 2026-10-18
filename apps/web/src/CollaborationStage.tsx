import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
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
    </div>
    <div className="stage-window">
      <div className="stage-card stage-tasks" data-reading={reading&&active===0} aria-hidden={active!==0} inert={active!==0}><div className="stage-card-scroll" tabIndex={active===0?0:-1} aria-label={t('滚动查看协作任务','Scroll through tasks')}>{tasks}</div></div>
      <div className="stage-card stage-discussion" data-reading={reading&&active===1} aria-hidden={active!==1} inert={active!==1}><div className="stage-card-scroll" tabIndex={active===1?0:-1} aria-label={t('滚动查看交流与公告','Scroll through discussion and announcements')}>{discussion}</div></div>
    </div>
    <div className="stage-directions">
      <button className="stage-direction" onClick={()=>active===0?home():setPanel(0)} aria-label={active===0?t('上一屏：首页','Previous: home'):t('上一屏：协作任务','Previous: tasks')}><ArrowUp size={16}/>{t('向上探索','Explore above')}</button>
      {active===0&&<button className="stage-direction" onClick={()=>setPanel(1)} aria-label={t('下一屏：交流与公告','Next: discussion and announcements')}>{t('继续探索','Keep exploring')}<ArrowDown size={16}/></button>}
    </div>
  </div>;
}
