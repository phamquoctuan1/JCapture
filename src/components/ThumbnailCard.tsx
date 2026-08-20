import React, { useEffect, useState } from "react";
import { Copy, Edit3, Folder, Pin, Trash2, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { CaptureRecord } from "../types";

interface ThumbnailCardProps {
  record: CaptureRecord;
  isSelected?: boolean;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  onOpenEditor: (record: CaptureRecord) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onDelete: (id: string) => void;
}

export const ThumbnailCard: React.FC<ThumbnailCardProps> = ({
  record,
  isSelected = false,
  onToggleSelect,
  onOpenEditor,
  onTogglePin,
  onDelete,
}) => {
  const [thumbSrc, setThumbSrc] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadThumbnail = async () => {
      try {
        const dataUrl = await invoke<string>("read_image_base64", {
          filePath: record.thumbnailPath,
        });
        if (isMounted) setThumbSrc(dataUrl);
      } catch (err) {
        console.error("Failed to load thumbnail:", err);
      }
    };

    loadThumbnail();
    return () => {
      isMounted = false;
    };
  }, [record.thumbnailPath, record.updatedAt, record.width, record.height]);

  const handleCopyOriginal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const origDataUrl = await invoke<string>("read_image_base64", {
        filePath: record.originalPath,
      });
      await invoke("copy_image_base64_to_clipboard", {
        base64Data: origDataUrl,
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy image to clipboard:", err);
    }
  };

  const handleOpenFolder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("open_in_explorer", { filePath: record.originalPath });
    } catch (err) {
      console.error("Failed to open explorer:", err);
    }
  };

  const formatTime = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      onClick={(e) => {
        if (e.ctrlKey && onToggleSelect) {
          onToggleSelect(record.id, e);
        } else {
          onOpenEditor(record);
        }
      }}
      className={`group relative flex flex-col rounded-xl overflow-hidden border transition-all cursor-pointer bg-zinc-900/60 hover:bg-zinc-850 shadow-sm ${
        isSelected
          ? "border-sky-400 ring-2 ring-sky-500/50 bg-sky-950/30 shadow-md shadow-sky-500/20"
          : record.isPinned
          ? "border-sky-500/50 bg-sky-950/20 shadow-sky-500/10 shadow-md"
          : "border-zinc-800/80 hover:border-zinc-700"
      }`}
    >
      {/* Thumbnail Image Container */}
      <div className="relative aspect-video w-full bg-zinc-950/80 flex items-center justify-center overflow-hidden">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt="Capture"
            className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="w-5 h-5 rounded-full border-2 border-zinc-700 border-t-sky-500 animate-spin" />
        )}

        {/* Top-Left Multi-Select Checkbox */}
        {onToggleSelect && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(record.id, e);
            }}
            className={`absolute top-2 left-2 w-5 h-5 rounded-md flex items-center justify-center transition-all z-10 ${
              isSelected
                ? "bg-sky-500 text-white shadow-md shadow-sky-500/40"
                : "bg-black/60 border border-zinc-500/80 text-transparent hover:border-sky-400 opacity-0 group-hover:opacity-100"
            }`}
            title={isSelected ? "Deselect" : "Select for multi-merge (Ctrl+Click)"}
          >
            <Check className={`w-3.5 h-3.5 ${isSelected ? "opacity-100" : "opacity-0"}`} />
          </button>
        )}

        {/* Video Badge */}
        {record.captureType === "recording" && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-red-950/80 border border-red-700/60 text-red-300 px-1.5 py-0.5 rounded text-[9px] font-semibold backdrop-blur-md shadow-md">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span>VIDEO</span>
          </div>
        )}

        {/* Hover Overlay Action Bar - Compact and sleek */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
          {record.captureType === "recording" ? (
            <div className="w-10 h-10 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-lg transform hover:scale-110 transition-transform">
              <span className="text-xs font-bold">▶</span>
            </div>
          ) : (
            <>
              <button
                onClick={handleCopyOriginal}
                className="p-1.5 rounded-lg bg-zinc-800/90 hover:bg-sky-600 text-white transition-all transform hover:scale-105 shadow-md"
                title="Copy to Clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenEditor(record);
                }}
                className="p-1.5 rounded-lg bg-zinc-800/90 hover:bg-indigo-600 text-white transition-all transform hover:scale-105 shadow-md"
                title="Edit Annotations"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleOpenFolder}
                className="p-1.5 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-white transition-all transform hover:scale-105 shadow-md"
                title="Show in Folder"
              >
                <Folder className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Pin Badge Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(record.id, !record.isPinned);
          }}
          className={`absolute top-2 right-2 p-1 rounded-md backdrop-blur-md transition-all ${
            record.isPinned
              ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
              : "bg-zinc-900/80 text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100"
          }`}
          title={record.isPinned ? "Unpin" : "Pin to top"}
        >
          <Pin className={`w-3 h-3 ${record.isPinned ? "fill-current" : ""}`} />
        </button>
      </div>

      {/* Card Info Footer */}
      <div className="px-2 py-1.5 flex items-center justify-between border-t border-zinc-800/60 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <span className="font-mono text-[10px] text-zinc-300">
            {record.width} × {record.height}
          </span>
          <span className="text-zinc-600">•</span>
          <span className="text-[10px] text-zinc-400">{formatTime(record.createdAt)}</span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(record.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
          title="Delete Capture"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
