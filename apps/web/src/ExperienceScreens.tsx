import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExperienceNavigation, type OrbitPoint } from './ExperienceNavigation';

export default function ExperienceScreens({children}:{children:(navigation:{screen:number;enter:()=>void;home:()=>void})=>ReactNode}){
  const [screen,setScreen]=useState(()=>location.hash==='#collaborate'||new URLSearchParams(location.search).has('task')?1:0);
  const [panel,setPanel]=useState(0);
  const [paused,setPaused]=useState(false);
  const currentScreen=useRef(screen);currentScreen.current=screen;
  const currentPanel=useRef(panel);currentPanel.current=panel;
  const root=useRef<HTMLDivElement>(null);
  const orbit=useRef<OrbitPoint[]>([]);
  function enter(){currentScreen.current=1;setPanel(0);setScreen(1);const url=new URL(location.href);url.hash='collaborate';history.replaceState({},'',url);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
  function home(){currentScreen.current=0;setScreen(0);const url=new URL(location.href);url.hash='';history.replaceState({},'',url);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
  useEffect(()=>{
    const element=root.current!;
    let amount=0,lastWheel=0,lastDirection=0,lastMagnitude=0,decayCount=0,lastStep=0,consumed=false,touchY=0,touchX=0,touchDistance=0,multiTouch=false,touchRead=false,touchConsumed=false;
    let lastPaint=performance.now(),stalledAt=-Infinity,paintFrame=0;
    // 绘制停顿会合并滚轮事件，不能把这类时间间隔当成新的手势。
    function trackPaint(now:number){if(now-lastPaint>80)stalledAt=now;lastPaint=now;paintFrame=requestAnimationFrame(trackPaint);}
    paintFrame=requestAnimationFrame(trackPaint);
    const modalOpen=()=>!!element.querySelector('dialog[open]');
    function step(direction:number){
      if(currentScreen.current===0){if(direction>0)enter();return;}
      if(direction<0){if(currentPanel.current===1){currentPanel.current=0;setPanel(0);}else home();}
      else if(currentPanel.current===0){currentPanel.current=1;setPanel(1);}
    }
    function canRead(target:EventTarget|null,direction:number){
      const box=(target as HTMLElement)?.closest<HTMLElement>('.stage-card-scroll');
      return !!box&&(direction>0?box.scrollTop+box.clientHeight<box.scrollHeight-2:box.scrollTop>2);
    }
    function wheel(event:WheelEvent){
      if(modalOpen()||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
      if(!delta)return;
      const direction=Math.sign(delta);
      const magnitude=Math.abs(delta);
      const now=performance.now();
      const stalled=now-lastPaint>80||now-stalledAt<100;
      const fresh=event.timeStamp-lastWheel>100&&!stalled;
      const reverse=direction!==lastDirection;
      // 惯性连续减弱后重新明显加速，视为下一次主动滑动。
      const renewed=!stalled&&consumed&&decayCount>=3&&event.timeStamp-lastStep>160&&magnitude>=16&&magnitude>lastMagnitude*2+8;
      if(fresh||reverse||renewed){amount=0;consumed=false;decayCount=0;}
      else if(magnitude<lastMagnitude)decayCount++;
      else if(magnitude>lastMagnitude)decayCount=0;
      lastMagnitude=magnitude;
      lastWheel=event.timeStamp;lastDirection=direction;
      // 阅读手势到达边缘后先停住；下一次独立手势再换页。
      if(canRead(event.target,direction)){consumed=true;amount=0;return;}
      event.preventDefault();
      if(consumed)return;
      amount+=delta;
      if(Math.abs(amount)>=16){consumed=true;amount=0;lastStep=event.timeStamp;step(direction);}
    }
    function start(event:TouchEvent){multiTouch=event.touches.length!==1;touchY=event.touches[0].clientY;touchX=event.touches[0].clientX;touchDistance=0;touchRead=false;touchConsumed=false;}
    function move(event:TouchEvent){
      if(modalOpen())return;
      if(multiTouch||event.touches.length!==1){multiTouch=true;touchDistance=0;return;}
      if(touchConsumed){event.preventDefault();return;}
      const delta=touchY-event.touches[0].clientY;
      if(Math.abs(event.touches[0].clientX-touchX)>Math.abs(delta)){touchDistance=0;return;}
      if(touchRead||canRead(event.target,delta)){touchRead=true;touchDistance=0;return;}
      touchDistance=delta;event.preventDefault();
      if(Math.abs(touchDistance)>=24){touchConsumed=true;step(Math.sign(touchDistance));}
    }
    function end(){touchDistance=0;}
    function cancel(){touchDistance=0;multiTouch=true;}
    function key(event:KeyboardEvent){
      if(event.repeat||modalOpen()||(event.key!=='PageDown'&&event.key!=='PageUp'))return;
      if((event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable=true]'))return;
      const direction=event.key==='PageDown'?1:-1;
      if(canRead(event.target,direction))return;
      event.preventDefault();step(direction);
    }
    element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('touchstart',start,{passive:true});element.addEventListener('touchmove',move,{passive:false});element.addEventListener('touchend',end);element.addEventListener('touchcancel',cancel);element.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(paintFrame);element.removeEventListener('wheel',wheel);element.removeEventListener('touchstart',start);element.removeEventListener('touchmove',move);element.removeEventListener('touchend',end);element.removeEventListener('touchcancel',cancel);element.removeEventListener('keydown',key);};
  },[]);
  return <ExperienceNavigation.Provider value={{screen,panel,setPanel,home,paused,setPaused,orbit}}><div ref={root} tabIndex={-1} className="experience-shell" data-screen={screen} data-paused={paused}>{children({screen,enter,home})}</div></ExperienceNavigation.Provider>;
}
