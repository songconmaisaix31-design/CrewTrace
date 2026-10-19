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
      <button aria-pressed={active===1} onClick={()=>setPanel(1)}>02 <span>{t('交流','Discussion')}</span></button>
      <button aria-pressed={active===2} onClick={()=>setPanel(2)}>03 <span>{t('公告','Announcements')}</span></button>
    </div>
    <div className="stage-window">
      {[
        {className:'stage-tasks',label:t('协作任务预览','Task preview'),content:tasks},
        {className:'stage-discussion',label:t('交流预览','Discussion preview'),content:discussion},
        {className:'stage-announcements',label:t('最新公告预览','Latest announcement preview'),content:announcements},
      ].map((item,index)=><div key={item.className} className={`stage-card ${item.className}`} data-position={index<active?'before':index>active?'after':'active'} aria-hidden={active!==index} inert={active!==index}><div className="stage-card-scroll" tabIndex={active===index?0:-1} aria-label={item.label}>{item.content}</div></div>)}
    </div>
    <div className="stage-directions">
      <button className="stage-direction" onClick={()=>active===0?home():setPanel(active-1)}><ArrowUp size={16}/>{active===0?t('返回首页','Back to home'):active===1?t('协作任务','Tasks'):t('交流','Discussion')}</button>
      {active<2&&<button className="stage-direction" onClick={()=>setPanel(active+1)}>{active===0?t('交流','Discussion'):t('公告','Announcements')}<ArrowDown size={16}/></button>}
    </div>
  </div>;
}
