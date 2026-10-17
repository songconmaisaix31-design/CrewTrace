import { type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, FileText, Check, ChevronDown } from 'lucide-react';
import SignalScene from './SignalScene';

type Props = {sample:'round-1'|'round-2';onSample:(sample:'round-1'|'round-2')=>void;unavailable:string;onPreview:()=>void;onStart:()=>void;onHistory:()=>void;collaboration:ReactNode};
export default function LandingExperience({sample,onSample,unavailable,onPreview,onStart,onHistory,collaboration}:Props) {
  return <div className="experience">
    <section className="launch-layout" aria-label="开始协作">
      <div className="launch-story">
        <div className="hero-copy">
        <p className="launch-kicker">co-vibe <span>/</span> 协作有迹可循</p>
        <h1>以履历驱动的<br/><span>Agent 协作网络</span></h1>
        <p className="launch-promise">让这次合作的成果，成为下次分工的依据。</p>
        </div>
        <div className="launch-art"><SignalScene/></div>
        <a className="journey-link" href="#analysis">向下探索 <ChevronDown size={16}/></a>
      </div>
      <section className="launch-form" aria-labelledby="launch-title" id="analysis">
        <div className="launch-form-intro"><div className="launch-form-heading"><span>业务数据分析</span></div>
        <h2 id="launch-title">从一份数据开始。</h2>
        <p className="launch-explain">选择示例，查看 Agent 如何协作生成报告。</p></div>
        <div className="launch-inputs">
        <div className="launch-choice" role="group" aria-label="选择合成示例数据">{(['round-1','round-2'] as const).map((item,index)=><button key={item} aria-pressed={sample===item} className={sample===item?'selected':''} onClick={()=>onSample(item)}><span>示例数据 0{index+1}</span>{sample===item&&<Check size={15}/>}</button>)}</div>
        <div className="launch-file"><FileText size={26}/><div><strong>{sample}.csv</strong><p>合成示例数据 · 不含真实经营信息</p></div><button aria-label="预览数据" onClick={onPreview}><ArrowUpRight size={21}/></button></div>
        <button className="primary launch-submit" disabled={Boolean(unavailable)} onClick={onStart}>开始分析 <ArrowRight size={20}/></button>
        <p className="launch-availability">{unavailable||'凭访问码开始，提交后等待分工。'}</p>
        <button className="launch-history" onClick={onHistory}>查看分析记录 <ArrowUpRight size={15}/></button>
        </div>
      </section>
    </section>
    {collaboration}
  </div>;
}
