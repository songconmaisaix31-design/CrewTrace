import { useEffect,useState } from 'react';
import { z } from 'zod';
import benchmark from '../../../docs/portfolio/benchmark-load-v1.json';
import benchmarkURL from '../../../docs/portfolio/benchmark-load-v1.json?url';
import { collaboration,collaborationError } from './collaboration-api';
import { useI18n } from './i18n';

const historySchema=z.object({
  runs:z.array(z.object({
    taskId:z.uuid(),title:z.string(),mode:z.string(),status:z.string(),createdAt:z.string(),attempts:z.number(),
  })),nextOffset:z.number().nullable(),
});

export default function ExperimentHistory({onTask}:{onTask:(taskId:string)=>void}) {
  const {t,time,error:translateError}=useI18n();
  const [offset,setOffset]=useState(0);
  const [history,setHistory]=useState<z.infer<typeof historySchema>|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    setError('');
    setHistory(null);
    void collaboration(`/csv-runs?limit=20&offset=${offset}`,historySchema,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setHistory(result);})
      .catch(problem=>{if(!controller.signal.aborted)setError(collaborationError(problem));});
    return ()=>controller.abort();
  },[offset]);

  return <>
    <h3>{t('CSV 历史运行','CSV run history')}</h3>
    {error?<p role="status">{translateError(error)}</p>:!history?<p>{t('正在读取运行记录…','Loading runs…')}</p>:
      !history.runs.length?<p>{t('暂无运行记录。','No runs yet.')}</p>:<ul>{history.runs.map(run=><li key={run.taskId}>
        <button className="text-button" onClick={()=>onTask(run.taskId)}>{run.title}</button>
        <p className="public-muted">{time(run.createdAt)} · {run.mode} · {run.status} · {run.attempts} {t('次尝试','attempts')}</p>
      </li>)}</ul>}
    {history&&(offset>0||history.nextOffset!==null)&&<div className="public-actions">
      <button className="secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>{t('上一页','Previous')}</button>
      <button className="secondary" disabled={history.nextOffset===null} onClick={()=>setOffset(history.nextOffset!)}>{t('下一页','Next')}</button>
    </div>}
    <h3>{t('并发策略评测','Concurrent policy benchmark')}</h3>
    <p className="public-muted">{t('固定种子的离散调度模拟，实际执行 CSV 清洗和验证。耗时单位为模拟刻度。','Seeded scheduling simulation using real CSV transformations and verification. Time is measured in simulated ticks.')}</p>
    <ul>{benchmark.runs.map(({strategy,metrics})=><li key={strategy}>
      <strong>{strategy}</strong> · {t('通过','Passed')} {metrics.accepted}/{metrics.tasks} · {t('重试','Retried')} {metrics.retried} · {t('超时','Timeouts')} {metrics.timeouts}
    </li>)}</ul>
    <a href={benchmarkURL} download="crewtrace-benchmark-load-v1.json">{t('下载原始评测记录','Download raw benchmark data')}</a>
  </>;
}
