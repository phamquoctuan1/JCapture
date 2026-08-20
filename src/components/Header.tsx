import React, { useState } from "react";
import { Camera, Settings, Pin, Monitor, Minus, Square, X, PlusSquare, Video } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface HeaderProps {
  onTriggerCapture: () => void;
  onTriggerFullscreenCapture: () => void;
  onTriggerRecord: () => void;
  onNewBlankCanvas: () => void;
  onOpenSettings: () => void;
  isAlwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  captureShortcut?: string;
  fullscreenShortcut?: string;
  recordShortcut?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onTriggerCapture,
  onTriggerFullscreenCapture,
  onTriggerRecord,
  onNewBlankCanvas,
  onOpenSettings,
  isAlwaysOnTop,
  onToggleAlwaysOnTop,
  captureShortcut = "Alt+A",
  fullscreenShortcut = "Ctrl+Shift+F",
  recordShortcut = "Ctrl+Shift+R",
}) => {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = async () => {
    try {
      const win = getCurrentWindow();
      await win.minimize();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      const max = await win.isMaximized();
      if (max) {
        await win.unmaximize();
        setIsMaximized(false);
      } else {
        await win.maximize();
        setIsMaximized(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleClose = async () => {
    try {
      const win = getCurrentWindow();
      await win.hide(); // Hides to System Tray near Windows clock
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="h-12 border-b border-zinc-800/80 bg-zinc-900/95 backdrop-blur-md px-3 flex items-center justify-between select-none"
    >
      <div className="flex items-center gap-2.5 pointer-events-none">
        <div className="w-6 h-6 rounded-md bg-[#F36F21] flex items-center justify-center shadow-md shadow-orange-500/30 border border-orange-400/40">
          <Camera className="w-3.5 h-3.5 text-white stroke-[2.5]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs tracking-wider text-zinc-100 font-sans">
            JCapture
          </span>
          <span className="text-[9px] uppercase font-bold tracking-wider text-[#F36F21] bg-orange-950/70 px-1.5 py-0.5 rounded border border-orange-700/50">
            JITS
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={onTriggerCapture}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#F36F21] hover:bg-[#ff7d33] active:bg-[#d95d14] text-white text-xs font-semibold transition-all shadow-md shadow-orange-600/25"
          title={`Capture region (${captureShortcut})`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Capture</span>
          <kbd className="ml-1 text-[10px] bg-orange-800/80 px-1.5 py-0.5 rounded font-mono font-bold">
            {captureShortcut}
          </kbd>
        </button>

        <button
          onClick={onTriggerFullscreenCapture}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-zinc-200 hover:text-white text-xs font-medium transition-all border border-zinc-700"
          title={`Instant Full Screen Capture (${fullscreenShortcut})`}
        >
          <Monitor className="w-3.5 h-3.5 text-sky-400" />
          <span className="hidden sm:inline">Full Screen</span>
          <kbd className="ml-0.5 text-[9px] bg-zinc-900 text-zinc-400 px-1 py-0.5 rounded font-mono">
            {fullscreenShortcut}
          </kbd>
        </button>

        <button
          onClick={onTriggerRecord}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-red-400 hover:text-red-300 text-xs font-medium transition-all border border-zinc-700"
          title={`Screen Recording (${recordShortcut})`}
        >
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <Video className="w-3.5 h-3.5 text-red-400" />
          <span className="hidden sm:inline">Record</span>
          <kbd className="ml-0.5 text-[9px] bg-zinc-900 text-zinc-400 px-1 py-0.5 rounded font-mono">
            {recordShortcut}
          </kbd>
        </button>

        <button
          onClick={onNewBlankCanvas}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-emerald-400 hover:text-emerald-300 text-xs font-medium transition-all border border-zinc-700"
          title="New Blank Workspace to paste / merge screenshots (Ctrl + N)"
        >
          <PlusSquare className="w-3.5 h-3.5 text-emerald-400" />
          <span>New Canvas</span>
          <kbd className="ml-0.5 text-[9px] bg-zinc-900 text-zinc-400 px-1 py-0.5 rounded font-mono">
            Ctrl+N
          </kbd>
        </button>

        <div className="h-4 w-px bg-zinc-800 mx-1" />

        <button
          onClick={onToggleAlwaysOnTop}
          className={`p-1.5 rounded-md hover:bg-zinc-800 transition-colors ${
            isAlwaysOnTop ? "text-sky-400 bg-zinc-800" : "text-zinc-400 hover:text-zinc-200"
          }`}
          title={isAlwaysOnTop ? "Always on top: ON" : "Always on top: OFF"}
        >
          <Pin className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-zinc-800 mx-1" />

        {/* Window controls */}
        <button
          onClick={handleMinimize}
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          title="Minimize to Taskbar"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleClose}
          className="p-1.5 rounded text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Hide to System Tray"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
