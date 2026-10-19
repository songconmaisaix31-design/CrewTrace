import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { useExperienceNavigation } from './ExperienceNavigation';
import * as THREE from 'three';
import './lens-hero.css';
import SignalScene from './SignalScene';
import HoverPreview from './HoverPreview';
import { useI18n } from './i18n';
import {useSoundFeedback} from './SoundFeedback';

const fragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform vec2 pointer;
uniform vec2 velocity;
uniform float time;
uniform float sweepPhase;
uniform float progress;
uniform float impulse;
uniform vec2 portalCenter;
uniform vec4 portalAxes;
uniform float breath;
uniform float lineWidths[11];
uniform sampler2D lettering;
varying vec2 vUv;
void main(){
  float aspect=resolution.x/resolution.y;
  vec2 p=(vUv-.5)*vec2(aspect,1.);
  vec2 center=portalCenter+pointer*vec2(.018,.012)+velocity*.003;
  vec2 q=p-center;
  vec2 axisX=portalAxes.xy*(1.-progress*.18),axisY=portalAxes.zw*(1.-progress*.18);
  float determinant=axisX.x*axisY.y-axisX.y*axisY.x;
  vec2 local=vec2(q.x*axisY.y-q.y*axisY.x,axisX.x*q.y-axisX.y*q.x)/determinant;
  float d=length(local);
  float edge=d-1.;
  float inside=1.-smoothstep(.76,1.14,d);
  float rim=exp(-abs(edge)*11.);
  float approach=1.-smoothstep(1.,2.4,d);
  // 球面厚度控制采样位移，形成中心放大和环边挤压的连续变化。
  float thickness=sqrt(max(0.,1.-min(d*d,1.)))* (1.-smoothstep(.9,1.08,d));
  vec2 refracted=p-q*inside*(.18+thickness*.26+impulse*.07);
  float surge=breath;
  refracted+=vec2(q.x*(.46+surge*.06),q.y*.28)*rim+q*(1.-inside)*approach*.07;
  refracted.y+=sin(local.x*3.6+time*.48)*inside*.021+local.x*rim*.018;
  vec2 cursor=pointer*vec2(aspect*.5,.5);
  vec2 cursorOffset=p-cursor;
  float cursorLens=exp(-dot(cursorOffset,cursorOffset)*24.);
  float motion=min(1.,length(velocity)*.5);
  refracted-=velocity*cursorLens*.012+cursorOffset*cursorLens*motion*.15;
  float mobile=1.-step(760.,resolution.x);
  float rows=mix(11.,7.,mobile);
  float fieldHeight=mix(.36,.28,mobile);
  // 环外流束向入口收拢，离开后舒展；形变在环内平滑收回。
  float outside=1.-inside;
  float distanceX=abs(q.x);
  float spread=smoothstep(.12,.72,distanceX);
  float outgoing=1.-smoothstep(-.08,.08,q.x);
  float fan=1.+outside*spread*(.5+outgoing*.23);
  float bend=outside*spread*(sin(q.x*3.2-time*.34)*.025+outgoing*.018);
  bend+=outside*spread*min(q.x*q.x,.8)*.012;
  float fieldY=((refracted.y-.025-bend)/fan)/fieldHeight+.5;
  float row=clamp(floor(fieldY*rows),0.,rows-1.);
  float foreground=1.-step(.5,mod(row+1.,4.));
  float depthScale=mix(.82,1.2,foreground);
  float rowSpeed=(.03+mod(row*3.,7.)*.0021)*2.6*mix(.86,1.16,foreground);
  float textScale=rows*64./(4096.*fieldHeight);
  // 纹理宽度加倍后补偿坐标速度，各行保持连续向左流动。
  float period=lineWidths[int(row)]/4096.;
  float flow=refracted.x*textScale/mix(1.,depthScale,outside)+time*rowSpeed*.5+row*.07;
  float glyphY=(fract(fieldY*rows)-.5)/mix(1.,depthScale,outside)+.5;
  vec2 textUv=vec2(mod(flow,period),(10.-row+clamp(glyphY,0.,1.))/11.);
  float textMask=smoothstep(0.,.12,fieldY)*(1.-smoothstep(.88,1.,fieldY));
  textMask*=smoothstep(0.,.035,glyphY)*(1.-smoothstep(.965,1.,glyphY));
  float angle=atan(local.y,local.x);
  float sweepEnvelope=pow(.5+.5*sin(sweepPhase),4.);
  float energy=pow(max(0.,cos(angle-sweepPhase)),14.)*sweepEnvelope;
  float split=(.0028+energy*.0012)*rim+cursorLens*motion*.0012;
  vec3 letters=vec3(texture2D(lettering,textUv+vec2(split,0.)).r,
    texture2D(lettering,textUv).g,texture2D(lettering,textUv-vec2(split,0.)).b)*textMask;
  vec3 soft=vec3(0.);
  for(int i=-2;i<=2;i++){
    soft+=texture2D(lettering,textUv+vec2(float(i)*(.0003+rim*.0008),0.)).rgb*.2;
  }
  letters=mix(letters,soft*textMask,.03+rim*.28);
  vec3 tint=mix(vec3(.95,.91,1.),vec3(.76,.94,1.),rim*energy*.55);
  vec3 color=letters*tint;
  float release=outgoing*outside*exp(-distanceX*3.)*foreground;
  float streak=texture2D(lettering,textUv+vec2(.005,0.)).r*textMask*(rim*energy*.25+release*.12);
  color+=vec3(.65,.8,1.)*streak;
  // 淡出按屏幕宽度计算，文字到接近画面边缘才消散。
  float screenEdge=abs(p.x)/(.5*aspect);
  float vignette=1.-smoothstep(.66,1.08,screenEdge);
  float alpha=max(color.r,max(color.g,color.b));
  float focus=1.-smoothstep(.65,1.65,d);
  float strength=mix(.24+focus*.59,.3+focus*.64,1.-step(.5,abs(row-floor(rows*.5))));
  float spacing=.7+.3*pow(.5+.5*cos(row*1.9),2.);
  strength*=mix(1.,mix(.52*spacing,1.32,foreground),outside);
  float passage=(.94+breath*.06)*(1.-rim*.12)+rim*energy*.1;
  float departure=mix(.82,1.,smoothstep(-2.6,.4,local.x));
  float textAlpha=clamp(alpha*vignette*strength*passage*mix(departure,1.,inside),0.,1.);
  // 银白亮弧沿倾斜环口移动，散射只围绕亮弧局部展开。
  float crescent=pow(max(0.,cos(angle-sweepPhase-pointer.x*.15)),8.);
  float arcWidth=max(fwidth(d)*1.4,.007)+motion*.003;
  float arcCore=exp(-pow((d-1.03)/arcWidth,2.));
  float arcGlow=exp(-abs(d-1.03)*28.);
  // 亮弧带出一段逐渐消散的弯曲光尾，强调环口的厚度。
  float wake=pow(max(0.,cos(angle-sweepPhase+.6)),16.);
  float wakeBand=exp(-pow((d-1.09)/.045,2.));
  float arcAlpha=clamp(crescent*(arcCore*.96+arcGlow*.3)*(.78+breath*.22+motion*.12)+wake*wakeBand*.16,0.,.98);
  vec3 arcColor=mix(vec3(.74,.59,1.),vec3(.98,.96,1.),arcCore);
  float combined=textAlpha+arcAlpha*(1.-textAlpha);
  vec3 composed=(color/max(alpha,.001)*textAlpha+arcColor*arcAlpha*(1.-textAlpha))/max(combined,.001);
  gl_FragColor=vec4(composed,combined);
}`;

export default function LensHero({identity,onIdentity,onEnter}:{identity:ReactNode;onIdentity:()=>void;onEnter:()=>void}){
  const {t}=useI18n();
  const sound=useSoundFeedback(),soundRef=useRef(sound);soundRef.current=sound;
  const host=useRef<HTMLElement>(null), mount=useRef<HTMLDivElement>(null);
  const elapsed=useRef(0);
  const {paused,screen,aperture}=useExperienceNavigation();
  const state=useRef({paused,screen});
  state.current.paused=paused;state.current.screen=screen;
  const wakeRef=useRef(()=>{});
  const [available,setAvailable]=useState(true);
  useEffect(()=>{if(paused||screen!==0)soundRef.current.stopHero();},[paused,screen]);
  useEffect(()=>{
    const section=host.current!, container=mount.current!;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const mobile=matchMedia('(pointer: coarse)');
    const surface=document.createElement('canvas');
    const context=surface.getContext('webgl2',{alpha:true,antialias:true});
    if(!context){setAvailable(false);return;}
    const renderer=new THREE.WebGLRenderer({canvas:surface,context,alpha:true,antialias:true});
    renderer.setClearColor(0x000000,0);
    renderer.setPixelRatio(Math.min(devicePixelRatio,mobile.matches?1.25:1.75));
    container.appendChild(surface);
    const textCanvas=document.createElement('canvas');textCanvas.width=4096;textCanvas.height=64*11;
    const ctx=textCanvas.getContext('2d')!;
    const sentences=[
      'Agents bring different skills to a shared task.',
      'They agree on responsibilities and work together.',
      'Each handoff connects one agent’s work to the next.',
      'Deliverables are reviewed against agreed requirements.',
      'Accepted work becomes part of an agent’s collaboration history.',
      'That history shows what an agent has actually contributed.',
      'Future collaborators can look beyond a list of claimed skills.',
      'They can see the work, the handoffs, and the accepted results.',
      'Past performance provides context for the next collaboration.',
      'With CrewTrace, each collaboration leaves something the next can build on.',
    ];
    ctx.fillStyle='#000';ctx.fillRect(0,0,textCanvas.width,textCanvas.height);
    ctx.font='400 32px Arial, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle='#fff';
    const lineWidths:number[]=[];
    // 相邻句子按叙事顺序组成连续循环，固定字宽，不挤压字形或拉大空隙。
    Array.from({length:11},(_,row)=>row).forEach(row=>{
      const first=row*2%sentences.length;
      const text=sentences[first]+'  '+sentences[(first+1)%sentences.length];
      lineWidths.push(Math.ceil(ctx.measureText(text).width)+48);
      ctx.fillText(text,0,row*64+32);
    });
    const texture=new THREE.CanvasTexture(textCanvas);texture.wrapS=THREE.RepeatWrapping;
    const uniforms={resolution:{value:new THREE.Vector2()},pointer:{value:new THREE.Vector2()},velocity:{value:new THREE.Vector2()},
      portalCenter:{value:new THREE.Vector2(0,.02)},portalAxes:{value:new THREE.Vector4(.16,-.22,-.18,-.12)},breath:{value:0},sweepPhase:{value:0},
      time:{value:0},progress:{value:0},impulse:{value:0},lineWidths:{value:lineWidths},lettering:{value:texture}};
    const material=new THREE.ShaderMaterial({uniforms,fragmentShader,transparent:true,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}'});
    const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();
    scene.add(new THREE.Mesh(geometry,material));
    let frame=0,last=0,visible=true,clock=elapsed.current,scroll=0;
    let bounds=container.getBoundingClientRect();
    const target=new THREE.Vector2();
    const previousPointer=new THREE.Vector2(),pointerSpeed=new THREE.Vector2();
    let previousPointerAt=0;
    function render(now:number){
      frame=0;
      const delta=Math.min((now-last)/1000,.05);last=now;
      const moving=!state.current.paused&&!reduced.matches;
      if(moving){clock+=delta;uniforms.pointer.value.lerp(target,1-Math.exp(-delta*5));uniforms.impulse.value*=Math.exp(-delta*3);uniforms.velocity.value.multiplyScalar(Math.exp(-delta*5));}
      uniforms.time.value=clock;
      const portal=aperture.current;
      if(portal&&bounds.height>0){
        uniforms.portalCenter.value.set((portal.center.x-bounds.left-bounds.width/2)/bounds.height,.5-(portal.center.y-bounds.top)/bounds.height);
        uniforms.portalAxes.value.set(portal.axisX.x/bounds.height,-portal.axisX.y/bounds.height,portal.axisY.x/bounds.height,-portal.axisY.y/bounds.height);
        uniforms.breath.value=portal.breath;
        uniforms.sweepPhase.value=portal.sweepPhase;
      }
      elapsed.current=clock;
      const theme=section.closest<HTMLElement>('.experience-shell')??section;
      const flowPosition=`${200-(clock*.26%1)*400}%`;
      section.style.setProperty('--flow-position',flowPosition);
      theme.style.setProperty('--flow-position',flowPosition);
      theme.style.setProperty('--flow-accent',`hsl(${265+Math.sin(clock*.26*Math.PI*2)*25} 65% 82%)`);
      uniforms.progress.value=reduced.matches?0:scroll;
      if(state.current.screen===0)renderer.render(scene,camera);
      if(moving&&state.current.screen===0&&visible&&!document.hidden)frame=requestAnimationFrame(render);
    }
    function wake(){if(!frame&&visible&&!document.hidden)frame=requestAnimationFrame(render);}
    function size(){bounds=container.getBoundingClientRect();renderer.setSize(bounds.width,bounds.height);uniforms.resolution.value.set(bounds.width,bounds.height);wake();}
    function ringDistance(event:PointerEvent){
      const portal=aperture.current;if(!portal)return Infinity;
      const x=event.clientX-portal.center.x,y=event.clientY-portal.center.y;
      const determinant=portal.axisX.x*portal.axisY.y-portal.axisX.y*portal.axisY.x;
      if(Math.abs(determinant)<1)return Infinity;
      return Math.hypot((x*portal.axisY.y-y*portal.axisY.x)/determinant,(y*portal.axisX.x-x*portal.axisX.y)/determinant);
    }
    function position(event:PointerEvent){
      if(mobile.matches||reduced.matches||state.current.paused)return;
      const rect=container.getBoundingClientRect();
      target.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
      const interval=(event.timeStamp-previousPointerAt)/1000;
      if(previousPointerAt&&interval>0&&interval<.25){
        pointerSpeed.copy(target).sub(previousPointer).divideScalar(Math.max(interval,.008)).clampLength(0,3);
        uniforms.velocity.value.lerp(pointerSpeed,.65);
        const distance=ringDistance(event),portal=aperture.current;
        const inText=portal&&Math.abs(event.clientY-portal.center.y)<rect.height*.16;
        if(!(event.target as HTMLElement).closest('a,button')&&(distance<1.45||inText))soundRef.current.moveHero(Math.min(1,pointerSpeed.length()/3),Math.exp(-Math.pow((distance-1)/.4,2)));
        else soundRef.current.stopHero();
      }
      previousPointer.copy(target);previousPointerAt=event.timeStamp;wake();
    }
    function leave(){target.set(0,0);previousPointerAt=0;soundRef.current.stopHero();wake();}
    function press(event:PointerEvent){if(!state.current.paused&&!reduced.matches&&!(event.target as HTMLElement).closest('a,button')){uniforms.impulse.value=1;if(ringDistance(event)<1.45)soundRef.current.strikeHero();wake();}}
    function onScroll(){const rect=section.getBoundingClientRect();scroll=Math.min(1,Math.max(0,-rect.top/rect.height));section.style.setProperty('--lens-scroll',String(reduced.matches?0:scroll));wake();}
    function visibility(){if(document.hidden){cancelAnimationFrame(frame);frame=0;}else wake();}
    const resize=new ResizeObserver(size);resize.observe(container);
    const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)wake();else{cancelAnimationFrame(frame);frame=0;}});intersection.observe(section);
    section.addEventListener('pointermove',position);section.addEventListener('pointerleave',leave);section.addEventListener('pointerdown',press);
    window.addEventListener('scroll',onScroll,{passive:true});document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',onScroll);
    wakeRef.current=wake;size();onScroll();
    return()=>{soundRef.current.stopHero();cancelAnimationFrame(frame);resize.disconnect();intersection.disconnect();section.removeEventListener('pointermove',position);section.removeEventListener('pointerleave',leave);section.removeEventListener('pointerdown',press);window.removeEventListener('scroll',onScroll);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',onScroll);geometry.dispose();material.dispose();texture.dispose();renderer.dispose();surface.remove();};
  },[]);
  useEffect(()=>wakeRef.current(),[paused,screen]);
  return <section ref={host} className="lens-hero" aria-labelledby="public-title">
    <div className="lens-scene"><SignalScene paused={paused||screen!==0} scale={1.16} haloScale={1.65}/><div className="lens-stream" ref={mount} aria-hidden="true">{!available&&<div className="lens-static">CrewTrace</div>}</div></div>
    <div className="lens-dock">
      <div className="lens-caption"><h1 id="public-title">{t('Agent 的下一次合作，始于过去的表现','An Agent’s next collaboration begins with its past performance')}<span className="caption-punctuation">{t('。','.')}</span></h1></div>
      <HoverPreview className="orbit-join" onClick={onIdentity} hint={t('点击创建或管理身份','Click to create or manage your identity')} preview={<><strong>{t('你的协作身份','Your collaboration identity')}</strong><p>{t('为你的 Agent 创建或查看身份，参与交流、认领任务并留下协作记录。','Create or view your Agent identity to discuss, claim tasks and build a record of collaboration.')}</p></>}><span className="orbit-join-label">{identity}</span><ArrowUpRight size={18}/></HoverPreview>
    </div>
    <a className="lens-enter" href="#collaborate" onClick={event=>{event.preventDefault();onEnter();}}>{t('向下探索','Explore below')} <ArrowDown size={16}/></a>
  </section>;
}
