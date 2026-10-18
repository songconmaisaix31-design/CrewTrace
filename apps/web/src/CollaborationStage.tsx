import { useEffect, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useI18n } from './i18n';
import { useExperienceNavigation } from './ExperienceNavigation';
import './collaboration-stage.css';
import './experience-polish.css';

export default function CollaborationStage({tasks,discussion,announcements}:{tasks:ReactNode;discussion:ReactNode;announcements:ReactNode}){
  const {panel:active,setPanel,home}=useExperienceNavigation();
  const {t}=useI18n();
  useEffect(()=>{const show=()=>setPanel(0);window.addEventListener('crewtrace:show-tasks',show);return()=>window.removeEventListener('crewtrace:show-tasks',show);},[setPanel]);
  return <div className="collaboration-stage" data-panel={active}>
    <div className="stage-switch" role="group" aria-label={t('切换协作面板','Switch collaboration panel')}>
      <button aria-pressed={active===0} onClick={()=>setPanel(0)}>01 <span>{t('协作任务','Tasks')}</span></button>
      <span className="stage-switch-line" aria-hidden="true"/>
      <button aria-pressed={active===1} onClick={()=>setPanel(1)}>02 <span>{t('交流','Discussion')}</span></button>
      <span className="stage-switch-line" aria-hidden="true"/>
      <button aria-pressed={active===2} onClick={()=>setPanel(2)}>03 <span>{t('公告','Announcements')}</span></button>
    </div>
    <div className="stage-window">
      <div className="stage-card stage-tasks" aria-hidden={active!==0} inert={active!==0}><div className="stage-card-scroll" tabIndex={active===0?0:-1} aria-label={t('滚动查看协作任务','Scroll through tasks')}>{tasks}</div></div>
      <div className="stage-card stage-discussion" aria-hidden={active!==1} inert={active!==1}><div className="stage-card-scroll" tabIndex={active===1?0:-1} aria-label={t('滚动查看交流与公告','Scroll through discussion and announcements')}>{discussion}</div></div>
      <div className="stage-card stage-announcements" aria-hidden={active!==2} inert={active!==2}><div className="stage-card-scroll" tabIndex={active===2?0:-1} aria-label={t('滚动查看公告','Scroll through announcements')}>{announcements}</div></div>
    </div>
    <div className="stage-directions">
      <button className="stage-direction" onClick={()=>active===0?home():setPanel(active-1)}><ArrowUp size={16}/>{active===0?t('返回首页','Back to home'):active===1?t('协作任务','Tasks'):t('交流','Discussion')}</button>
      {active<2&&<button className="stage-direction" onClick={()=>setPanel(active+1)}>{active===0?t('交流','Discussion'):t('公告','Announcements')}<ArrowDown size={16}/></button>}
    </div>
  </div>;
}
