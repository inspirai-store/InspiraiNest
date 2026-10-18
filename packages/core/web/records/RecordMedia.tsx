import {errorMessage} from '../shared/errors.ts';
import {CameraSession} from './data/camera';
import {useEffect,useRef,useState} from 'react';
import {Camera,CirclePlay,Image as ImageIcon,Pause,X} from 'lucide-react';
import {Action,IconAction} from '../../../ui-react/src/Controls';
import {Modal} from '../../../ui-react/src/Overlays';
import type {Attachment} from './data/types';
import styles from './RecordMedia.module.css';
export function DraftAttachments({attachments,remove,disabled=false}:{attachments:Attachment[];disabled?:boolean;remove:(id:string)=>void}){
 return <div className={styles.attachments} data-region="草稿附件">{attachments.map(a=><MediaRow key={a.id} attachment={a} disabled={disabled} remove={()=>remove(a.id)}/>)}</div>;
}
function MediaRow({attachment:a,remove,disabled}:{attachment:Attachment;disabled?:boolean;remove:()=>void}){
 const audio=useRef<HTMLAudioElement|null>(null);const [playing,setPlaying]=useState(false);
 useEffect(()=>{if(!a.blob||!a.mime.startsWith('audio/'))return;const url=URL.createObjectURL(a.blob),player=new Audio(url);audio.current=player;player.onended=()=>setPlaying(false);return()=>{player.pause();player.removeAttribute('src');audio.current=null;URL.revokeObjectURL(url);};},[a.blob,a.mime]);
 return <div className={styles.row} data-region={a.mime.startsWith('image/')?'图片附件':'音频附件'}>{a.mime.startsWith('image/')?<ImageIcon size={32}/>:<button className={styles.play} aria-label={playing?'暂停附件':'播放附件'} disabled={!a.blob} onClick={()=>{const p=audio.current;if(!p)return;if(playing){p.pause();setPlaying(false);}else void p.play().then(()=>setPlaying(true)).catch(()=>setPlaying(false));}}>{playing?<Pause size={32}/>:<CirclePlay size={32}/>}</button>}<span>{a.name}</span><IconAction icon={X} disabled={disabled} label={'删除附件 '+a.name} onClick={remove}/></div>;
}
export function RecordingBar({seconds,finish,busy=false}:{seconds:number;finish:()=>void;busy?:boolean}){
 return <div className={styles.recording} data-region="录音状态"><i data-region="录音指示"/><span>{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</span><div className={styles.spacer}/><Action disabled={busy} onClick={finish}>结束录音</Action></div>;
}
export function CameraDialog({invoker,close,capture,preview=false}:{invoker:HTMLElement;close:()=>void;capture:(file:File)=>Promise<void>;preview?:boolean}){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null);const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(preview){setReady(true);return;}let active=true;const session=new CameraSession(()=>navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}}));void session.open().then(s=>{if(!s)return;stream.current=s;if(video.current){video.current.srcObject=s;void video.current.play().catch(e=>setError(errorMessage(e)));}}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;session.close();stream.current=null;if(video.current)video.current.srcObject=null;};},[preview]);
 const photo=async()=>{if(preview){close();return;}if(!video.current?.videoWidth)return;setBusy(true);try{const v=video.current,c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d')!.drawImage(v,0,0);const blob=await new Promise<Blob|null>(r=>c.toBlob(r,'image/jpeg',.9));if(!blob)throw new Error('照片保存失败');await capture(new File([blob],'照片-'+Date.now()+'.jpg',{type:'image/jpeg'}));close();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}};
 return <Modal title="拍照" region="相机对话框" invoker={invoker} close={()=>{if(!busy)close();}} className={styles.camera} footer={<><Action disabled={busy} onClick={close}>取消</Action><Action kind="primary" disabled={!ready||busy} onClick={()=>void photo()}>拍照</Action></>}><div className={styles.cameraPreview} data-overlay-region="相机预览">{preview?<Camera size={48}/>:<video ref={video} autoPlay muted playsInline aria-label="相机预览" onLoadedMetadata={()=>setReady(true)}/>}</div>{error&&<p role="alert" className={styles.error}>{error}</p>}</Modal>;
}
