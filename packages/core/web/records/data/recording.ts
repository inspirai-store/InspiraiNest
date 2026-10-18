export class RecordingSession {
 private chunks:Blob[]=[];private pending:Promise<void>=Promise.resolve();private failure:unknown;private captureFailure:unknown;private stopped:Promise<void>;private resolveStop!:()=>void;
 readonly started=Date.now();
 readonly recorder:MediaRecorder;readonly stream:MediaStream;readonly persist:(blob:Blob)=>Promise<void>;
 constructor(recorder:MediaRecorder,stream:MediaStream,persist:(blob:Blob)=>Promise<void>){
  this.recorder=recorder;this.stream=stream;this.persist=persist;
  this.stopped=new Promise(r=>{this.resolveStop=r;});
  recorder.addEventListener('dataavailable',event=>{if(!event.data.size)return;this.chunks.push(event.data);const blob=new Blob(this.chunks,{type:recorder.mimeType.split(';')[0]});if(blob.size>32*1024*1024){this.failure=new Error('录音已达 32 MiB，请保留已保存的内容');if(recorder.state!=='inactive')recorder.stop();return;}this.pending=this.pending.then(async()=>{await persist(blob);this.failure=undefined;}).catch(e=>{this.failure=e;});});
  recorder.addEventListener('stop',()=>{stream.getTracks().forEach(t=>t.stop());this.resolveStop();},{once:true});
  recorder.addEventListener('error',()=>{this.captureFailure=new Error('录音中断');if(recorder.state!=='inactive')recorder.stop();});
 }
 start(){this.recorder.start(1000);}
 async finish(){if(this.recorder.state!=='inactive')this.recorder.stop();await this.stopped;await this.pending;if(this.failure||this.captureFailure)throw this.failure||this.captureFailure;}
}
