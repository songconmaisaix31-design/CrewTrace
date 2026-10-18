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
    // 固定几何只计算一次，逐帧只旋转与投影。
    const samples=Array.from({length:181},(_,p)=>{
      const a=p/180*Math.PI*2;
      return {a,x:Math.cos(a),y:Math.sin(a),braidSin:Math.sin(a*3),braidCos:Math.cos(a*3)};
    });
    const draw = (now:number) => {
      frame=0;
      const delta=Math.min((now-last)/1000,.05);last=now;
      const moving=!pauseRef.current && !reduced.matches && visible && !document.hidden;
      const follow=1-Math.exp(-delta*7);
      if(moving){tick+=delta*.75;mx+=(tx-mx)*follow;my+=(ty-my)*follow;burst*=Math.exp(-delta*2.2);}
      el.dataset.phase=String(tick);
      ctx.clearRect(0,0,width,height);
      const radius=Math.min(width*(width<600?.315:.33),height*.32)*scale*(1+Math.sin(tick*.6)*.018+burst*.045);
      const cx=width*.5+mx*6, cy=height*.48+my*5;
      const halo=ctx.createRadialGradient(cx,cy,radius*.35,cx,cy,radius*haloScale);
      halo.addColorStop(0,'rgba(120,67,220,0)');
      halo.addColorStop(.52,'rgba(145,91,245,.15)');
      halo.addColorStop(.72,'rgba(186,142,255,.085)');
      halo.addColorStop(1,'rgba(120,67,220,0)');
      ctx.fillStyle=halo;ctx.fillRect(0,0,width,height);
      ctx.globalCompositeOperation='source-over';
      const paths:{points:{x:number;y:number}[];depth:number;bright:boolean;highlight:number}[]=[];
      const orbitShape:{x:number;y:number}[]=[];
      const tilt=.86+my*.07+Math.sin(tick*.24)*.035;
      const yaw=-.38+mx*.08;
      const roll=1.22+Math.sin(tick*.2)*.035;
      const ct=Math.cos(tilt),st=Math.sin(tilt),cr=Math.cos(roll),sr=Math.sin(roll),
        co=Math.cos(yaw),so=Math.sin(yaw);
      for(let band=0;band<38;band++){
        const phase=band/38*Math.PI*2;
        const sb=Math.sin(phase+tick*.7),cb=Math.cos(phase+tick*.7);
        for(let segment=0;segment<12;segment++){
        const points:{x:number;y:number}[]=[];
        let meanDepth=0;
        for(let p=segment*15;p<=segment*15+15;p++){
          const sample=samples[p];
          const r=radius*(1+(sample.braidCos*cb-sample.braidSin*sb)*(.19+burst*.04));
          const x=sample.x*r,y=sample.y*r,z=(sample.braidSin*cb+sample.braidCos*sb)*radius*.23;
          const ry=y*ct-z*st,rz=y*st+z*ct;
          const rx=x*co+rz*so,depth=rz*co-x*so;
          const perspective=1/(1-depth/(radius*5.5));
          const point={x:cx+(rx*cr-ry*sr)*perspective,y:cy+(rx*sr+ry*cr)*perspective};
          points.push(point);meanDepth+=depth/radius;
          if(band===0&&(segment===0||p>segment*15))orbitShape.push(point);
        }
        const a=(segment+.5)/12*Math.PI*2;
        const depth=Math.max(0,Math.min(1,(meanDepth/16+1.2)/2.4));
        const highlight=Math.pow(Math.max(0,Math.cos(a-tick*.85)),18)*(band%6===0?1:.22);
        const bright=band%6===0;
        paths.push({points,depth,bright,highlight});
        }
      }
      const rect=el.getBoundingClientRect();
      orbit.current=orbitShape.map(point=>({x:rect.left+point.x*rect.width/width,y:rect.top+point.y*rect.height/height}));
      paths.sort((a,b)=>a.depth-b.depth);
      for(const {points,depth,bright,highlight} of paths){
        ctx.beginPath();points.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));
        // 前景主线压住交叉的背面线，让倾斜具有可辨认的前后关系。
        if(bright&&depth>.56){ctx.strokeStyle=`rgba(12,9,20,${depth*.72})`;ctx.lineWidth=3;ctx.shadowBlur=0;ctx.stroke();}
        ctx.strokeStyle=`rgba(${Math.round(165+depth*80)},${Math.round(121+depth*119)},255,${Math.min(1,(bright?.3:.12)+depth*(bright?.6:.3)+highlight*.4)})`;
        ctx.lineWidth=(bright?.85:.45)+depth*.65+highlight*.65;
        ctx.shadowColor='#c4a2ff';ctx.shadowBlur=bright&&highlight>.35?9:0;ctx.stroke();
      }
      ctx.shadowBlur=0;
      ctx.globalCompositeOperation='source-over';
      // 对已绘制的真实光环局部采样放大，边缘渐隐，离开后平滑恢复。
      if(moving)lensStrength+=((pointerInside?1:0)-lensStrength)*(1-Math.exp(-delta*10));
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
