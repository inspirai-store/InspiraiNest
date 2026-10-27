import {useMemo} from 'react';
import styles from './Learning.module.css';

export function LearningVisual({lessonId,theme}:{lessonId:string;theme:string}){
  const url=useMemo(()=>{const target=new URL(import.meta.env.BASE_URL+'learning-visuals/'+(window.location.protocol==='file:'?'offline.html':'index.html'),window.location.href);target.searchParams.set('lesson',lessonId);target.searchParams.set('theme',theme);target.searchParams.set('embedded','true');return target.href;},[lessonId,theme]);
  return <iframe title="动态图解" className={styles.visual} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer"/>;
}
