import { createContext, useContext } from 'react';

export const ExperienceNavigation=createContext({screen:0,panel:0,setPanel:(_value:number)=>{},home:()=>{}});
export const useExperienceNavigation=()=>useContext(ExperienceNavigation);
