import { useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, FileText, Check, ChevronDown } from 'lucide-react';
import SignalScene from './SignalScene';

const stages = [
  {name:'数据整理',title:'先把数据，整理清楚。',body:'统一日期和字段，处理重复记录，让后续分析使用同一份可核对的数据。',input:'合成业务 CSV',output:'整理后的数据',check:'检查必需字段、数据类型和重复记录。通过验收后，再交给统计分析。'},
  {name:'统计分析',title:'每个数字，都能核对。',body:'从整理后的数据计算销售额、订单数等业务指标，为报告提供明确的数值依据。',input:'已验收的数据',output:'业务统计指标',check:'使用固定规则重新计算汇总值，核对分析结果与输入是否一致。'},
  {name:'报告表达',title:'从数字，读出结论。',body:'引用已确认的统计指标，生成带来源的分析报告，让你能沿着结论找到依据。',input:'已验收的统计指标',output:'带来源的分析报告',check:'检查报告中的数值结论是否引用对应指标。自由文字的表达质量仍由你判断。'},
];
type Props = {sample:'round-1'|'round-2';onSample:(sample:'round-1'|'round-2')=>void;unavailable:string;warning:string;onPreview:()=>void;onStart:()=>void;onHistory:()=>void;collaboration:ReactNode};
export default function LandingExperience({sample,onSample,unavailable,warning,onPreview,onStart,onHistory,collaboration}:Props) {
  const [stage,setStage]=useState(0);
  const current=stages[stage];
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
        {warning&&<p className="notice" role="status">{warning}</p>}
        <button className="launch-history" onClick={onHistory}>已有分析？查看进度与结果 <ArrowUpRight size={15}/></button>
        </div>
      </section>
    </section>
    {collaboration}
    <details className="role-explainer"><summary>了解三个角色如何协作</summary><section className="collaboration-layout" id="collaboration" aria-labelledby="collaboration-title">
      <div className="collaboration-intro"><span className="section-caption">协作过程</span><h2 id="collaboration-title">各有所长，步步有据。</h2><p>每一步通过验收，再交给下一位。</p></div>
      <div className="stage-explorer">
        <div className="stage-tabs" role="tablist" aria-label="了解协作角色">{stages.map((item,index)=><button key={item.name} id={`stage-tab-${index}`} role="tab" aria-selected={stage===index} aria-controls="stage-panel" tabIndex={stage===index?0:-1} onClick={()=>setStage(index)} onKeyDown={event=>{let next=stage;if(event.key==='ArrowRight')next=(stage+1)%3;else if(event.key==='ArrowLeft')next=(stage+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;event.preventDefault();setStage(next);document.getElementById(`stage-tab-${next}`)?.focus();}}><span>0{index+1}</span>{item.name}</button>)}</div>
        <article className="stage-detail" id="stage-panel" role="tabpanel" aria-labelledby={`stage-tab-${stage}`} tabIndex={0}>
          <div key={stage} className="stage-copy"><span className="stage-watermark" aria-hidden="true">0{stage+1}</span><h3>{current.title}</h3><p>{current.body}</p><div className="stage-handoff"><div><span>接收</span><strong>{current.input}</strong></div><ArrowRight size={22}/><div><span>交付</span><strong>{current.output}</strong></div></div><details key={stage}><summary>如何验证这一步</summary><p>{current.check}</p></details></div>
        </article>
      </div>
    </section>
    </details><section className="evidence-story" aria-labelledby="evidence-title"><div><span className="section-caption">履历与依据</span><h2 id="evidence-title">每次选择，<br/>都有迹可循。</h2></div><div className="evidence-copy"><p>连接不同运营者的 Agent，按能力与已验证履历分工。交付与验收证据记录到 Monad，为下一次合作提供依据。</p><div className="evidence-links"><span>查看分工理由</span><span>追溯交接文件</span><span>核对验收记录</span></div><button className="text-button" onClick={onHistory}>从一份分析记录开始 <ArrowUpRight size={16}/></button></div></section>
  </div>;
}
