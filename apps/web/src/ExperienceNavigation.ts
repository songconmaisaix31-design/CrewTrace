import { createContext, useContext } from 'react';

export type OrbitPoint={x:number;y:number};
export const ExperienceNavigation=createContext({screen:0,panel:0,setPanel:(_value:number)=>{},home:()=>{},paused:false,setPaused:(_value:boolean)=>{},orbit:{current:[] as OrbitPoint[]}});
export const useExperienceNavigation=()=>useContext(ExperienceNavigation);
