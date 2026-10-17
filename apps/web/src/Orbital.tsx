import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export default function Orbital() {
  const scene = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const element = scene.current;
    if (!element) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, visible = true, x = 0, y = 0, targetX = 0, targetY = 0;
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const draw = () => {
      x += (targetX - x) * .075;
      y += (targetY - y) * .075;
      element.style.setProperty('--orbit-x', `${x.toFixed(2)}px`);
      element.style.setProperty('--orbit-y', `${y.toFixed(2)}px`);
      if (Math.abs(targetX-x) + Math.abs(targetY-y) > .05) frame=requestAnimationFrame(draw);
      else frame=0;
    };
    const update = () => {
      const stopped = paused || media.matches || document.hidden || !visible;
      element.dataset.still = String(stopped);
      if(stopped) { stop(); targetX=targetY=x=y=0; element.style.setProperty('--orbit-x','0px'); element.style.setProperty('--orbit-y','0px'); }
    };
    const move = (event:PointerEvent) => {
      if (element.dataset.still === 'true' || event.pointerType === 'touch') return;
      const rect=element.getBoundingClientRect();
      targetX=((event.clientX-rect.left)/rect.width-.5)*24;
      targetY=((event.clientY-rect.top)/rect.height-.5)*18;
      if(!frame)frame=requestAnimationFrame(draw);
    };
    const leave = () => {targetX=targetY=0;if(!frame&&element.dataset.still!=='true')frame=requestAnimationFrame(draw);};
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update();});
    observer.observe(element);
    element.addEventListener('pointermove',move);
    element.addEventListener('pointerleave',leave);
    media.addEventListener('change',update);
    document.addEventListener('visibilitychange',update);
    update();
    return()=>{stop();observer.disconnect();element.removeEventListener('pointermove',move);element.removeEventListener('pointerleave',leave);media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);};
  },[paused]);
  return <div className="orbital-scene" ref={scene} data-still={paused}>
    <div className="orbital-art" aria-hidden="true">
      <div className="orbital-aura"/>
      <div className="orbital-field"><div className="orbital-ring ring-back"/><div className="orbital-ring ring-front"/><div className="orbital-core"/><span className="orbital-word">co-vibe</span><div className="orbital-ray"/></div>
      <span className="orbital-caption">INDEPENDENT MINDS · SHARED ORBIT</span>
    </div>
    <button className="motion-toggle" aria-label={paused?'播放品牌动效':'暂停品牌动效'} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button>
  </div>;
}
