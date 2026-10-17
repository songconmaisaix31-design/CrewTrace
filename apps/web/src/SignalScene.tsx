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
      if(moving){tick+=.025;mx+=(tx-mx)*.09;my+=(ty-my)*.09;burst*=.965;}
      ctx.clearRect(0,0,width,height);
      const radius=Math.min(width*.33,height*.32)*(1+Math.sin(tick*.8)*.055+burst*.12);
      const cx=width*.52+mx*32, cy=height*.48+my*28;
      const halo=ctx.createRadialGradient(cx,cy,radius*.35,cx,cy,radius*1.45);
      halo.addColorStop(0,'rgba(120,67,220,0)');
      halo.addColorStop(.52,'rgba(133,79,233,.14)');
      halo.addColorStop(.72,'rgba(174,120,255,.09)');
      halo.addColorStop(1,'rgba(120,67,220,0)');
      ctx.fillStyle=halo;ctx.fillRect(0,0,width,height);
      ctx.globalCompositeOperation='lighter';
      for(let band=0;band<38;band++){
        const phase=band/38*Math.PI*2;
        ctx.beginPath();
        for(let p=0;p<=180;p++){
          const a=p/180*Math.PI*2;
          const braid=phase+a*3+tick;
          const r=radius+(Math.cos(braid)*(.18+burst*.13))*radius;
          const x=Math.cos(a)*r;
          const y=Math.sin(a)*r;
          const z=Math.sin(braid)*radius*.3;
          const tilt=.62+my*.22+Math.sin(tick*.6)*.12;
          const angle=.36+mx*.28+Math.sin(tick*.55)*.28;
          const px=cx+x*Math.cos(angle)-y*Math.sin(angle)*tilt;
          const py=cy+x*Math.sin(angle)+y*Math.cos(angle)*tilt+z;
          if(p===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
        }
        const bright=band%6===0;
        ctx.strokeStyle=bright?'rgba(234,218,255,.78)':'rgba(161,123,238,.32)';
        ctx.shadowColor='rgba(171,117,255,.8)';ctx.shadowBlur=bright?12:0;
        ctx.lineWidth=bright?1.5:.8;ctx.stroke();
      }
      ctx.shadowBlur=0;
      // 移动高光让光环的方向变化可见，不通过闪烁吸引注意。
      ctx.save();ctx.translate(cx,cy);ctx.rotate(.36+Math.sin(tick*.55)*.28);
      ctx.scale(1,.78);
      ctx.beginPath();ctx.arc(0,0,radius*1.08,tick*.65,tick*.65+1.25);
      ctx.strokeStyle='rgba(242,226,255,.9)';ctx.lineWidth=2;
      ctx.shadowColor='#b997ff';ctx.shadowBlur=18;ctx.stroke();
      if(burst>.02){ctx.beginPath();ctx.arc(0,0,radius*(1.15+(1-burst)*.65),0,Math.PI*2);ctx.strokeStyle=`rgba(211,172,255,${burst*.65})`;ctx.lineWidth=1.5;ctx.stroke();}
      ctx.restore();ctx.shadowBlur=0;
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
