import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExperienceNavigation } from './ExperienceNavigation';

export default function ExperienceScreens({children}:{children:(navigation:{screen:number;enter:()=>void;home:()=>void})=>ReactNode}){
  const [screen,setScreen]=useState(()=>location.hash==='#collaborate'||new URLSearchParams(location.search).has('task')?1:0);
  const [panel,setPanel]=useState(0);
  const [paused,setPaused]=useState(false);
  const currentScreen=useRef(screen);currentScreen.current=screen;
  const currentPanel=useRef(panel);currentPanel.current=panel;
  const root=useRef<HTMLDivElement>(null);
  const pageGuard=useRef(0);
  function enter(){pageGuard.current=performance.now()+620;currentPanel.current=0;currentScreen.current=1;setPanel(0);setScreen(1);const url=new URL(location.href);url.hash='collaborate';history.replaceState({},'',url);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
  function home(){pageGuard.current=performance.now()+620;currentScreen.current=0;setScreen(0);const url=new URL(location.href);url.hash='';history.replaceState({},'',url);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
  useEffect(()=>{
    const element=root.current!;
    let amount=0,blocked=false,lastWheel=0,lastDelta=0,lastStep=0,touchY=0,touchDistance=0;
    function step(direction:number){
      if(element.querySelector('dialog[open]'))return;
      if(currentScreen.current===0&&direction>0)enter();
      else if(currentScreen.current===1){
        if(direction<0){if(currentPanel.current===1)setPanel(0);else home();}
        else setPanel(1);
      }
    }
    function canRead(target:EventTarget|null,direction:number){
      const box=(target as HTMLElement)?.closest<HTMLElement>('.stage-card-scroll');
      return box&&(direction>0?box.scrollTop+box.clientHeight<box.scrollHeight-2:box.scrollTop>2);
    }
    function wheel(event:WheelEvent){
      if(event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||element.querySelector('dialog[open]'))return;
      if(canRead(event.target,event.deltaY)){lastWheel=performance.now();lastDelta=event.deltaY;blocked=true;amount=0;return;}
      event.preventDefault();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
      const now=performance.now();
      // 跨页完成并且惯性结束后，才把后续滚轮识别为新手势。
      if(pageGuard.current){
        if(now<pageGuard.current||now-lastWheel<320){lastWheel=now;lastDelta=delta;blocked=true;amount=0;return;}
        pageGuard.current=0;blocked=false;amount=0;
      }
      const fresh=now-lastWheel>65||Math.sign(delta)!==Math.sign(lastDelta)||(now-lastStep>150&&Math.abs(delta)>Math.max(8,Math.abs(lastDelta)*1.5));
      if(fresh){blocked=false;amount=0;}
      lastWheel=now;lastDelta=delta;
      if(blocked)return;
      if(Math.sign(amount)!==Math.sign(delta))amount=0;
      amount+=delta;
      if(Math.abs(amount)>=8){step(Math.sign(amount));lastStep=now;blocked=true;amount=0;}
    }
    function start(event:TouchEvent){touchY=event.touches[0].clientY;touchDistance=0;}
    function move(event:TouchEvent){
      const delta=touchY-event.touches[0].clientY;
      if(element.querySelector('dialog[open]')||canRead(event.target,delta)){touchY=event.touches[0].clientY;touchDistance=0;return;}
      event.preventDefault();touchDistance=delta;
    }
    function end(){if(Math.abs(touchDistance)>20)step(Math.sign(touchDistance));touchDistance=0;}
    function key(event:KeyboardEvent){
      if(event.repeat)return;
      if((event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable=true]')||element.querySelector('dialog[open]'))return;
      if(event.key!=='PageDown'&&event.key!=='PageUp')return;
      const direction=event.key==='PageDown'?1:-1;
      if(canRead(event.target,direction))return;
      event.preventDefault();step(direction);
    }
    element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('touchstart',start,{passive:true});element.addEventListener('touchmove',move,{passive:false});element.addEventListener('touchend',end);element.addEventListener('keydown',key);
    return()=>{element.removeEventListener('wheel',wheel);element.removeEventListener('touchstart',start);element.removeEventListener('touchmove',move);element.removeEventListener('touchend',end);element.removeEventListener('keydown',key);};
  },[]);
  return <ExperienceNavigation.Provider value={{screen,panel,setPanel,home,paused,setPaused}}><div ref={root} tabIndex={-1} className="experience-shell" data-screen={screen} data-paused={paused}>{children({screen,enter,home})}</div></ExperienceNavigation.Provider>;
}
