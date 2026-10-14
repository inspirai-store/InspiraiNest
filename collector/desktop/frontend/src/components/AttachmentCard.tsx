import { CirclePlay, Download, Image as ImageIcon, Pause } from 'lucide-react';
import { IconAction } from './Controls';
import styles from '../app/Workbench.module.css';

export function AttachmentCard({ name, duration, onDownload, onPlay, playing = false, image = false, disabled = false }: {
  name: string; duration: string; onDownload?: () => void; onPlay?: () => void; playing?: boolean; image?: boolean; disabled?: boolean;
}) {
  return <div className={styles.attachment} data-region="音频附件">
    {image?<ImageIcon size={32} className={styles.accentText}/>:onPlay?<button aria-label={playing?'暂停附件':'播放附件'} onClick={onPlay} style={{width:32,height:32,padding:0,background:'transparent',color:'var(--accent)',display:'flex'}}>{playing?<Pause size={32}/>:<CirclePlay size={32}/>}</button>:<CirclePlay size={32} className={styles.accentText}/>}
    <div className={styles.attachmentInfo}><span>{name}</span><small>{duration}</small></div>
    <IconAction icon={Download} label="下载附件" onClick={onDownload} disabled={disabled} />
  </div>;
}
