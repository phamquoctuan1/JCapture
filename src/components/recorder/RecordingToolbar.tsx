import React, { useState, useEffect } from "react";
import { Play, Pause, Square, X, Mic, MicOff } from "lucide-react";

interface RecordingToolbarProps {
  isRecording: boolean;
  isPaused: boolean;
  onPauseResume: () => void;
  onStop: () => void;
  onCancel: () => void;
  isMicEnabled: boolean;
  onToggleMic: () => void;
}

export const RecordingToolbar: React.FC<RecordingToolbarProps> = ({
  isRecording,
  isPaused,
  onPauseResume,
  onStop,
  onCancel,
  isMicEnabled,
  onToggleMic,
}) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let interval: any = null;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused]);

  // Format seconds to HH:MM:SS or MM:SS
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, "0")}:${remMins
        .toString()
        .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isRecording) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-zinc-900/95 border border-red-500/40 backdrop-blur-xl px-4 py-2 rounded-2xl shadow-2xl shadow-red-950/40 select-none animate-in fade-in slide-in-from-bottom-5 duration-300">
      {/* Blinking REC indicator & Timer */}
      <div className="flex items-center gap-2 pr-3 border-r border-zinc-700/80">
        <div
          className={`w-3 h-3 rounded-full bg-red-500 ${
            isPaused ? "opacity-40" : "animate-ping"
          }`}
        />
        <div className="w-3 h-3 rounded-full bg-red-500 -ml-5" />
        <span className="font-mono font-bold text-sm tracking-wider text-white">
          {formatTime(seconds)}
        </span>
        {isPaused && (
          <span className="text-[10px] uppercase font-bold text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
            PAUSED
          </span>
        )}
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-1.5">
        {/* Pause / Resume */}
        <button
          onClick={onPauseResume}
          className={`p-2 rounded-xl transition-all ${
            isPaused
              ? "bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/20"
              : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
          }`}
          title={isPaused ? "Resume Recording" : "Pause Recording"}
        >
          {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
        </button>

        {/* Mic Toggle */}
        <button
          onClick={onToggleMic}
          className={`p-2 rounded-xl transition-all ${
            isMicEnabled
              ? "bg-sky-600/80 hover:bg-sky-500 text-white"
              : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
          }`}
          title={isMicEnabled ? "Microphone: ON" : "Microphone: OFF"}
        >
          {isMicEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        {/* Stop and Save */}
        <button
          onClick={onStop}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-semibold text-xs shadow-lg shadow-red-600/30 transition-all ml-1"
          title="Stop & Save Recording"
        >
          <Square className="w-4 h-4 fill-current" />
          <span>Stop & Save</span>
        </button>

        {/* Cancel Recording */}
        <button
          onClick={onCancel}
          className="p-2 rounded-xl text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-all ml-1"
          title="Cancel & Discard Recording"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
