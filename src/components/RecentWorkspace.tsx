import React, { useState } from "react";
import { Camera, Clock, Pin, Columns, Rows, Grid2X2, Trash2, X } from "lucide-react";
import { CaptureRecord } from "../types";
import { ThumbnailCard } from "./ThumbnailCard";

interface RecentWorkspaceProps {
  captures: CaptureRecord[];
  captureShortcut?: string;
  onOpenEditor: (record: CaptureRecord) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onDelete: (id: string) => void;
  onDeleteMultiple?: (ids: string[]) => void;
  onTriggerCapture: () => void;
  onMergeSelected?: (records: CaptureRecord[], layout: "horizontal" | "vertical" | "grid") => void;
}

export const RecentWorkspace: React.FC<RecentWorkspaceProps> = ({
  captures,
  captureShortcut = "Alt+A",
  onOpenEditor,
  onTogglePin,
  onDelete,
  onDeleteMultiple,
  onTriggerCapture,
  onMergeSelected,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleMergeAction = (layout: "horizontal" | "vertical" | "grid") => {
    if (!onMergeSelected || selectedIds.size < 2) return;
    const selectedRecords = captures.filter((c) => selectedIds.has(c.id));
    onMergeSelected(selectedRecords, layout);
    clearSelection();
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (onDeleteMultiple) {
      onDeleteMultiple(ids);
    } else {
      ids.forEach((id) => onDelete(id));
    }
    clearSelection();
  };

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
    <div className="flex-1 overflow-y-auto p-5 space-y-6 relative">
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
                isSelected={selectedIds.has(record.id)}
                onToggleSelect={toggleSelect}
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Recent Captures ({otherCaptures.length})</span>
          </div>

          <span className="text-[11px] text-zinc-500">
            Hold <b>Ctrl + Click</b> to multi-select for Instant Merge
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {otherCaptures.map((record) => (
            <ThumbnailCard
              key={record.id}
              record={record}
              isSelected={selectedIds.has(record.id)}
              onToggleSelect={toggleSelect}
              onOpenEditor={onOpenEditor}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
            />
          ))}
        </div>
      </section>

      {/* Floating Multi-Select Merge Action Dock */}
      {selectedIds.size >= 2 && onMergeSelected && (
        <div className="sticky bottom-4 z-40 mx-auto max-w-xl bg-zinc-900/95 border border-sky-500/80 backdrop-blur-xl p-2.5 px-4 rounded-2xl shadow-2xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-3">
          <div className="flex items-center gap-2 text-xs text-zinc-200 font-semibold">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-500 text-white font-bold text-[11px]">
              {selectedIds.size}
            </span>
            <span className="hidden sm:inline">Selected for Merge:</span>
          </div>

          {/* Merge Layout Options */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleMergeAction("horizontal")}
              className="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md transition-all transform hover:scale-105"
              title="Merge Side-by-Side horizontally (Ghép hàng ngang)"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Side-by-Side</span>
            </button>

            <button
              onClick={() => handleMergeAction("vertical")}
              className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md transition-all transform hover:scale-105"
              title="Merge Stacked vertically (Ghép hàng dọc)"
            >
              <Rows className="w-3.5 h-3.5" />
              <span>Vertical</span>
            </button>

            <button
              onClick={() => handleMergeAction("grid")}
              className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-zinc-700 transition-all"
              title="Merge as 2x2 Grid (Ghép lưới)"
            >
              <Grid2X2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Grid</span>
            </button>
          </div>

          <div className="h-5 w-px bg-zinc-800" />

          {/* Delete / Cancel buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleDeleteSelected}
              className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Delete all selected captures"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={clearSelection}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
              title="Cancel Selection (Clear)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
