import React from "react";
import { Camera, Settings, Pin, Monitor } from "lucide-react";

interface HeaderProps {
  onTriggerCapture: () => void;
  onTriggerFullscreenCapture: () => void;
  onOpenSettings: () => void;
  isAlwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  captureShortcut?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onTriggerCapture,
  onTriggerFullscreenCapture,
  onOpenSettings,
  isAlwaysOnTop,
  onToggleAlwaysOnTop,
  captureShortcut = "Alt+A",
}) => {

  return (
    <header
      data-tauri-drag-region
      className="h-12 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-md px-4 flex items-center justify-between select-none"
    >
      <div className="flex items-center gap-3 pointer-events-none">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
          <Camera className="w-4 h-4 text-white" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
            JCapture
          </span>
          <span className="text-[10px] uppercase font-semibold tracking-wider text-sky-400/90 bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-800/40">
            Workspace
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onTriggerCapture}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-medium transition-all shadow-md shadow-sky-600/20"
          title={`Capture region (${captureShortcut})`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Capture</span>
          <kbd className="ml-1 text-[10px] bg-sky-700/60 px-1.5 py-0.5 rounded font-mono">
            {captureShortcut}
          </kbd>
        </button>

        <button
          onClick={onTriggerFullscreenCapture}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-zinc-200 hover:text-white text-xs font-medium transition-all border border-zinc-700"
          title="Instant Full Screen Capture (1-Click)"
        >
          <Monitor className="w-3.5 h-3.5 text-sky-400" />
          <span>Full Screen</span>
        </button>

        <div className="h-4 w-px bg-zinc-800 mx-1" />

        <button
          onClick={onToggleAlwaysOnTop}
          className={`p-1.5 rounded-md hover:bg-zinc-800 transition-colors ${
            isAlwaysOnTop ? "text-sky-400 bg-zinc-800" : "text-zinc-400 hover:text-zinc-200"
          }`}
          title={isAlwaysOnTop ? "Always on top: ON" : "Always on top: OFF"}
        >
          <Pin className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
