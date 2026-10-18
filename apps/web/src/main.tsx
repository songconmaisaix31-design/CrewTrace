import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './editorial.css';
import './scroll-choreography.css';
import './experience.css';
import { LanguageProvider, useI18n } from './i18n';
const PublicWorkspace=lazy(()=>import('./PublicWorkspace'));
const currentURL=new URL(location.href);
if(currentURL.searchParams.has('run')||currentURL.searchParams.get('view')==='csv'){
  currentURL.searchParams.delete('run');currentURL.searchParams.delete('view');
  history.replaceState({},'',currentURL);
}
function Root(){
  const {t}=useI18n();
  return <Suspense fallback={<p className="notice">{t('正在打开协作工作台…','Opening the workspace…')}</p>}><PublicWorkspace/></Suspense>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><Root/></LanguageProvider></React.StrictMode>);
