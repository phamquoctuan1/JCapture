import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Download,
  FolderOpen,
  Trash2,
  Maximize,
  Copy,
  Check,
  Film,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { CaptureRecord } from "../../types";

interface VideoPlayerModalProps {
  record: CaptureRecord;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  record,
  onClose,
  onDelete,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load video as Base64 / Blob data from Tauri backend
  useEffect(() => {
    let isMounted = true;
    const loadVideo = async () => {
      try {
        const b64 = await invoke<string>("read_image_base64", {
          filePath: record.originalPath,
        });
        if (isMounted) {
          // Replace mime type if needed
          const src = b64.startsWith("data:")
            ? b64.replace(/^data:[^;]+;/, "data:video/webm;")
            : `data:video/webm;base64,${b64}`;
          setVideoSrc(src);
        }
      } catch (e) {
        console.error("Failed to load video file:", e);
      }
    };
    loadVideo();
    return () => {
      isMounted = false;
    };
  }, [record.originalPath]);

  // Handle keyboard hotkeys (Space to toggle play, Esc to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === " " && e.target === document.body) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
      setIsMuted(vol === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    videoRef.current.muted = newMuted;
  };

  const handleExport = async () => {
    if (!videoSrc) return;
    setExporting(true);
    try {
      await invoke("export_video_as_dialog", {
        base64Data: videoSrc,
        defaultName: `Recording_${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
      });
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(false);
    }
  };

  const handleOpenExplorer = async () => {
    try {
      await invoke("open_in_explorer", { filePath: record.originalPath });
    } catch (e) {
      console.error("Failed to open explorer:", e);
    }
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(record.originalPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const formatTime = (totalSec: number) => {
    if (isNaN(totalSec) || totalSec === 0) return "00:00";
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6 select-none animate-in fade-in duration-200">
      <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl max-w-4xl w-full max-h-[90vh]">
        {/* Modal Header */}
        <div className="h-12 border-b border-zinc-800/80 px-4 flex items-center justify-between bg-zinc-900/90">
          <div className="flex items-center gap-2 text-zinc-200">
            <div className="p-1 rounded-md bg-red-950/80 border border-red-800/50 text-red-400">
              <Film className="w-4 h-4" />
            </div>
            <span className="font-semibold text-xs tracking-wide">
              Screen Recording Preview
            </span>
            <span className="text-[10px] text-zinc-400 font-mono bg-zinc-800/80 px-2 py-0.5 rounded">
              {record.width} × {record.height}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyPath}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded transition-colors"
              title="Copy Video File Path"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied!" : "Copy Path"}</span>
            </button>

            <button
              onClick={handleOpenExplorer}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded transition-colors"
              title="Reveal file in Windows Explorer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>Explorer</span>
            </button>

            <button
              onClick={handleExport}
              disabled={exporting || !videoSrc}
              className="flex items-center gap-1 text-[11px] font-semibold text-white bg-[#F36F21] hover:bg-[#ff7d33] px-3 py-1 rounded shadow-md shadow-orange-600/30 transition-all disabled:opacity-50"
              title="Save As WebM / MP4 Video"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting ? "Saving..." : "Save As Video"}</span>
            </button>

            {onDelete && (
              <button
                onClick={() => {
                  onDelete(record.id);
                  onClose();
                }}
                className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors ml-1"
                title="Delete Recording"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors ml-1"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Canvas Container */}
        <div
          onClick={togglePlay}
          className="relative flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden min-h-[380px] max-h-[580px] cursor-pointer group"
        >
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => setIsPlaying(false)}
              className="max-w-full max-h-full object-contain"
              playsInline
            />
          ) : (
            <div className="flex items-center gap-2 text-zinc-400 text-xs animate-pulse">
              <span>Loading video...</span>
            </div>
          )}

          {/* Large Center Play Overlay when paused */}
          {!isPlaying && videoSrc && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-all pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-2xl transform scale-100 group-hover:scale-110 transition-transform">
                <Play className="w-8 h-8 fill-current ml-1" />
              </div>
            </div>
          )}
        </div>

        {/* Custom Media Controls Bar */}
        <div className="bg-zinc-900 border-t border-zinc-800 p-3 space-y-2">
          {/* Timeline Scrubber */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400 w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.05}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 accent-red-500 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
            />
            <span className="text-[11px] font-mono text-zinc-400 w-10">
              {formatTime(duration)}
            </span>
          </div>

          {/* Action row */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
              </button>

              <div className="flex items-center gap-1.5 text-zinc-400">
                <button
                  onClick={toggleMute}
                  className="p-1 rounded hover:text-zinc-200 transition-colors"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 accent-zinc-400 bg-zinc-800 h-1 rounded cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (videoRef.current?.requestFullscreen) {
                    videoRef.current.requestFullscreen();
                  }
                }}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                title="Fullscreen playback"
              >
                <Maximize className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
