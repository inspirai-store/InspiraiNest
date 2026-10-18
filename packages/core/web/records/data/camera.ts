export class CameraSession {
 private closed=false;private stream:MediaStream|null=null;private getStream:()=>Promise<MediaStream>;
 constructor(getStream:()=>Promise<MediaStream>){this.getStream=getStream;}
 async open(){const stream=await this.getStream();if(this.closed){stream.getTracks().forEach(t=>t.stop());return null;}this.stream=stream;return stream;}
 close(){this.closed=true;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;}
}
