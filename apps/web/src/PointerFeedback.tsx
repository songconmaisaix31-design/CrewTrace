import { useEffect, useRef } from 'react';

export default function PointerFeedback() {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const ring=ref.current!;
    const media=matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)');
    let x=0,y=0,tx=0,ty=0,tailX=0,tailY=0,frame=0,started=false;
    const tail=ring.querySelector('b')!;
    const draw=()=>{
      x+=(tx-x)*.2;y+=(ty-y)*.2;tailX+=(tx-tailX)*.075;tailY+=(ty-tailY)*.075;
      ring.style.transform=`translate3d(${x}px,${y}px,0)`;
      tail.style.transform=`translate3d(${tailX-x}px,${tailY-y}px,0)`;
      if(Math.abs(tx-tailX)+Math.abs(ty-tailY)>.1)frame=requestAnimationFrame(draw);else frame=0;
    };
    const move=(event:PointerEvent)=>{
      if(!media.matches||event.pointerType==='touch')return;
      tx=event.clientX;ty=event.clientY;
      if(!started){x=tailX=tx;y=tailY=ty;started=true;}
      const target=event.target as Element;
      ring.dataset.active=String(Boolean(target.closest('button:not(:disabled),a,summary,canvas')));
      ring.dataset.visible=String(!target.closest('dialog,input,textarea,pre'));
      if(!frame)frame=requestAnimationFrame(draw);
    };
    const hide=()=>{ring.dataset.visible='false';started=false;cancelAnimationFrame(frame);frame=0;};
    const click=(e:PointerEvent)=>{
      if(!media.matches||e.pointerType==='touch'||(e.target as Element).closest('dialog,input,textarea,button:disabled'))return;
      const ripple=ring.querySelector('i')!;
      ripple.getAnimations().forEach(a=>a.cancel());
      ripple.animate([{transform:'scale(.4)',opacity:1},{transform:'scale(4.5)',opacity:0}],{duration:900,easing:'cubic-bezier(.2,.6,.2,1)'});
    };
    document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerdown',click);document.documentElement.addEventListener('pointerleave',hide);window.addEventListener('blur',hide);media.addEventListener('change',hide);
    return()=>{hide();document.removeEventListener('pointermove',move);document.removeEventListener('pointerdown',click);document.documentElement.removeEventListener('pointerleave',hide);window.removeEventListener('blur',hide);media.removeEventListener('change',hide);};
  },[]);
  return <><div className="scroll-position" aria-hidden="true"/><div className="pointer-orbit" ref={ref} aria-hidden="true"><b/><span/><i/></div></>;
}
