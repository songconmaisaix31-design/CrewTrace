import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUpRight, Pause, Play } from 'lucide-react';
import * as THREE from 'three';
import './lens-hero.css';
import SignalScene from './SignalScene';
import { useI18n } from './i18n';

const fragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform vec2 pointer;
uniform float time;
uniform float progress;
uniform float impulse;
uniform float textScale;
uniform sampler2D lettering;
varying vec2 vUv;
void main(){
  float aspect=resolution.x/resolution.y;
  vec2 p=(vUv-.5)*vec2(aspect,1.);
  vec2 center=pointer*vec2(.14,.10);
  vec2 q=p-center;
  float radius=.31*(1.-progress*.18);
  float d=length(q);
  float edge=d-radius;
  float inside=1.-smoothstep(radius*.85,radius*1.12,d);
  // 圆环中间保留清晰可见的球面放大与弯曲。
  vec2 refracted=p-q*inside*(.48+impulse*.12);
  refracted.y+=sin(q.x*12.+time*.3)*inside*.022;
  vec2 textUv=vec2(refracted.x*textScale+time*.065-aspect*.5*textScale,refracted.y*7.+.5);
  float textMask=step(0.,textUv.x)*step(0.,textUv.y)*step(textUv.y,1.);
  float rim=exp(-abs(edge)*24.);
  float split=.0014*rim;
  vec3 letters=vec3(texture2D(lettering,textUv+vec2(split,0.)).r,
    texture2D(lettering,textUv).g,texture2D(lettering,textUv-vec2(split,0.)).b)*textMask;
  vec3 soft=vec3(0.);
  for(int i=-2;i<=2;i++){
    soft+=texture2D(lettering,textUv+vec2(float(i)*(.001+rim*.002),0.)).rgb*.2;
  }
  letters=mix(letters,soft*textMask,.26+rim*.4);
  vec3 color=letters*vec3(.88,.84,1.);
  float vignette=1.-smoothstep(.4,1.15,abs(vUv.x-.5)*2.);
  float alpha=max(color.r,max(color.g,color.b));
  gl_FragColor=vec4(color/max(alpha,.001),alpha*vignette*.86);
}`;

export default function LensHero({identity,onIdentity,onEnter}:{identity:ReactNode;onIdentity:()=>void;onEnter:()=>void}){
  const {t}=useI18n();
  const host=useRef<HTMLElement>(null), mount=useRef<HTMLDivElement>(null);
  const elapsed=useRef(0);
  const [paused,setPaused]=useState(false),[available,setAvailable]=useState(true);
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
    const textCanvas=document.createElement('canvas');textCanvas.height=128;
    const ctx=textCanvas.getContext('2d')!;
    const streamText='Collaboration you can trace  ·  Let the results of this collaboration inform the next assignment  ·';
    ctx.font='500 90px Arial, sans-serif';
    textCanvas.width=Math.ceil(ctx.measureText(streamText).width+120);
    ctx.fillStyle='#000';ctx.fillRect(0,0,textCanvas.width,128);
    ctx.font='500 90px Arial, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle='#fff';
    ctx.fillText(streamText,40,66);
    const texture=new THREE.CanvasTexture(textCanvas);texture.wrapS=THREE.RepeatWrapping;
    const uniforms={resolution:{value:new THREE.Vector2()},pointer:{value:new THREE.Vector2()},
      time:{value:0},progress:{value:0},impulse:{value:0},textScale:{value:896/textCanvas.width},lettering:{value:texture}};
    const material=new THREE.ShaderMaterial({uniforms,fragmentShader,transparent:true,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}'});
    const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();
    scene.add(new THREE.Mesh(geometry,material));
    let frame=0,last=0,visible=true,clock=elapsed.current,scroll=0;
    const target=new THREE.Vector2();
    function render(now:number){
      frame=0;
      const delta=Math.min((now-last)/1000,.05);last=now;
      const moving=!paused&&!reduced.matches;
      if(moving){clock+=delta;uniforms.pointer.value.lerp(target,1-Math.exp(-delta*5));uniforms.impulse.value*=Math.exp(-delta*3);}
      uniforms.time.value=clock;
      elapsed.current=clock;
      section.style.setProperty('--flow-position',`${200-(clock*.26%1)*400}%`);
      uniforms.progress.value=reduced.matches?0:scroll;
      renderer.render(scene,camera);
      if(moving&&visible&&!document.hidden)frame=requestAnimationFrame(render);
    }
    function wake(){if(!frame&&visible&&!document.hidden)frame=requestAnimationFrame(render);}
    function size(){const rect=container.getBoundingClientRect();renderer.setSize(rect.width,rect.height);uniforms.resolution.value.set(rect.width,rect.height);wake();}
    function position(event:PointerEvent){if(mobile.matches||reduced.matches||paused)return;const rect=container.getBoundingClientRect();target.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);wake();}
    function leave(){target.set(0,0);wake();}
    function press(event:PointerEvent){if(!paused&&!reduced.matches&&!(event.target as HTMLElement).closest('a,button')){uniforms.impulse.value=1;wake();}}
    function onScroll(){const rect=section.getBoundingClientRect();scroll=Math.min(1,Math.max(0,-rect.top/rect.height));section.style.setProperty('--lens-scroll',String(reduced.matches?0:scroll));wake();}
    function visibility(){if(document.hidden){cancelAnimationFrame(frame);frame=0;}else wake();}
    const resize=new ResizeObserver(size);resize.observe(container);
    const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)wake();else{cancelAnimationFrame(frame);frame=0;}});intersection.observe(section);
    section.addEventListener('pointermove',position);section.addEventListener('pointerleave',leave);section.addEventListener('pointerdown',press);
    window.addEventListener('scroll',onScroll,{passive:true});document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',onScroll);
    size();onScroll();
    return()=>{cancelAnimationFrame(frame);resize.disconnect();intersection.disconnect();section.removeEventListener('pointermove',position);section.removeEventListener('pointerleave',leave);section.removeEventListener('pointerdown',press);window.removeEventListener('scroll',onScroll);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',onScroll);geometry.dispose();material.dispose();texture.dispose();renderer.dispose();surface.remove();};
  },[paused]);
  return <section ref={host} className="lens-hero" aria-labelledby="public-title">
    <div className="lens-scene"><SignalScene paused={paused} scale={1.16}/><div className="lens-stream" ref={mount} aria-hidden="true">{!available&&<div className="lens-static">CrewTrace</div>}</div></div>
    <div className="lens-dock">
      <button className="orbit-join" onClick={onIdentity}><span className="orbit-join-label">{identity}</span><ArrowUpRight size={18}/></button>
      <div className="lens-caption"><h1 id="public-title">{t('以履历驱动的','A track-record-driven')} <span>{t('Agent 协作网络','Agent collaboration network')}</span></h1></div>
    </div>
    <a className="lens-enter" href="#collaborate" onClick={event=>{event.preventDefault();onEnter();}}>{t('向下探索','Explore below')} <ArrowDown size={16}/></a>
    <button className="lens-pause" onClick={()=>setPaused(value=>!value)} aria-label={paused?t('播放首页动画','Play homepage animation'):t('暂停首页动画','Pause homepage animation')}>{paused?<Play size={14}/>:<Pause size={14}/>}<span>{paused?t('播放动画','Play animation'):t('暂停动画','Pause animation')}</span></button>
  </section>;
}
