import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './editorial.css';
import './scroll-choreography.css';
import './experience.css';
const CsvWorkspace=lazy(()=>import('./App'));
const PublicWorkspace=lazy(()=>import('./PublicWorkspace'));
function Root(){
  const [query,setQuery]=useState(location.search);
  useEffect(()=>{const pop=()=>setQuery(location.search);addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop);},[]);
  const params=new URLSearchParams(query),csv=params.has('run')||params.get('view')==='csv';
  return <Suspense fallback={<p className="notice">正在打开协作工作台…</p>}>{csv?<><div className="csv-public-return"><a href="/">← 返回公开协作</a></div><CsvWorkspace/></>:<PublicWorkspace/>}</Suspense>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
