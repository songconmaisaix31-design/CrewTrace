import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useI18n } from './i18n';
import { useExperienceNavigation } from './ExperienceNavigation';

// 品牌画面响应用户操作，不代表任务正在执行。
export default function SignalScene({paused:controlledPaused,scale=1,haloScale=1.45}:{paused?:boolean;scale?:number;haloScale?:number}={}) {
  const {t}=useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [localPaused, setPaused] = useState(false);
  const paused=controlledPaused??localPaused;
  const pauseRef=useRef(paused);pauseRef.current=paused;
  const wake=useRef(()=>{});
  const {orbit}=useExperienceNavigation();
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const lens=document.createElement('canvas');
    const lensContext=lens.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let width=0, height=0, frame=0, visible=true, tick=0, last=0;
    let mx=0, my=0, tx=0, ty=0, burst=0, pointerInside=false, px=0, py=0, lensStrength=0;
    const draw = (now:number) => {
      frame=0;
      if(now-last<30 && !pauseRef.current && !reduced.matches){frame=requestAnimationFrame(draw);return;}
      const delta=Math.min((now-last)/1000,.05);last=now;
      const moving=!pauseRef.current && !reduced.matches && visible && !document.hidden;
      if(moving){tick+=delta*.75;mx+=(tx-mx)*.09;my+=(ty-my)*.09;burst*=.965;}
      el.dataset.phase=String(tick);
      ctx.clearRect(0,0,width,height);
      const radius=Math.min(width*.33,height*.32)*scale*(1+Math.sin(tick*.8)*.055+burst*.12);
      const cx=width*.52+mx*32, cy=height*.48+my*28;
      const halo=ctx.createRadialGradient(cx,cy,radius*.35,cx,cy,radius*haloScale);
      halo.addColorStop(0,'rgba(120,67,220,0)');
      halo.addColorStop(.52,'rgba(145,91,245,.15)');
      halo.addColorStop(.72,'rgba(186,142,255,.085)');
      halo.addColorStop(1,'rgba(120,67,220,0)');
      ctx.fillStyle=halo;ctx.fillRect(0,0,width,height);
      ctx.globalCompositeOperation='source-over';
      const paths:{points:{x:number;y:number}[];depth:number;bright:boolean;highlight:number}[]=[];
      const orbitShape:{x:number;y:number}[]=[];
      for(let band=0;band<38;band++){
        const phase=band/38*Math.PI*2;
        for(let segment=0;segment<6;segment++){
        const points:{x:number;y:number}[]=[];
        for(let p=segment*30;p<=segment*30+30;p++){
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
          points.push({x:px,y:py});
          if(band===0&&(segment===0||p>segment*30))orbitShape.push({x:px,y:py});
        }
        const a=(segment+.5)/6*Math.PI*2;
        const depth=(Math.sin(phase+a*3+tick)+1)/2;
        const highlight=Math.pow(Math.max(0,Math.cos(a-tick*.45)),12);
        const bright=band%6===0;
        paths.push({points,depth,bright,highlight});
        }
      }
      const rect=el.getBoundingClientRect();
      orbit.current=orbitShape.map(point=>({x:rect.left+point.x*rect.width/width,y:rect.top+point.y*rect.height/height}));
      paths.sort((a,b)=>a.depth-b.depth);
      for(const {points,depth,bright,highlight} of paths){
        ctx.beginPath();points.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));
        ctx.strokeStyle=`rgba(${Math.round(169+depth*75)},${Math.round(134+depth*103)},255,${(bright?.38:.2)+depth*(bright?.5:.22)+highlight*.1})`;
        ctx.lineWidth=(bright?1.05:.6)+depth*.55;
        ctx.shadowBlur=0;ctx.stroke();
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
      // 对已绘制的真实光环局部采样放大，边缘渐隐，离开后平滑恢复。
      if(moving)lensStrength+=((pointerInside?1:0)-lensStrength)*.15;
      if(lensContext&&lensStrength>.005){
        const size=240, zoom=1+.14*lensStrength, dpr=el.width/width;
        if(lens.width!==size){lens.width=lens.height=size;}
        lensContext.clearRect(0,0,size,size);
        lensContext.globalCompositeOperation='source-over';
        lensContext.drawImage(el,(px-size/2/zoom)*dpr,(py-size/2/zoom)*dpr,size/zoom*dpr,size/zoom*dpr,0,0,size,size);
        lensContext.globalCompositeOperation='destination-in';
        const mask=lensContext.createRadialGradient(size/2,size/2,30,size/2,size/2,size/2);
        mask.addColorStop(0,`rgba(0,0,0,${lensStrength})`);mask.addColorStop(.55,`rgba(0,0,0,${lensStrength*.7})`);mask.addColorStop(1,'rgba(0,0,0,0)');
        lensContext.fillStyle=mask;lensContext.fillRect(0,0,size,size);
        ctx.drawImage(lens,px-size/2,py-size/2,size,size);
      }
      if(moving)frame=requestAnimationFrame(draw);
    };
    const restart=()=>{cancelAnimationFrame(frame);frame=0;if(visible&&!document.hidden)frame=requestAnimationFrame(draw);};
    const resize=new ResizeObserver(()=>{const box=el.getBoundingClientRect();width=box.width;height=box.height;const dpr=Math.min(devicePixelRatio,1.5);el.width=width*dpr;el.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);restart();});
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;restart();});
    const move=(e:PointerEvent)=>{const b=el.getBoundingClientRect();px=e.clientX-b.left;py=e.clientY-b.top;tx=px/b.width*2-1;ty=py/b.height*2-1;pointerInside=e.pointerType!=='touch';};
    const leave=()=>{tx=ty=0;pointerInside=false;};
    const pulse=()=>{if(!pauseRef.current&&!reduced.matches)burst=1;};
    wake.current=restart;
    resize.observe(el);observer.observe(el);
    el.addEventListener('pointermove',move);el.addEventListener('pointerleave',leave);el.addEventListener('pointerdown',pulse);
    document.addEventListener('visibilitychange',restart);reduced.addEventListener('change',restart);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();el.removeEventListener('pointermove',move);el.removeEventListener('pointerleave',leave);el.removeEventListener('pointerdown',pulse);document.removeEventListener('visibilitychange',restart);reduced.removeEventListener('change',restart);};
  },[scale,haloScale,orbit]);
  useEffect(()=>wake.current(),[paused]);
  return <div className="signal-scene"><canvas ref={canvas} aria-hidden="true"/>{controlledPaused===undefined&&<div className="scene-controls"><span>{t('独立协作，相互成就。','Independent agents. Shared achievements.')}</span><button className="motion-toggle" aria-label={paused?t('播放品牌动效','Play brand animation'):t('暂停品牌动效','Pause brand animation')} aria-pressed={paused} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={13}/>:<Pause size={13}/>}</button></div>}</div>;
}
