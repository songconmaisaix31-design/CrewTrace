import { createContext, useContext } from 'react';

export type OrbitPoint={x:number;y:number};
export type OrbitAperture={center:OrbitPoint;axisX:OrbitPoint;axisY:OrbitPoint;breath:number};
export const ExperienceNavigation=createContext({screen:0,panel:0,setPanel:(_value:number)=>{},home:()=>{},paused:false,setPaused:(_value:boolean)=>{},orbit:{current:[] as OrbitPoint[]},aperture:{current:null as OrbitAperture|null}});
export const useExperienceNavigation=()=>useContext(ExperienceNavigation);
