import { useLayoutEffect, useRef } from 'react';
import { useExperienceNavigation, type OrbitPoint } from './ExperienceNavigation';

export default function JourneyTrace(){
  const {screen,panel,orbit}=useExperienceNavigation();
  const svg=useRef<SVGSVGElement>(null),path=useRef<SVGPathElement>(null);
  const progress=useRef(screen),shape=useRef<OrbitPoint[]>([]),lastPoints=useRef<OrbitPoint[]>([]);
  useLayoutEffect(()=>{
    const root=svg.current!.closest<HTMLElement>('.experience-shell')!;
    let frame=0;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    if(screen===1&&progress.current===0)shape.current=orbit.current.map(point=>({...point}));
    const start=progress.current,begin=performance.now(),previous=lastPoints.current;
    root.style.setProperty('--scene-progress',String(start));
    const duration=reduced.matches?0:screen===start?290:420;
    function draw(now:number){
      if(!shape.current.length&&orbit.current.length)shape.current=orbit.current.map(point=>({...point}));
      const raw=duration?Math.min(1,(now-begin)/duration):1;
      const eased=1-Math.pow(1-raw,3);
      progress.current=start+(screen-start)*eased;
      const p=progress.current;
      root.style.setProperty('--scene-progress',String(p));
      const tab=root.querySelector<HTMLElement>('.stage-switch button[aria-pressed="true"]');
      const rail=root.querySelector<HTMLElement>('.stage-switch');
      if(tab&&rail&&shape.current.length){
        const box=tab.getBoundingClientRect(),railBox=rail.getBoundingClientRect();
        const y=railBox.bottom-24*(1-p)-1;
        const points=shape.current.map((point,index)=>{
          const target={x:box.left+box.width*index/(shape.current.length-1),y};
          if(start===1&&screen===1&&previous[index])return {x:previous[index].x+(target.x-previous[index].x)*eased,y:previous[index].y+(target.y-previous[index].y)*eased};
          return {x:point.x+(target.x-point.x)*p,y:point.y+(target.y-point.y)*p};
        });
        path.current!.setAttribute('d',points.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '));
        svg.current!.style.opacity=String(p===0?0:Math.min(1,p*5)*.85);
        lastPoints.current=points;
      }
      if(raw<1)frame=requestAnimationFrame(draw);
    }
    frame=requestAnimationFrame(draw);
    const resize=()=>{shape.current=orbit.current.map(point=>({...point}));draw(performance.now()+duration);};
    window.addEventListener('resize',resize);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);};
  },[screen,panel,orbit]);
  return <svg ref={svg} className="journey-trace" aria-hidden="true"><defs><linearGradient id="journey-light"><stop stopColor="#a181ce" stopOpacity=".15"/><stop offset=".5" stopColor="#f4eaff"/><stop offset="1" stopColor="#b08bdf" stopOpacity=".15"/></linearGradient></defs><path ref={path} stroke="url(#journey-light)" strokeWidth="1.3" fill="none"/></svg>;
}
