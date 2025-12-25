
import React from 'react';
import { Message } from '../types';
import { Icons } from '../constants';

interface ChatInterfaceProps {
  messages: Message[];
  containerRef: React.RefObject<HTMLDivElement>;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, containerRef }) => {
  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-6 md:py-8 space-y-4 md:space-y-6 scroll-smooth scrollbar-hide"
    >
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 space-y-4 px-4">
          <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gray-800/50 flex items-center justify-center animate-pulse">
            <Icons.Sparkles />
          </div>
          <p className="text-xs md:text-sm font-medium">Hello! I am Lumi v2.<br/>Waking up to assist you...</p>
        </div>
      ) : (
        messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className={`max-w-[90%] md:max-w-[85%] rounded-2xl px-3 py-2 md:px-4 md:py-3 text-[13px] md:text-sm flex items-start gap-2 md:gap-3 shadow-lg ${
              msg.role === 'user' 
                ? 'bg-blue-600/90 text-white rounded-tr-none' 
                : 'bg-gray-800/90 text-gray-100 border border-gray-700 rounded-tl-none'
            }`}>
              <div className="mt-0.5 md:mt-1 shrink-0 opacity-70 scale-90 md:scale-100">
                {msg.role === 'user' ? <Icons.User /> : <Icons.Sparkles />}
              </div>
              <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
            </div>
            <span className="text-[9px] md:text-[10px] text-gray-500 mt-1 px-2 uppercase tracking-widest font-bold">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))
      )}
    </div>
  );
};

export default ChatInterface;
