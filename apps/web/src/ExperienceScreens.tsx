import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExperienceNavigation } from './ExperienceNavigation';

export default function ExperienceScreens({children}:{children:(navigation:{screen:number;enter:()=>void;home:()=>void})=>ReactNode}){
  const [screen,setScreen]=useState(()=>location.hash==='#collaborate'||new URLSearchParams(location.search).has('task')?1:0);
  const [panel,setPanel]=useState(0);
  const currentScreen=useRef(screen);currentScreen.current=screen;
  const root=useRef<HTMLDivElement>(null);
  function enter(){setScreen(1);const url=new URL(location.href);url.hash='collaborate';history.replaceState({},'',url);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
  function home(){setScreen(0);const url=new URL(location.href);url.hash='';history.replaceState({},'',url);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
  useEffect(()=>{
    const element=root.current!;
    let amount=0,blocked=false,release:ReturnType<typeof setTimeout>,touchY=0,touchDistance=0;
    function step(direction:number){
      if(element.querySelector('dialog[open]'))return;
      if(currentScreen.current===0&&direction>0)enter();
      else if(currentScreen.current===1)setPanel(direction>0?1:0);
    }
    function canRead(target:EventTarget|null,direction:number){
      const box=(target as HTMLElement)?.closest<HTMLElement>('.stage-card-scroll');
      return box&& (direction>0?box.scrollTop+box.clientHeight<box.scrollHeight-2:box.scrollTop>2);
    }
    function wheel(event:WheelEvent){
      if(event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||element.querySelector('dialog[open]'))return;
      if(canRead(event.target,event.deltaY))return;
      event.preventDefault();
      clearTimeout(release);release=setTimeout(()=>{blocked=false;amount=0;},220);
      if(blocked)return;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
      if(Math.sign(amount)!==Math.sign(delta))amount=0;
      amount+=delta;
      if(Math.abs(amount)>55){step(Math.sign(amount));blocked=true;amount=0;}
    }
    function start(event:TouchEvent){touchY=event.touches[0].clientY;touchDistance=0;}
    function move(event:TouchEvent){
      const delta=touchY-event.touches[0].clientY;
      if(element.querySelector('dialog[open]')||canRead(event.target,delta)){touchY=event.touches[0].clientY;touchDistance=0;return;}
      event.preventDefault();touchDistance=delta;
    }
    function end(){if(Math.abs(touchDistance)>65)step(Math.sign(touchDistance));touchDistance=0;}
    function key(event:KeyboardEvent){
      if((event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable=true]')||element.querySelector('dialog[open]'))return;
      if(event.key!=='PageDown'&&event.key!=='PageUp')return;
      const direction=event.key==='PageDown'?1:-1;
      if(canRead(event.target,direction))return;
      event.preventDefault();step(direction);
    }
    element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('touchstart',start,{passive:true});element.addEventListener('touchmove',move,{passive:false});element.addEventListener('touchend',end);element.addEventListener('keydown',key);
    return()=>{clearTimeout(release);element.removeEventListener('wheel',wheel);element.removeEventListener('touchstart',start);element.removeEventListener('touchmove',move);element.removeEventListener('touchend',end);element.removeEventListener('keydown',key);};
  },[]);
  return <ExperienceNavigation.Provider value={{screen,panel,setPanel,home}}><div ref={root} tabIndex={-1} className="experience-shell" data-screen={screen}>{children({screen,enter,home})}</div></ExperienceNavigation.Provider>;
}
