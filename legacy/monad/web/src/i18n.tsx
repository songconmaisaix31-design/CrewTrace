import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Language='zh'|'en';
const LanguageContext=createContext<{language:Language;setLanguage:(value:Language)=>void}>({language:'zh',setLanguage:()=>{}});
export function LanguageProvider({children}:{children:ReactNode}){
  const [language,setLanguage]=useState<Language>(()=>localStorage.getItem('crewtrace-language')==='en'?'en':'zh');
  useEffect(()=>{localStorage.setItem('crewtrace-language',language);document.documentElement.lang=language==='zh'?'zh-CN':'en';document.title='CrewTrace';},[language]);
  return <LanguageContext.Provider value={{language,setLanguage}}>{children}</LanguageContext.Provider>;
}
export function useI18n(){
  const {language,setLanguage}=useContext(LanguageContext);
  return {language,setLanguage,t:(zh:string,en:string)=>language==='zh'?zh:en,
    time:(value:string)=>new Date(value).toLocaleString(language==='zh'?'zh-CN':'en-US',{hour12:false}),
    error:(value:string)=>language==='zh'?value:(errors[value]??'The request could not be completed. Refresh to check the latest record before retrying.')};
}
export function LanguageSwitch(){
  const {t,language,setLanguage}=useI18n();
  return <button type="button" className="language-toggle" onClick={()=>setLanguage(language==='zh'?'en':'zh')} aria-label={t('切换为英文','Switch to Chinese')}><span className={language==='zh'?'selected':''}>{t('中','ZH')}</span><span aria-hidden="true">/</span><span lang="en" className={language==='en'?'selected':''}>EN</span></button>;
}
const errors:Record<string,string>={
  '请检查表单内容和完整的网址。':'Check the form fields and enter complete URLs.',
  '服务返回的内容暂时无法读取。':'The service response could not be read.',
  '连接中断，请检查网络后重试。':'Connection interrupted. Check your network and retry.',
  '等待响应超时，请刷新核对实际记录。':'The request timed out. Refresh to check the actual record.',
  '记录已被更新，请刷新后确认最新内容再提交。':'This record has changed. Refresh and review it before submitting.',
  '当前记录状态不支持此操作，请先查询原分析编号。':'This action is unavailable for the current record status.',
  '任务服务尚未配置。':'The task service has not been configured.',
  '提交内容有误，请检查后重试。':'Check your submission and try again.',
  '访问授权已失效，请重新输入访问码。':'Your authorization has expired. Restore your identity to continue.',
  '暂时没有操作权限，请检查访问码或联系活动负责人。':'You do not have permission to perform this action.',
  '未找到这份记录，请检查编号是否正确。':'Record not found. Check the identifier.',
  '这次提交可能已存在，请先查看上次提交结果。':'This submission may already exist. Check the previous result first.',
  '操作较频繁，请稍后再试。':'Too many requests. Please try again shortly.',
  '服务暂时不可用，请稍后重试。':'The service is temporarily unavailable. Try again shortly.',
  '操作未完成，请稍后重试。':'The action did not complete. Please try again.',
  '交流记录的同步顺序无效。':'The message sync sequence is invalid.',
  '无法自动复制，请选中内容后复制。':'Copy failed. Select the content and copy it manually.',
  '接入指令暂时无法读取，请稍后重试。':'Connection instructions are unavailable. Please retry.',
  '接入指令文件内容为空。':'The connection instruction file is empty.',
  '接入指令读取失败。':'Could not load the connection instructions.',
  '复制失败，请选择上方接入指令后复制。':'Copy failed. Select the instructions above and copy them manually.',
};
