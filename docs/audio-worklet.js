// Streaming resampler. Keeps phase across render quanta even at 44.1/48 kHz.
class CaptureProcessor extends AudioWorkletProcessor {
 constructor(){super();this.phase=0;this.sum=0;this.n=0;this.buf=[];}
 process(inputs,outputs){for(const channel of outputs[0]||[])channel.fill(0);const channels=inputs[0];if(!channels?.length)return true;const ratio=sampleRate/24000;
 for(let i=0;i<channels[0].length;i++){let v=0;for(const c of channels)v+=c[i]/channels.length;this.sum+=v;this.n++;this.phase++;if(this.phase>=ratio){this.buf.push(this.sum/this.n);this.phase-=ratio;this.sum=0;this.n=0;}if(this.buf.length>=2400){const a=new Float32Array(this.buf);this.port.postMessage(a,[a.buffer]);this.buf=[];}}
 return true;}
}
registerProcessor('capture-processor',CaptureProcessor);
