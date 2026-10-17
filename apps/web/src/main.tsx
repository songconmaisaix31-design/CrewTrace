import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './editorial.css';
import './scroll-choreography.css';
import './experience.css';
const PublicWorkspace=lazy(()=>import('./PublicWorkspace'));
const currentURL=new URL(location.href);
if(currentURL.searchParams.has('run')||currentURL.searchParams.get('view')==='csv'){
  currentURL.searchParams.delete('run');currentURL.searchParams.delete('view');
  history.replaceState({},'',currentURL);
}
function Root(){
  return <Suspense fallback={<p className="notice">正在打开协作工作台…</p>}><PublicWorkspace/></Suspense>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
