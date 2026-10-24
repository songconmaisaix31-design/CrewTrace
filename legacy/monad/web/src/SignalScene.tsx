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
  const {orbit,aperture}=useExperienceNavigation();
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
      if(moving)lensStrength+=((pointerInside?1:0)-lensStrength)*(1-Math.exp(-delta*10));
      el.dataset.phase=String(tick);
      ctx.clearRect(0,0,width,height);
      // 呼吸主要通过光表现，轮廓只做轻微起伏，避免整体反复鼓胀。
      const breath=(1-Math.cos(tick*1.23))*.5;
      const radius=Math.min(width*(width<600?.315:.33),height*.32)*scale*(1+breath*.012+burst*.025);
      const cx=width*.5+mx*6, cy=height*.48+my*5;
      const halo=ctx.createRadialGradient(cx,cy,radius*.4,cx,cy,radius*haloScale*(.9+breath*.1));
      halo.addColorStop(0,'rgba(120,67,220,0)');
      halo.addColorStop(.52,`rgba(145,91,245,${.075+breath*.07})`);
      halo.addColorStop(.72,`rgba(186,142,255,${.025+breath*.025})`);
      halo.addColorStop(1,'rgba(120,67,220,0)');
      ctx.fillStyle=halo;ctx.fillRect(0,0,width,height);
      ctx.globalCompositeOperation='source-over';
      const paths:{points:{x:number;y:number}[];depth:number;bright:boolean;highlight:number;proximity:number;band:number;segment:number;sweep:number}[]=[];
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
        // 用环面朝向计算固定光源反射，几何旋转时高光自然变化。
        const tube=a*3+phase+tick*.7;
        const nx=Math.cos(a)*Math.cos(tube),ny=Math.sin(a)*Math.cos(tube),nz=Math.sin(tube);
        const normalY=ny*ct-nz*st,normalZ=ny*st+nz*ct;
        const normalX=nx*co+normalZ*so,normalDepth=normalZ*co-nx*so;
        const lighting=Math.max(0,(normalX*cr-normalY*sr)*-.32+(normalX*sr+normalY*cr)*-.44+normalDepth*.84);
        const specular=Math.pow(lighting,14);
        const highlight=(specular*.75+Math.pow(Math.max(0,Math.cos(a-tick*.72-phase*.12)),8)*.45)*(band%6===0?1:.18);
        const bright=band%6===0;
        const middle=points[8],reach=Math.min(radius*.65,160);
        const proximity=lensStrength*Math.exp(-((middle.x-px)**2+(middle.y-py)**2)/(reach*reach));
        const sweepPhase=tick*.9;
        const sweep=Math.pow(Math.max(0,Math.cos(a-sweepPhase)),14)*Math.pow(.5+.5*Math.sin(tick*.9),4);
        paths.push({points,depth,bright,highlight,proximity,band,segment,sweep});
        }
      }
      const rect=el.getBoundingClientRect();
      orbit.current=orbitShape.map(point=>({x:rect.left+point.x*rect.width/width,y:rect.top+point.y*rect.height/height}));
      // 将同一帧的倾斜投影传给文字透镜，折射边缘跟随真实圆环。
      const apertureRadius=radius*.82;
      aperture.current={
        center:{x:rect.left+cx*rect.width/width,y:rect.top+cy*rect.height/height},
        axisX:{x:co*cr*apertureRadius*rect.width/width,y:co*sr*apertureRadius*rect.height/height},
        axisY:{x:(st*so*cr-ct*sr)*apertureRadius*rect.width/width,y:(st*so*sr+ct*cr)*apertureRadius*rect.height/height},
        breath,
        sweepPhase:tick*.9,
      };
      paths.sort((a,b)=>a.depth-b.depth);
      for(const {points,depth,bright,highlight,proximity,band,segment,sweep} of paths){
        ctx.beginPath();points.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));
        // 前景主线压住交叉的背面线，让倾斜具有可辨认的前后关系。
        if(bright&&depth>.56){ctx.strokeStyle=`rgba(12,9,20,${depth*.72})`;ctx.lineWidth=3;ctx.shadowBlur=0;ctx.stroke();}
        const headAngle=((tick*(24+band*.32)+band*4+Math.sin(tick*.9+band)*5)/180)*Math.PI*2;
        const signal=band%12===0?Math.pow(Math.max(0,Math.cos((segment+.5)/12*Math.PI*2-headAngle+.12)),60):0;
        const light=Math.min(1,highlight*.86*(.84+breath*.28)+proximity*.85+sweep*.4+signal*.55);
        ctx.strokeStyle=`rgba(${Math.min(255,Math.round(165+depth*65+light*38))},${Math.min(255,Math.round(121+depth*100+light*48))},255,${Math.min(1,(bright?.32:.08)+depth*(bright?.54:.23)+breath*.04+light*(bright?.48:.26))})`;
        ctx.lineWidth=(bright?1.02:.34)+depth*(bright?.65:.4)+light*(bright?.85:.35);
        ctx.shadowColor='#d8c4ff';ctx.shadowBlur=bright?Math.round(light*13):0;ctx.stroke();
        // 光点和渐隐尾迹直接沿已投影的环线运动，并参与前后遮挡。
        if(band%12===0){
          const head=((tick*(24+band*.32)+band*4+Math.sin(tick*.9+band)*5)%180+180)%180;
          ctx.shadowColor='#cbb8ff';ctx.shadowBlur=8;
          for(let index=1;index<points.length;index++){
            const sample=segment*15+index;
            const behind=(head-sample+180)%180;
            if(behind>13)continue;
            const fade=(1-behind/13)**2;
            ctx.beginPath();ctx.moveTo(points[index-1].x,points[index-1].y);ctx.lineTo(points[index].x,points[index].y);
            ctx.strokeStyle=`rgba(207,186,255,${fade*(.25+depth*.65)})`;ctx.lineWidth=1+fade*1.4;ctx.stroke();
          }
          const localHead=head-segment*15;
          if(localHead>=0&&localHead<15){
            const index=Math.floor(localHead),fraction=localHead-index;
            const x=points[index].x+(points[index+1].x-points[index].x)*fraction;
            const y=points[index].y+(points[index+1].y-points[index].y)*fraction;
            ctx.beginPath();ctx.arc(x,y,1.2+depth*1.1,0,Math.PI*2);
            ctx.fillStyle=`rgba(248,244,255,${.35+depth*.65})`;ctx.shadowBlur=14;ctx.fill();
          }
          ctx.shadowBlur=0;
        }
      }
      ctx.shadowBlur=0;
      ctx.globalCompositeOperation='source-over';
      // 对已绘制的真实光环局部采样放大，边缘渐隐，离开后平滑恢复。
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
