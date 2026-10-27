// This factory is shared verbatim by tests and the isolated, offline lesson document.
export function visualMath(){
  return {
    kv({layers=32,heads=8,dim=128,bytes=2,length=8192,batch=1}={}){const perToken=2*layers*heads*dim*bytes;return {perToken,total:perToken*length*batch};},
    attention(position){const keys=[1,0,2],values=[10,20,30],scores=keys.map((k,i)=>i<=position?k:null),max=Math.max(...scores.filter(s=>s!==null));const exp=scores.map(s=>s===null?0:Math.exp(s-max)),z=exp.reduce((a,b)=>a+b,0),weights=exp.map(e=>e/z);return {scores,weights,output:weights.reduce((v,w,i)=>v+w*values[i],0)};},
    gemm(m,k=1024,n=1024,b=2){const flops=2*m*k*n,bytes=b*(m*k+k*n+m*n),intensity=flops/bytes;return {flops,bytes,intensity,ceiling:Math.min(100,intensity)};},
    collective(kind){return kind==='AllGather'?[[1,2,3,4],[1,2,3,4]]:kind==='ReduceScatter'?[[4],[6]]:kind==='All-to-All'?[['a0','b0'],['a1','b1']]:[[4,6],[4,6]];},
    overlap(ready){return Math.max(40,ready+30);},
    compile(count){return {eager:count*10,compiled:2000+count*8};}
  };
}
