import {createContext,useContext} from 'react';
import type {ComponentType,ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {usePlugins} from './react';
export type PluginView={id:string;Provider?:ComponentType<{children:ReactNode}>;routes?:{path:string;Component:ComponentType}[];settings?:{id:string;label:string;icon:LucideIcon;Component:ComponentType}[];generalSettings?:ComponentType[]};
const Context=createContext<PluginView[]>([]);
export const PluginViewsProvider=Context.Provider;
export function usePluginViews(){const {available}=usePlugins();const all=useContext(Context),active=all.filter(p=>available(p.id));return {all,active,settings:active.flatMap(p=>p.settings??[]),generalSettings:active.flatMap(p=>p.generalSettings??[])};}
