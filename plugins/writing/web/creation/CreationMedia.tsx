import {useEffect,useState} from 'react';
import {Action} from '../../../../packages/ui-react/src/Controls';
import {CreationClient} from './client';
export function CreationMedia({media,client}:{media:any;client:CreationClient}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 return <div className="creation-media"><strong>{media.name}</strong>{url?(media.mime.startsWith('image/')?<img src={url} alt={media.alt||media.name}/>:media.mime.startsWith('audio/')?<audio src={url} controls/>:<video src={url} controls/>):<Action disabled={busy} onClick={async()=>{setBusy(true);try{setUrl(await client.media(media.sha256));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>查看媒体</Action>}{error&&<p role="alert">{error}</p>}{media.caption&&<p>{media.caption}</p>}{media.attribution&&<p>{media.attribution}</p>}</div>;
}
