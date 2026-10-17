import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

// 品牌画面响应用户操作，不代表任务正在执行。
export default function SignalScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let width=0, height=0, frame=0, visible=true, tick=0, last=0;
    let mx=0, my=0, tx=0, ty=0, burst=0;
    const draw = (now:number) => {
      frame=0;
      if(now-last<30 && !paused && !reduced.matches){frame=requestAnimationFrame(draw);return;}
      last=now;
      const moving=!paused && !reduced.matches && visible && !document.hidden;
      if(moving){tick+=.006;mx+=(tx-mx)*.07;my+=(ty-my)*.07;burst*=.95;}
      ctx.clearRect(0,0,width,height);
      const radius=Math.min(width*.36,height*.35);
      const cx=width*.52+mx*18, cy=height*.48+my*18;
      ctx.globalCompositeOperation='lighter';
      for(let band=0;band<38;band++){
        const phase=band/38*Math.PI*2;
        ctx.beginPath();
        for(let p=0;p<=180;p++){
          const a=p/180*Math.PI*2;
          const braid=phase+a*3+tick;
          const r=radius+(Math.cos(braid)*(.14+burst*.06))*radius;
          const x=Math.cos(a)*r;
          const y=Math.sin(a)*r;
          const z=Math.sin(braid)*radius*.3;
          const tilt=.52+my*.12;
          const px=cx+x*Math.cos(.36+mx*.12)-y*Math.sin(.36+mx*.12)*tilt;
          const py=cy+x*Math.sin(.36+mx*.12)+y*Math.cos(.36+mx*.12)*tilt+z;
          if(p===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
        }
        ctx.strokeStyle=band%5===0?'rgba(216,211,247,.30)':'rgba(141,113,211,.12)';
        ctx.lineWidth=band%5===0?1:.7;ctx.stroke();
      }
      ctx.globalCompositeOperation='source-over';
      if(moving)frame=requestAnimationFrame(draw);
    };
    const restart=()=>{cancelAnimationFrame(frame);frame=0;if(visible&&!document.hidden)frame=requestAnimationFrame(draw);};
    const resize=new ResizeObserver(()=>{const box=el.getBoundingClientRect();width=box.width;height=box.height;const dpr=Math.min(devicePixelRatio,1.5);el.width=width*dpr;el.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);restart();});
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;restart();});
    const move=(e:PointerEvent)=>{const b=el.getBoundingClientRect();tx=(e.clientX-b.left)/b.width*2-1;ty=(e.clientY-b.top)/b.height*2-1;};
    const leave=()=>{tx=ty=0;};
    const pulse=()=>{if(!paused&&!reduced.matches)burst=1;};
    resize.observe(el);observer.observe(el);
    el.addEventListener('pointermove',move);el.addEventListener('pointerleave',leave);el.addEventListener('pointerdown',pulse);
    document.addEventListener('visibilitychange',restart);reduced.addEventListener('change',restart);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();el.removeEventListener('pointermove',move);el.removeEventListener('pointerleave',leave);el.removeEventListener('pointerdown',pulse);document.removeEventListener('visibilitychange',restart);reduced.removeEventListener('change',restart);};
  },[paused]);
  return <div className="signal-scene"><canvas ref={canvas} aria-hidden="true"/><div className="scene-controls"><span>独立协作，相互成就。</span><button className="motion-toggle" aria-label={paused?'播放品牌动效':'暂停品牌动效'} aria-pressed={paused} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={13}/>:<Pause size={13}/>}</button></div></div>;
}
