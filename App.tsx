
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Message, ConnectionStatus } from './types';
import { SYSTEM_INSTRUCTION, VOICE_NAME, Icons } from './constants';
import Visualizer from './components/Visualizer';
import ChatInterface from './components/ChatInterface';

// Utility functions for audio as requested in guidelines
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [inputText, setInputText] = useState('');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const handleSendText = useCallback(() => {
    if (!inputText.trim() || !sessionRef.current || status !== ConnectionStatus.CONNECTED) return;
    
    const textToSend = inputText.trim();
    
    try {
      sessionRef.current.sendRealtimeInput({ text: textToSend });
      setMessages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        role: 'user',
        text: textToSend,
        timestamp: new Date()
      }]);
      setInputText('');
    } catch (err) {
      console.error("Failed to send text input:", err);
    }
  }, [inputText, status]);

  const handleStartSession = async () => {
    try {
      // 1. Reset state
      if (sessionRef.current) {
        try { sessionRef.current.close(); } catch(e) {}
      }
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
      }
      stopAllAudio();
      setStatus(ConnectionStatus.CONNECTING);
      
      // 2. Setup Audio
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      await audioContextRef.current.resume();
      await outputAudioContextRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // 3. Initialize SDK
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // 4. Connect to Live API
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log('Lumi Session Socket Opened');
            setStatus(ConnectionStatus.CONNECTED);
            setIsListening(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            } else if (message.serverContent?.inputTranscription) {
              currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const assistantText = currentOutputTranscriptionRef.current;
              if (assistantText) {
                setMessages(prev => [...prev, {
                  id: Math.random().toString(36).substr(2, 9),
                  role: 'assistant',
                  text: assistantText,
                  timestamp: new Date()
                }]);
              }
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              setIsSpeaking(true);
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              try {
                const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.onended = () => {
                  activeSourcesRef.current.delete(source);
                  if (activeSourcesRef.current.size === 0) setIsSpeaking(false);
                };
                activeSourcesRef.current.add(source);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
              } catch (err) {
                console.error("Audio playback error:", err);
              }
            }

            if (message.serverContent?.interrupted) stopAllAudio();
          },
          onerror: (e) => {
            console.error('Lumi Session Error Detail:', e);
            setStatus(ConnectionStatus.ERROR);
            setIsListening(false);
          },
          onclose: (e) => {
            console.log('Lumi Session Closed');
            setStatus(ConnectionStatus.DISCONNECTED);
            setIsListening(false);
            stopAllAudio();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        }
      });

      // 5. Wait for session to resolve
      const session = await sessionPromise;
      sessionRef.current = session;
      
      // 6. Start Microphones Input Stream after resolution
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptProcessor;
      
      scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const l = inputData.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
          int16[i] = inputData[i] * 32768;
        }
        const pcmBlob = {
          data: encode(new Uint8Array(int16.buffer)),
          mimeType: 'audio/pcm;rate=16000',
        };
        
        // Use the promise-safe way even though we've awaited, to be triple-sure
        sessionPromise.then(s => {
          s.sendRealtimeInput({ media: pcmBlob });
        }).catch(() => {});
      };
      
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContextRef.current.destination);

      // 7. Initial greeting
      session.sendRealtimeInput({ 
        text: "Lumi, introduce yourself to the user. Acknowledge that you were created by Pralay, and politely ask for their name to get things started." 
      });

    } catch (error) {
      console.error('Failed to initialize Lumi:', error);
      setStatus(ConnectionStatus.ERROR);
    }
  };

  const handleStopSession = () => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    stopAllAudio();
    setIsListening(false);
    setStatus(ConnectionStatus.DISCONNECTED);
  };

  return (
    <div className="flex flex-col h-screen max-h-screen bg-gray-950 text-gray-100 overflow-hidden sm:h-[100dvh]">
      <header className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
          <div className={`w-2 h-2 md:w-3 md:h-3 rounded-full ${
            status === ConnectionStatus.CONNECTED ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
            status === ConnectionStatus.CONNECTING ? 'bg-yellow-500 animate-pulse' :
            status === ConnectionStatus.ERROR ? 'bg-red-500' : 'bg-gray-600'
          }`} />
          <div>
            <h1 className="text-sm md:text-lg font-bold tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              LUMI v2
            </h1>
            <p className="text-[8px] md:text-[10px] text-gray-500 uppercase tracking-widest font-semibold leading-tight">Assistant of Pralay</p>
          </div>
        </div>
        <button onClick={() => setMessages([])} className="p-1.5 md:p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative min-h-0">
        <div className="relative w-full md:w-1/2 flex items-center justify-center p-4 md:p-8 shrink-0 h-[35%] md:h-auto">
          <div className="absolute inset-0 bg-radial-gradient from-blue-900/10 via-transparent to-transparent opacity-50" />
          <div className="w-full max-w-[180px] md:max-w-sm aspect-square relative flex items-center justify-center">
            <Visualizer isSpeaking={isSpeaking} isListening={isListening} />
            {status === ConnectionStatus.DISCONNECTED && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/40 backdrop-blur-sm rounded-full animate-fade-in">
                <button onClick={handleStartSession} className="group relative flex items-center justify-center w-16 h-16 md:w-24 md:h-24 bg-blue-600 hover:bg-blue-500 rounded-full transition-all duration-300 shadow-[0_0_30px_rgba(37,99,235,0.3)] hover:shadow-[0_0_50px_rgba(37,99,235,0.5)] active:scale-95">
                  <Icons.Mic />
                  <div className="absolute -inset-1 md:-inset-2 border-2 border-blue-600/30 rounded-full animate-ping" />
                </button>
                <p className="mt-3 md:mt-6 text-gray-400 text-[10px] md:text-sm font-medium animate-bounce">Click to Wake</p>
              </div>
            )}
            {status === ConnectionStatus.ERROR && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/80 backdrop-blur-md rounded-full border border-red-500/30">
                <p className="text-red-400 font-bold text-xs md:text-base">Connection Failed</p>
                <button onClick={handleStartSession} className="mt-2 md:mt-4 px-3 py-1.5 md:px-4 md:py-2 bg-red-600 hover:bg-red-500 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider">Retry</button>
              </div>
            )}
          </div>
        </div>
        <div className="w-full md:w-1/2 flex flex-col bg-gray-900/30 md:border-l border-gray-800 min-h-0 flex-1">
          <ChatInterface messages={messages} containerRef={scrollRef} />
        </div>
      </main>

      <footer className="px-4 py-3 md:px-6 md:py-4 border-t border-gray-800 bg-gray-900/95 backdrop-blur-xl flex flex-col items-center gap-3 md:gap-4 z-10 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-2xl flex items-center gap-2 bg-gray-800/40 rounded-full px-4 py-1.5 md:py-2 border border-gray-700 focus-within:border-blue-500/50 transition-all shadow-inner">
          <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendText()} placeholder={status === ConnectionStatus.CONNECTED ? "Message Lumi..." : "Wake Lumi to type..."} className="flex-1 bg-transparent border-none focus:outline-none text-[13px] md:text-sm text-gray-200 placeholder-gray-500 py-1" disabled={status !== ConnectionStatus.CONNECTED} />
          <button onClick={handleSendText} disabled={status !== ConnectionStatus.CONNECTED || !inputText.trim()} className="p-1.5 md:p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-full transition-all text-white flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between w-full max-w-2xl px-2">
          <div className="flex flex-col">
             <span className="text-[8px] md:text-[10px] text-gray-500 font-bold uppercase tracking-widest leading-none mb-1">Status</span>
             <span className={`text-[10px] md:text-sm font-medium ${isListening ? 'text-blue-400' : 'text-gray-500'}`}>
               {isListening ? (isSpeaking ? 'Speaking...' : 'Listening...') : 'Sleeping'}
             </span>
          </div>
          <div className="flex-1 flex justify-center px-4">
            {status === ConnectionStatus.CONNECTED ? (
              <button onClick={handleStopSession} className="px-4 py-2 md:px-8 md:py-3 bg-red-600 hover:bg-red-500 text-white rounded-full text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all shadow-lg active:scale-95 group shrink-0">
                <div className="scale-75 md:scale-100"><Icons.Stop /></div>
                <span>STOP</span>
              </button>
            ) : (
              <button onClick={handleStartSession} disabled={status === ConnectionStatus.CONNECTING} className="px-4 py-2 md:px-8 md:py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all shadow-lg disabled:opacity-50 active:scale-95 group shrink-0">
                {status === ConnectionStatus.CONNECTING ? (
                   <div className="w-3.5 h-3.5 md:w-5 md:h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : <div className="scale-75 md:scale-100"><Icons.Mic /></div>}
                <span>{status === ConnectionStatus.CONNECTING ? 'WAKING...' : 'START'}</span>
              </button>
            )}
          </div>
          <div className="flex flex-col items-end">
             <span className="text-[8px] md:text-[10px] text-gray-500 font-bold uppercase tracking-widest leading-none mb-1">Latency</span>
             <span className="text-[10px] md:text-sm font-medium text-green-400">Low</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
