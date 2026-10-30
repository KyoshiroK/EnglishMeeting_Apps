export class TurnGate {
  constructor(rate=24000){this.rate=rate;this.total=0;this.silence=0;this.voiced=0;}
  push(samples){let sum=0;for(const x of samples)sum+=x*x;const rms=Math.sqrt(sum/samples.length);this.total+=samples.length;if(rms>.008){this.voiced+=samples.length;this.silence=0;}else this.silence+=samples.length;
    const commit=this.voiced>this.rate*.16&&(this.silence>this.rate*.65||this.total>this.rate*8);
    const clear=!this.voiced&&this.total>this.rate*4;
    if(commit||clear)this.reset();return {rms,commit,clear};}
  reset(){this.total=this.silence=this.voiced=0;}
}
export function pcmBase64(samples){const bytes=new Uint8Array(samples.length*2);const v=new DataView(bytes.buffer);for(let i=0;i<samples.length;i++)v.setInt16(i*2,Math.max(-32768,Math.min(32767,Math.round(samples[i]*32767))),true);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
export async function readEvents(stream,accept){const reader=stream.getReader(),decoder=new TextDecoder();let pending='';try{while(true){const {done,value}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});pending=pending.replace(/\r\n/g,'\n');let end;while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);for(const line of frame.split('\n'))if(line.startsWith('data: ')){const data=line.slice(6);if(data!=='[DONE]')accept(JSON.parse(data));}}if(done)break;}}finally{reader.releaseLock();}}
