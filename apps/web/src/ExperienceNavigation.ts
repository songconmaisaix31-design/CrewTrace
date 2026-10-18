import { createContext, useContext } from 'react';

export const ExperienceNavigation=createContext({screen:0,panel:0,setPanel:(_value:number)=>{},home:()=>{},paused:false,setPaused:(_value:boolean)=>{}});
export const useExperienceNavigation=()=>useContext(ExperienceNavigation);
