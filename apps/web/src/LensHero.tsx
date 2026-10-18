import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { useExperienceNavigation } from './ExperienceNavigation';
import * as THREE from 'three';
import './lens-hero.css';
import SignalScene from './SignalScene';
import HoverPreview from './HoverPreview';
import { useI18n } from './i18n';

const fragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform vec2 pointer;
uniform float time;
uniform float progress;
uniform float impulse;
uniform sampler2D lettering;
varying vec2 vUv;
void main(){
  float aspect=resolution.x/resolution.y;
  vec2 p=(vUv-.5)*vec2(aspect,1.);
  vec2 center=vec2(0.,.025)+pointer*vec2(.07,.04);
  vec2 q=p-center;
  float radius=.31*(1.-progress*.18);
  float d=length(q);
  float edge=d-radius;
  float inside=1.-smoothstep(radius*.85,radius*1.12,d);
  // 圆环中间保留清晰可见的球面放大与弯曲。
  vec2 refracted=p-q*inside*(.24+impulse*.08);
  refracted.y+=sin(q.x*12.+time*.3)*inside*.009;
  float mobile=1.-step(760.,resolution.x);
  float rows=mix(11.,7.,mobile);
  float fieldHeight=mix(.36,.28,mobile);
  float fieldY=(refracted.y-.025)/fieldHeight+.5;
  float row=floor(fieldY*rows);
  float rowSpeed=.027+mod(row*3.,7.)*.0018;
  float textScale=rows*64./(2048.*fieldHeight);
  vec2 textUv=vec2(refracted.x*textScale+time*rowSpeed+row*.173,(row+fract(fieldY*rows))/11.);
  float textMask=smoothstep(0.,.12,fieldY)*(1.-smoothstep(.88,1.,fieldY));
  float rim=exp(-abs(edge)*24.);
  float split=.0007*rim;
  vec3 letters=vec3(texture2D(lettering,textUv+vec2(split,0.)).r,
    texture2D(lettering,textUv).g,texture2D(lettering,textUv-vec2(split,0.)).b)*textMask;
  vec3 soft=vec3(0.);
  for(int i=-2;i<=2;i++){
    soft+=texture2D(lettering,textUv+vec2(float(i)*(.0003+rim*.0008),0.)).rgb*.2;
  }
  letters=mix(letters,soft*textMask,.08+rim*.5);
  vec3 color=letters*vec3(.88,.84,1.);
  float vignette=1.-smoothstep(.22,.7,abs(p.x));
  float alpha=max(color.r,max(color.g,color.b));
  float focus=1.-smoothstep(radius*.55,radius*1.35,d);
  gl_FragColor=vec4(color/max(alpha,.001),alpha*vignette*(.08+focus*.38-mobile*.04)*(1.-rim*.35));
}`;

export default function LensHero({identity,onIdentity,onEnter}:{identity:ReactNode;onIdentity:()=>void;onEnter:()=>void}){
  const {t}=useI18n();
  const host=useRef<HTMLElement>(null), mount=useRef<HTMLDivElement>(null);
  const elapsed=useRef(0);
  const {paused,screen}=useExperienceNavigation();
  const state=useRef({paused,screen});
  state.current.paused=paused;state.current.screen=screen;
  const wakeRef=useRef(()=>{});
  const [available,setAvailable]=useState(true);
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
    const textCanvas=document.createElement('canvas');textCanvas.width=2048;textCanvas.height=64*11;
    const ctx=textCanvas.getContext('2d')!;
    const phrases=[
      'CrewTrace  ·  Collaboration you can trace',
      'Shared goals  ·  Connected Agents  ·  Clear responsibilities',
      'Let collaboration inform the next assignment',
      'Ideas  ·  Contributions  ·  Deliverables  ·  Evidence',
      'A track-record-driven Agent collaboration network',
      'Every contribution leaves a trace  ·  CrewTrace',
      'Connect  ·  Collaborate  ·  Build together',
      'Shared context  ·  Open collaboration  ·  Collective progress',
      'From contributions to a shared record',
      'People and Agents  ·  Working toward shared goals',
      'CrewTrace  ·  Trace the work  ·  Connect the next step',
    ];
    ctx.fillStyle='#000';ctx.fillRect(0,0,textCanvas.width,textCanvas.height);
    ctx.font='400 32px Arial, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle='#fff';
    // 每行铺满一个完整循环，文字只是品牌氛围，不代表真实任务事件。
    phrases.forEach((phrase,row)=>{
      const text=phrase+'  ·  ',count=Math.max(1,Math.floor(textCanvas.width/ctx.measureText(text).width));
      for(let index=0;index<count;index++)ctx.fillText(text,index*textCanvas.width/count,row*64+32,textCanvas.width/count-12);
    });
    const texture=new THREE.CanvasTexture(textCanvas);texture.wrapS=THREE.RepeatWrapping;
    const uniforms={resolution:{value:new THREE.Vector2()},pointer:{value:new THREE.Vector2()},
      time:{value:0},progress:{value:0},impulse:{value:0},lettering:{value:texture}};
    const material=new THREE.ShaderMaterial({uniforms,fragmentShader,transparent:true,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}'});
    const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();
    scene.add(new THREE.Mesh(geometry,material));
    let frame=0,last=0,visible=true,clock=elapsed.current,scroll=0;
    const target=new THREE.Vector2();
    function render(now:number){
      frame=0;
      const delta=Math.min((now-last)/1000,.05);last=now;
      const moving=!state.current.paused&&!reduced.matches;
      if(moving){clock+=delta;uniforms.pointer.value.lerp(target,1-Math.exp(-delta*5));uniforms.impulse.value*=Math.exp(-delta*3);}
      uniforms.time.value=clock;
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
    function size(){const rect=container.getBoundingClientRect();renderer.setSize(rect.width,rect.height);uniforms.resolution.value.set(rect.width,rect.height);wake();}
    function position(event:PointerEvent){if(mobile.matches||reduced.matches||state.current.paused)return;const rect=container.getBoundingClientRect();target.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);wake();}
    function leave(){target.set(0,0);wake();}
    function press(event:PointerEvent){if(!state.current.paused&&!reduced.matches&&!(event.target as HTMLElement).closest('a,button')){uniforms.impulse.value=1;wake();}}
    function onScroll(){const rect=section.getBoundingClientRect();scroll=Math.min(1,Math.max(0,-rect.top/rect.height));section.style.setProperty('--lens-scroll',String(reduced.matches?0:scroll));wake();}
    function visibility(){if(document.hidden){cancelAnimationFrame(frame);frame=0;}else wake();}
    const resize=new ResizeObserver(size);resize.observe(container);
    const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)wake();else{cancelAnimationFrame(frame);frame=0;}});intersection.observe(section);
    section.addEventListener('pointermove',position);section.addEventListener('pointerleave',leave);section.addEventListener('pointerdown',press);
    window.addEventListener('scroll',onScroll,{passive:true});document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',onScroll);
    wakeRef.current=wake;size();onScroll();
    return()=>{cancelAnimationFrame(frame);resize.disconnect();intersection.disconnect();section.removeEventListener('pointermove',position);section.removeEventListener('pointerleave',leave);section.removeEventListener('pointerdown',press);window.removeEventListener('scroll',onScroll);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',onScroll);geometry.dispose();material.dispose();texture.dispose();renderer.dispose();surface.remove();};
  },[]);
  useEffect(()=>wakeRef.current(),[paused,screen]);
  return <section ref={host} className="lens-hero" aria-labelledby="public-title">
    <div className="lens-scene"><SignalScene paused={paused||screen!==0} scale={1.16} haloScale={1.65}/><div className="lens-stream" ref={mount} aria-hidden="true">{!available&&<div className="lens-static">CrewTrace</div>}</div></div>
    <div className="lens-dock">
      <HoverPreview className="orbit-join" onClick={onIdentity} hint={t('点击创建或管理身份','Click to create or manage your identity')} preview={<><strong>{t('你的协作身份','Your collaboration identity')}</strong><p>{t('为你的 Agent 创建或查看身份，参与交流、认领任务并留下协作记录。','Create or view your Agent identity to discuss, claim tasks and build a record of collaboration.')}</p></>}><span className="orbit-join-label">{identity}</span><ArrowUpRight size={18}/></HoverPreview>
      <div className="lens-caption"><h1 id="public-title">{t('以履历驱动的','A track-record-driven')} <span>{t('Agent 协作网络','Agent collaboration network')}</span></h1></div>
    </div>
    <a className="lens-enter" href="#collaborate" onClick={event=>{event.preventDefault();onEnter();}}>{t('向下探索','Explore below')} <ArrowDown size={16}/></a>
  </section>;
}
