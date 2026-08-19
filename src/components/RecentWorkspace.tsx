import React from "react";
import { Camera, Clock, Pin } from "lucide-react";
import { CaptureRecord } from "../types";
import { ThumbnailCard } from "./ThumbnailCard";

interface RecentWorkspaceProps {
  captures: CaptureRecord[];
  captureShortcut?: string;
  onOpenEditor: (record: CaptureRecord) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onDelete: (id: string) => void;
  onTriggerCapture: () => void;
}

export const RecentWorkspace: React.FC<RecentWorkspaceProps> = ({
  captures,
  captureShortcut = "Alt+A",
  onOpenEditor,
  onTogglePin,
  onDelete,
  onTriggerCapture,
}) => {
  const pinnedCaptures = captures.filter((c) => c.isPinned);
  const otherCaptures = captures.filter((c) => !c.isPinned);

  if (captures.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-center mb-4 shadow-xl">
          <Camera className="w-8 h-8 text-sky-400" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-200 mb-1">
          No captures yet
        </h3>
        <p className="text-sm text-zinc-400 max-w-sm mb-6">
          Press <kbd className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-sky-400 font-mono font-bold">{captureShortcut}</kbd> or click below to capture any screen area.
        </p>
        <button
          onClick={onTriggerCapture}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-sky-600/20 flex items-center gap-2"
        >
          <Camera className="w-4 h-4" />
          <span>Capture Screen Now</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6">
      {/* Pinned Section */}
      {pinnedCaptures.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-sky-400">
            <Pin className="w-3.5 h-3.5 fill-current" />
            <span>Pinned Captures ({pinnedCaptures.length})</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {pinnedCaptures.map((record) => (
              <ThumbnailCard
                key={record.id}
                record={record}
                onOpenEditor={onOpenEditor}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent Captures Section */}
      <section>
        <div className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Clock className="w-3.5 h-3.5" />
          <span>Recent Captures ({otherCaptures.length})</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {otherCaptures.map((record) => (
            <ThumbnailCard
              key={record.id}
              record={record}
              onOpenEditor={onOpenEditor}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
            />
          ))}
        </div>
      </section>
    </div>
  );
};
