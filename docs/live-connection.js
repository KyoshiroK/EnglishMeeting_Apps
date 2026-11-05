import {TurnGate,pcmBase64} from './core.js';

// Audio capture lives outside this object: rotating a socket never closes MediaStream.
export class LiveConnection {
  constructor({getConnection,onEvent=()=>{},onState=()=>{},onNotice=()=>{},onReset=()=>{},onFatal=()=>{},socketFactory=(url,protocols)=>new WebSocket(url,protocols),clock=globalThis,now=()=>Date.now(),rotationMs=45*60*1000,maxBufferSeconds=30}){
    Object.assign(this,{getConnection,onEvent,onState,onNotice,onReset,onFatal,socketFactory,clock,now,rotationMs,maxBufferSeconds});
    this.gate=new TurnGate();this.turns=[];this.current=this.newTurn();this.itemMap=new Map();this.awaiting=[];this.active=false;this.ready=false;this.attempt=0;this.connections=0;this.generation=0;this.totalSamples=0;this.droppedSamples=0;this.serial=0;
  }
  newTurn(){const t={frames:[],samples:0,sent:0,committed:false,commitSent:false,clear:false};this.turns.push(t);return t;}
  state(name){this.onState({state:name,attempt:this.attempt,connections:this.connections,bufferSeconds:Math.round(this.bufferedSamples()/24000*10)/10,droppedSeconds:this.droppedSamples/24000});}
  bufferedSamples(){return this.turns.reduce((n,t)=>n+t.samples,0);}
  start(){if(this.active)return;this.active=true;this.pumpTimer=this.clock.setInterval(()=>this.pump(),50);this.connect();}
  push(samples){if(!this.active)return;this.totalSamples+=samples.length;this.current.frames.push(pcmBase64(samples));this.current.samples+=samples.length;const g=this.gate.push(samples);
    if(g.commit){this.current.committed=true;this.current=this.newTurn();}
    else if(g.clear){this.current.clear=true;this.current.frames=[];this.current.samples=0;this.current.sent=0;this.current=this.newTurn();}
    while(this.bufferedSamples()>this.maxBufferSeconds*24000&&this.turns.length>1){const old=this.turns.shift();this.droppedSamples+=old.samples;for(const [id,t] of this.itemMap)if(t===old)this.itemMap.delete(id);this.awaiting=this.awaiting.filter(t=>t!==old);if(this.now()-(this.lastDropNotice??-Infinity)>5000){this.lastDropNotice=this.now();this.onNotice('音声バッファ上限（30秒）を超えたため、古い未確定音声を破棄しました。欠落があります。');}}
    return g;
  }
  async connect(){if(!this.active)return;const generation=++this.generation;this.ready=false;this.itemMap.clear();this.awaiting=[];this.turns=this.turns.filter(t=>!t.clear);for(const t of this.turns){t.sent=0;t.commitSent=false;}if(!this.turns.includes(this.current))this.current=this.newTurn();this.onReset();this.state(this.connections?'reconnecting':'connecting');
    this.connectTimer=this.clock.setTimeout(()=>this.failed(generation,'接続の準備がタイムアウトしました。'),20000);
    try{const c=await this.getConnection();if(!this.active||generation!==this.generation)return;const ws=this.socketFactory(c.url,c.protocols);this.socket=ws;
      ws.onopen=()=>{if(this.active&&generation===this.generation)ws.send(JSON.stringify(c.hello));};
      ws.onmessage=m=>{if(!this.active||generation!==this.generation)return;try{const e=JSON.parse(m.data);this.lastMessage=this.now();
        if(e.type==='bridge.error'){this.failed(generation,e.message||'中継接続エラー',e.retryable===false);return;}
        if(e.type==='error'){const code=e.error?.code||'unknown';if(code==='input_audio_buffer_commit_empty'){this.onNotice('短い音声区間を確定できませんでした。');return;}this.failed(generation,'音声APIエラー ('+code+')',code!=='rate_limit_exceeded');return;}
        if(e.type==='bridge.ready'||e.type==='session.updated'){if(!this.ready){this.ready=true;this.connections++;this.startedAt=this.now();this.clock.clearTimeout(this.connectTimer);this.onNotice('音声接続が完了しました（接続 '+this.connections+' 回目）。');this.state('ready');}return;}
        if(e.type==='input_audio_buffer.committed'){const t=this.awaiting.shift();if(t)this.itemMap.set(e.item_id,t);}
        if(e.type==='conversation.item.input_audio_transcription.completed'||e.type==='conversation.item.input_audio_transcription.failed'){const t=this.itemMap.get(e.item_id);if(t){this.turns=this.turns.filter(x=>x!==t);this.itemMap.delete(e.item_id);}}
        const namespaced={...e};for(const key of ['item_id','previous_item_id'])if(e[key])namespaced[key]=generation+':'+e[key];this.onEvent(namespaced);
      }catch(err){this.onNotice('受信イベントを処理できませんでした。');}};
      ws.onclose=e=>this.failed(generation,'音声接続が終了しました (code '+(e.code||1006)+')。');
      ws.onerror=()=>this.failed(generation,'音声接続に失敗しました。ネットワークを確認してください。');
    }catch(e){if(generation===this.generation)this.failed(generation,e.message||'接続できませんでした。',[400,401,403,404,503].includes(e.status));}
  }
  failed(generation,message,fatal=false){if(!this.active||generation!==this.generation)return;this.generation++;this.ready=false;this.clock.clearTimeout(this.connectTimer);const socket=this.socket;this.socket=null;try{socket?.close();}catch{}this.onNotice(message);if(fatal||++this.attempt>12){this.state('failed');this.finish();this.onFatal(message+' 設定を確認して「会議を開始」で再開してください。');return;}
    const wait=Math.min(30000,1000*2**Math.min(this.attempt-1,5));this.state('reconnecting');this.retryTimer=this.clock.setTimeout(()=>this.connect(),wait);
  }
  pump(){if(!this.active||!this.ready||this.socket?.readyState!==1)return;
    if(this.now()-this.startedAt>60000)this.attempt=0;
    if(this.now()-this.lastMessage>90000){this.failed(this.generation,'90秒間応答がないため接続を更新します。');return;}
    if(this.now()-this.startedAt>=this.rotationMs){this.rotateRequested=true;}
    // Rotate at an audio turn boundary after pending transcripts arrive.
    if(this.rotateRequested&&this.turns.every(t=>!t.committed)&&this.current.samples<24000*.3){this.rotateRequested=false;this.rotate();return;}
    if(this.rotateRequested&&this.now()-this.startedAt>this.rotationMs+15000){this.rotateRequested=false;this.rotate();return;}
    if(this.socket.bufferedAmount>512000){if(!this.backpressureAt)this.backpressureAt=this.now();if(this.now()-this.backpressureAt>5000)this.failed(this.generation,'送信が滞っているため接続を更新します。');return;}this.backpressureAt=0;
    const t=this.turns.find(x=>x.clear||x.sent<x.frames.length||x.committed&&!x.commitSent);if(!t)return;
    try{if(t.clear){this.socket.send(JSON.stringify({type:'input_audio_buffer.clear'}));this.turns=this.turns.filter(x=>x!==t);return;}
      if(t.sent<t.frames.length){this.socket.send(JSON.stringify({type:'input_audio_buffer.append',audio:t.frames[t.sent++]}));return;}
      if(t.committed&&!t.commitSent){t.commitSent=true;this.awaiting.push(t);this.socket.send(JSON.stringify({type:'input_audio_buffer.commit'}));}
    }catch{this.failed(this.generation,'音声の送信に失敗しました。');}
  }
  rotate(){this.onNotice('長時間会議のため音声接続を自動更新します。');const socket=this.socket;this.generation++;this.ready=false;this.socket=null;try{socket?.close();}catch{}this.connect();}
  async stop(){if(!this.active)return;this.clock.clearTimeout(this.retryTimer);if(this.gate.voiced>2400&&!this.current.committed){this.current.committed=true;this.current=this.newTurn();this.gate.reset();}
    const deadline=this.now()+8000;await new Promise(resolve=>{const timer=this.clock.setInterval(()=>{const pending=this.turns.some(t=>t.committed);if(!this.active||!pending||!this.ready||this.now()>=deadline){this.clock.clearInterval(timer);if(pending)this.onNotice('停止時に未確定の音声が残りました。必要なら手入力で補完してください。');resolve();}},50);});this.finish();
  }
  finish(){this.active=false;this.ready=false;this.generation++;for(const id of [this.retryTimer,this.connectTimer])this.clock.clearTimeout(id);this.clock.clearInterval(this.pumpTimer);const socket=this.socket;this.socket=null;try{socket?.close();}catch{}this.turns=[];this.itemMap.clear();this.awaiting=[];}
}
