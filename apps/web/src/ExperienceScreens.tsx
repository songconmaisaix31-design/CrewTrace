import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExperienceNavigation, type OrbitPoint } from './ExperienceNavigation';

export default function ExperienceScreens({children}:{children:(navigation:{screen:number;enter:()=>void;home:()=>void})=>ReactNode}){
  const [screen,setScreen]=useState(()=>location.hash==='#collaborate'||new URLSearchParams(location.search).has('task')?1:0);
  const [panel,setPanel]=useState(0);
  const [paused,setPaused]=useState(false);
  const currentScreen=useRef(screen);currentScreen.current=screen;
  const root=useRef<HTMLDivElement>(null);
  const orbit=useRef<OrbitPoint[]>([]);
  function enter(){currentScreen.current=1;setPanel(0);setScreen(1);const url=new URL(location.href);url.hash='collaborate';history.replaceState({},'',url);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
  function home(){currentScreen.current=0;setScreen(0);const url=new URL(location.href);url.hash='';history.replaceState({},'',url);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
  useEffect(()=>{
    const element=root.current!;
    let amount=0,lastWheel=0,touchY=0,touchDistance=0,multiTouch=false;
    const canEnter=()=>currentScreen.current===0&&!element.querySelector('dialog[open]');
    function wheel(event:WheelEvent){
      // 工作区保留原生阅读，内容边界不触发换页。
      if(!canEnter()||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
      event.preventDefault();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
      if(event.timeStamp-lastWheel>180||delta<0)amount=0;
      lastWheel=event.timeStamp;amount+=Math.max(0,delta);
      if(amount>=24){amount=0;enter();}
    }
    function start(event:TouchEvent){multiTouch=event.touches.length!==1;touchY=event.touches[0].clientY;touchDistance=0;}
    function move(event:TouchEvent){
      if(!canEnter())return;
      if(multiTouch||event.touches.length!==1){multiTouch=true;touchDistance=0;return;}
      touchDistance=touchY-event.touches[0].clientY;
      if(touchDistance>0)event.preventDefault();
    }
    function end(){if(canEnter()&&!multiTouch&&touchDistance>28)enter();touchDistance=0;}
    function cancel(){touchDistance=0;multiTouch=true;}
    function key(event:KeyboardEvent){
      if(event.repeat||!canEnter()||event.key!=='PageDown')return;
      if((event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable=true]'))return;
      event.preventDefault();enter();
    }
    element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('touchstart',start,{passive:true});element.addEventListener('touchmove',move,{passive:false});element.addEventListener('touchend',end);element.addEventListener('touchcancel',cancel);element.addEventListener('keydown',key);
    return()=>{element.removeEventListener('wheel',wheel);element.removeEventListener('touchstart',start);element.removeEventListener('touchmove',move);element.removeEventListener('touchend',end);element.removeEventListener('touchcancel',cancel);element.removeEventListener('keydown',key);};
  },[]);
  return <ExperienceNavigation.Provider value={{screen,panel,setPanel,home,paused,setPaused,orbit}}><div ref={root} tabIndex={-1} className="experience-shell" data-screen={screen} data-paused={paused}>{children({screen,enter,home})}</div></ExperienceNavigation.Provider>;
}
