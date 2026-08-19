import React, { useEffect, useState } from "react";
import { Copy, Edit3, Folder, Pin, Trash2, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { CaptureRecord } from "../types";

interface ThumbnailCardProps {
  record: CaptureRecord;
  onOpenEditor: (record: CaptureRecord) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onDelete: (id: string) => void;
}

export const ThumbnailCard: React.FC<ThumbnailCardProps> = ({
  record,
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
      onClick={() => onOpenEditor(record)}
      className={`group relative flex flex-col rounded-xl overflow-hidden border transition-all cursor-pointer bg-zinc-900/60 hover:bg-zinc-850 shadow-sm ${
        record.isPinned
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
          <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-sky-500 animate-spin" />
        )}

        {/* Hover Overlay Action Bar */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={handleCopyOriginal}
            className="p-2 rounded-lg bg-zinc-800/90 hover:bg-sky-600 text-white transition-all transform hover:scale-110 shadow-lg"
            title="Copy to Clipboard"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenEditor(record);
            }}
            className="p-2 rounded-lg bg-zinc-800/90 hover:bg-indigo-600 text-white transition-all transform hover:scale-110 shadow-lg"
            title="Edit Annotations"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenFolder}
            className="p-2 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-white transition-all transform hover:scale-110 shadow-lg"
            title="Show in Folder"
          >
            <Folder className="w-4 h-4" />
          </button>
        </div>

        {/* Pin Badge Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(record.id, !record.isPinned);
          }}
          className={`absolute top-2 right-2 p-1.5 rounded-md backdrop-blur-md transition-all ${
            record.isPinned
              ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
              : "bg-zinc-900/80 text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100"
          }`}
          title={record.isPinned ? "Unpin" : "Pin to top"}
        >
          <Pin className={`w-3.5 h-3.5 ${record.isPinned ? "fill-current" : ""}`} />
        </button>
      </div>

      {/* Card Info Footer */}
      <div className="p-2.5 flex items-center justify-between border-t border-zinc-800/60 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <span className="font-mono text-[11px] text-zinc-300">
            {record.width} × {record.height}
          </span>
          <span className="text-zinc-600">•</span>
          <span className="text-[11px] text-zinc-400">{formatTime(record.createdAt)}</span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(record.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
          title="Delete Capture"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
