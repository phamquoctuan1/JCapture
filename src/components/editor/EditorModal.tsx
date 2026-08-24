import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  MousePointer,
  ArrowRight,
  Square,
  Circle,
  Minus,
  Pencil,
  Type,
  Highlighter,
  EyeOff,
  ListOrdered,
  Crop,
  Trash2,
  RotateCcw,
  Undo2,
  Redo2,
  Copy,
  Save,
  Download,
  X,
  Check,
  ZoomIn,
  ZoomOut,
  Pipette,
  Layers,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Maximize2,
  Columns,
  Rows,
  Grid2X2,
  Scissors,
  Bold,
  Italic,
  Underline,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  AnnotationObject,
  AnnotationProject,
  CaptureRecord,
  ImageOverlayObject,
  PenObject,
  TextObject,
  ToolType,
} from "../../types";

export interface InitialMergeConfig {
  records: CaptureRecord[];
  layout: "horizontal" | "vertical" | "grid";
}

interface EditorModalProps {
  record: CaptureRecord;
  captures?: CaptureRecord[];
  initialMerge?: InitialMergeConfig;
  onSelectRecord?: (record: CaptureRecord) => void;
  onClose: () => void;
  onUpdateRecord: (record: CaptureRecord) => void;
}

interface EditorHistorySnapshot {
  objects: AnnotationObject[];
  bgSrc: string;
  canvasWidth: number;
  canvasHeight: number;
}

type ResizeHandleType = "nw" | "ne" | "se" | "sw" | "n" | "s" | "e" | "w";

const COLORS = [
  "#FFDE2A", // Brand Yellow
  "#EF4444", // Red
  "#F97316", // Orange
  "#EAB308", // Yellow
  "#22C55E", // Green
  "#06B6D4", // Cyan
  "#3B82F6", // Blue
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#FFFFFF", // White
  "#000000", // Black
];

const STROKE_WIDTHS = [2, 4, 6, 8, 12];
const overlayImageCache = new Map<string, HTMLImageElement>();

// Helper to compute Smart Auto-Layout for Image Overlays
const calculateAutoLayout = (
  imgObjs: ImageOverlayObject[],
  layout: "horizontal" | "vertical" | "grid"
): { laidOutObjects: ImageOverlayObject[]; newDim: { width: number; height: number } } => {
  if (imgObjs.length === 0) return { laidOutObjects: [], newDim: { width: 1200, height: 800 } };

  const gap = 24;
  const padding = 36;

  if (layout === "horizontal") {
    // Standardize matching height (e.g. 500px)
    const targetH = Math.max(320, Math.min(650, Math.round(imgObjs.reduce((acc, o) => acc + o.height, 0) / imgObjs.length)));
    let curX = padding;
    const laidOutObjects = imgObjs.map((img) => {
      const aspect = img.width / (img.height || 1);
      const w = Math.round(targetH * aspect);
      const res: ImageOverlayObject = {
        ...img,
        x: curX,
        y: padding,
        width: w,
        height: targetH,
      };
      curX += w + gap;
      return res;
    });
    const newDim = { width: Math.max(900, curX - gap + padding), height: Math.max(600, targetH + padding * 2) };
    return { laidOutObjects, newDim };
  } else if (layout === "vertical") {
    // Standardize matching width (e.g. 800px)
    const targetW = Math.max(500, Math.min(950, Math.round(imgObjs.reduce((acc, o) => acc + o.width, 0) / imgObjs.length)));
    let curY = padding;
    const laidOutObjects = imgObjs.map((img) => {
      const aspect = img.height / (img.width || 1);
      const h = Math.round(targetW * aspect);
      const res: ImageOverlayObject = {
        ...img,
        x: padding,
        y: curY,
        width: targetW,
        height: h,
      };
      curY += h + gap;
      return res;
    });
    const newDim = { width: Math.max(800, targetW + padding * 2), height: Math.max(600, curY - gap + padding) };
    return { laidOutObjects, newDim };
  } else {
    // 2x2 or 3x3 Grid
    const maxCols = imgObjs.length <= 4 ? 2 : 3;
    const cellW = 540;
    const cellH = 380;
    const laidOutObjects = imgObjs.map((img, idx) => {
      const col = idx % maxCols;
      const row = Math.floor(idx / maxCols);
      const x = padding + col * (cellW + gap);
      const y = padding + row * (cellH + gap);
      return {
        ...img,
        x,
        y,
        width: cellW,
        height: cellH,
      };
    });
    const totalCols = Math.min(imgObjs.length, maxCols);
    const totalRows = Math.ceil(imgObjs.length / maxCols);
    const newDim = {
      width: Math.max(900, padding * 2 + totalCols * cellW + (totalCols - 1) * gap),
      height: Math.max(600, padding * 2 + totalRows * cellH + (totalRows - 1) * gap),
    };
    return { laidOutObjects, newDim };
  }
};

export const EditorModal: React.FC<EditorModalProps> = ({
  record,
  captures = [],
  initialMerge,
  onSelectRecord,
  onClose,
  onUpdateRecord,
}) => {
  const [activeTool, setActiveTool] = useState<ToolType | "eyedropper">("select");
  const [currentColor, setCurrentColor] = useState<string>("#FFDE2A");
  const [currentStrokeWidth, setCurrentStrokeWidth] = useState<number>(4);
  const [fillShape, setFillShape] = useState<boolean>(false);
  const [stepCounter, setStepCounter] = useState<number>(1);

  // Zoom & Viewport state
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [showBottomDock, setShowBottomDock] = useState<boolean>(true);

  // Canvas size state (can be expanded to arrange/merge multiple images side-by-side)
  const [canvasDim, setCanvasDim] = useState<{ width: number; height: number }>({ width: 800, height: 600 });

  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Magnetic Smart Snap Alignment Guides (Figma-style)
  const [snapGuides, setSnapGuides] = useState<{ xLines: number[]; yLines: number[] }>({
    xLines: [],
    yLines: [],
  });

  // Cursor state based on hover over handles
  const [cursorStyle, setCursorStyle] = useState<string>("default");

  // Full history stack supporting Undo/Redo of annotations, crops, and resize
  const [history, setHistory] = useState<EditorHistorySnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Text Box Editor State
  const [textBoxEditor, setTextBoxEditor] = useState<{
    visible: boolean;
    editingId: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    fontSize: number;
    textColor: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    hasBorder: boolean;
    borderColor: string;
    borderWidth: number;
    hasBg: boolean;
    bgColor: string;
  }>({
    visible: false,
    editingId: null,
    x: 0,
    y: 0,
    width: 240,
    height: 80,
    text: "",
    fontSize: 22,
    textColor: "#EF4444",
    bold: false,
    italic: false,
    underline: false,
    hasBorder: true,
    borderColor: "#EF4444",
    borderWidth: 2,
    hasBg: true,
    bgColor: "#FFFFFF",
  });

  // Crop mode state
  const [isCropMode, setIsCropMode] = useState(false);
  const [isCropOutMode, setIsCropOutMode] = useState(false);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isCropped, setIsCropped] = useState(false);

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const originalDataUrlRef = useRef<string>("");
  const currentBgSrcRef = useRef<string>("");

  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exported, setExported] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Interaction refs
  const isDrawingRef = useRef(false);
  const isDraggingObjectRef = useRef(false);
  const isResizingRef = useRef(false);
  const activeHandleRef = useRef<ResizeHandleType | null>(null);
  const resizeInitialObjRef = useRef<AnnotationObject | null>(null);
  const resizeStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragInitialObjRef = useRef<AnnotationObject | null>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentTempObjectRef = useRef<AnnotationObject | null>(null);
  const internalCopiedObjectRef = useRef<AnnotationObject | null>(null);

  // 1. Load Background Image & Project Annotations
  useEffect(() => {
    let isMounted = true;
    setBgImage(null);
    setSelectedId(null);
    setIsCropMode(false);
    setCropRect(null);
    setIsCropped(false);

    const loadData = async () => {
      try {
        const dataUrl = await invoke<string>("read_image_base64", {
          filePath: record.originalPath,
        });

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = dataUrl;
        img.onload = () => {
          if (isMounted) {
            setBgImage(img);
            originalDataUrlRef.current = dataUrl;
            currentBgSrcRef.current = dataUrl;
            setCanvasDim({ width: img.naturalWidth, height: img.naturalHeight });
          }
        };

        if (initialMerge && initialMerge.records.length > 0) {
          const loadedImgs: ImageOverlayObject[] = [];
          for (let i = 0; i < initialMerge.records.length; i++) {
            const rec = initialMerge.records[i];
            const imgData = await invoke<string>("read_image_base64", { filePath: rec.originalPath });
            const overlayImg = new Image();
            overlayImg.src = imgData;
            overlayImageCache.set(imgData, overlayImg);

            loadedImgs.push({
              id: `img_merge_${Date.now()}_${i}`,
              type: "image",
              x: 0,
              y: 0,
              width: rec.width,
              height: rec.height,
              src: imgData,
            });
          }

          const { laidOutObjects, newDim } = calculateAutoLayout(loadedImgs, initialMerge.layout);
          if (isMounted) {
            setObjects(laidOutObjects);
            setCanvasDim(newDim);
            setHistory([
              {
                objects: laidOutObjects,
                bgSrc: dataUrl,
                canvasWidth: newDim.width,
                canvasHeight: newDim.height,
              },
            ]);
            setHistoryIndex(0);
            setStepCounter(1);
          }
        } else if (record.projectPath) {
          const jsonStr = await invoke<string>("load_annotation_project", {
            projectPath: record.projectPath,
          });
          const project: AnnotationProject = JSON.parse(jsonStr);
          if (isMounted && project.objects) {
            setObjects(project.objects);
            setHistory([
              {
                objects: project.objects,
                bgSrc: dataUrl,
                canvasWidth: project.canvasWidth || 800,
                canvasHeight: project.canvasHeight || 600,
              },
            ]);
            setHistoryIndex(0);

            for (const obj of project.objects) {
              if (obj.type === "image" && !overlayImageCache.has(obj.src)) {
                const overlayImg = new Image();
                overlayImg.src = obj.src;
                overlayImageCache.set(obj.src, overlayImg);
              }
            }

            const maxStep = project.objects
              .filter((o): o is import("../../types").StepBadgeObject => o.type === "stepBadge")
              .reduce((max, obj) => Math.max(max, obj.number), 0);
            setStepCounter(maxStep + 1);
          }
        } else {
          setObjects([]);
          setHistory([
            {
              objects: [],
              bgSrc: dataUrl,
              canvasWidth: record.width || 800,
              canvasHeight: record.height || 600,
            },
          ]);
          setHistoryIndex(0);
          setStepCounter(1);
        }
      } catch (err) {
        console.error("Failed to load editor data:", err);
      }
    };

    loadData();
    return () => {
      isMounted = false;
    };
  }, [record.id, record.originalPath, record.projectPath, record.width, record.height]);

  // Push new state to undo/redo history
  const pushState = useCallback((newObjects: AnnotationObject[], newBgSrc?: string, newDim?: { width: number; height: number }) => {
    const activeBgSrc = newBgSrc || currentBgSrcRef.current;
    const activeDim = newDim || canvasDim;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({
      objects: newObjects,
      bgSrc: activeBgSrc,
      canvasWidth: activeDim.width,
      canvasHeight: activeDim.height,
    });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setObjects(newObjects);
    if (newDim) setCanvasDim(newDim);
  }, [history, historyIndex, canvasDim]);

  // Control + Z (Undo)
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      const targetSnapshot = history[nextIdx];
      setHistoryIndex(nextIdx);
      setObjects(targetSnapshot.objects);
      setSelectedId(null);
      setCanvasDim({ width: targetSnapshot.canvasWidth, height: targetSnapshot.canvasHeight });

      if (targetSnapshot.bgSrc && targetSnapshot.bgSrc !== currentBgSrcRef.current) {
        const revertImg = new Image();
        revertImg.src = targetSnapshot.bgSrc;
        revertImg.onload = () => {
          setBgImage(revertImg);
          currentBgSrcRef.current = targetSnapshot.bgSrc;
          setIsCropped(targetSnapshot.bgSrc !== originalDataUrlRef.current);
        };
      }
    }
  }, [historyIndex, history]);

  // Control + Y (Redo)
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      const targetSnapshot = history[nextIdx];
      setHistoryIndex(nextIdx);
      setObjects(targetSnapshot.objects);
      setSelectedId(null);
      setCanvasDim({ width: targetSnapshot.canvasWidth, height: targetSnapshot.canvasHeight });

      if (targetSnapshot.bgSrc && targetSnapshot.bgSrc !== currentBgSrcRef.current) {
        const revertImg = new Image();
        revertImg.src = targetSnapshot.bgSrc;
        revertImg.onload = () => {
          setBgImage(revertImg);
          currentBgSrcRef.current = targetSnapshot.bgSrc;
          setIsCropped(targetSnapshot.bgSrc !== originalDataUrlRef.current);
        };
      }
    }
  }, [historyIndex, history]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    const newObjects = objects.filter((o) => o.id !== selectedId);
    setSelectedId(null);
    pushState(newObjects);
  }, [selectedId, objects, pushState]);

  const handleClearAll = useCallback(() => {
    if (objects.length === 0) return;
    if (window.confirm("Are you sure you want to clear all annotations?")) {
      setSelectedId(null);
      pushState([]);
      setStepCounter(1);
    }
  }, [objects.length, pushState]);

  // Expand canvas to fit multiple images/annotations comfortably
  const handleExpandCanvas = (extraW: number, extraH: number) => {
    const newW = canvasDim.width + extraW;
    const newH = canvasDim.height + extraH;
    setCanvasDim({ width: newW, height: newH });
    pushState(objects, undefined, { width: newW, height: newH });
  };

  // Shrink / Reduce canvas dimensions
  const handleShrinkCanvas = (subW: number, subH: number) => {
    const minW = bgImage ? Math.min(bgImage.naturalWidth, 400) : 400;
    const minH = bgImage ? Math.min(bgImage.naturalHeight, 300) : 300;
    const newW = Math.max(minW, canvasDim.width - subW);
    const newH = Math.max(minH, canvasDim.height - subH);
    setCanvasDim({ width: newW, height: newH });
    pushState(objects, undefined, { width: newW, height: newH });
  };

  // Auto trim canvas to tightly fit all content
  const handleTrimToContent = () => {
    let maxR = bgImage ? bgImage.naturalWidth : 400;
    let maxB = bgImage ? bgImage.naturalHeight : 300;

    for (const obj of objects) {
      const b = getObjectBoundingBox(obj);
      if (b.maxX > maxR) maxR = Math.ceil(b.maxX) + 20;
      if (b.maxY > maxB) maxB = Math.ceil(b.maxY) + 20;
    }

    const newW = Math.max(300, maxR);
    const newH = Math.max(200, maxB);
    setCanvasDim({ width: newW, height: newH });
    pushState(objects, undefined, { width: newW, height: newH });
  };

  // Smart Auto-Layout for Image Overlays (Side-by-Side, Vertical, Grid)
  const handleAutoLayout = (layout: "horizontal" | "vertical" | "grid") => {
    const imgObjs = objects.filter((o): o is ImageOverlayObject => o.type === "image");
    if (imgObjs.length === 0) return;

    const nonImgObjs = objects.filter((o) => o.type !== "image");
    const { laidOutObjects, newDim } = calculateAutoLayout(imgObjs, layout);
    const nextObjects = [...nonImgObjs, ...laidOutObjects];
    setCanvasDim(newDim);
    pushState(nextObjects, undefined, newDim);
  };

  // Revert back to original uncropped image
  const handleRevertToOriginal = () => {
    if (!originalDataUrlRef.current) return;
    const img = new Image();
    img.src = originalDataUrlRef.current;
    img.onload = () => {
      setBgImage(img);
      currentBgSrcRef.current = originalDataUrlRef.current;
      setIsCropped(false);
      const newDim = { width: img.naturalWidth, height: img.naturalHeight };
      setCanvasDim(newDim);
      pushState(objects, originalDataUrlRef.current, newDim);
    };
  };

  const handleZoomIn = () => setZoomLevel((z) => Math.min(4.0, Number((z + 0.25).toFixed(2))));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))));
  const handleZoomReset = () => setZoomLevel(1.0);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) handleZoomIn();
      else handleZoomOut();
    }
  };

  const handleTriggerEyedropper = async () => {
    if ("EyeDropper" in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) {
          handleUpdateSelectedColor(result.sRGBHex);
          setActiveTool("select");
        }
      } catch {
        setActiveTool("eyedropper");
      }
    } else {
      setActiveTool("eyedropper");
    }
  };

  const handleCopyMerged = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const dataUrl = canvas.toDataURL("image/png");
      await invoke("copy_image_base64_to_clipboard", { base64Data: dataUrl });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy edited image:", err);
    }
  }, []);

  const handleExportImageAs = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const dataUrl = canvas.toDataURL("image/png");
      const defaultName = `JCapture_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`;
      const savedPath = await invoke<string | null>("export_image_as_dialog", {
        base64Data: dataUrl,
        defaultName,
      });

      if (savedPath) {
        setExported(true);
        setTimeout(() => setExported(false), 1500);
      }
    } catch (err) {
      console.error("Failed to export image:", err);
    }
  }, []);

  const handleSaveProject = useCallback(async () => {
    if (!bgImage) return;

    const project: AnnotationProject = {
      version: 1,
      captureId: record.id,
      canvasWidth: canvasDim.width,
      canvasHeight: canvasDim.height,
      objects,
    };

    try {
      const projectPath = await invoke<string>("save_annotation_project", {
        captureId: record.id,
        jsonContent: JSON.stringify(project, null, 2),
      });

      onUpdateRecord({ ...record, projectPath });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error("Failed to save project:", err);
    }
  }, [bgImage, record, canvasDim, objects, onUpdateRecord]);

  // Insert image overlay onto canvas with auto-expansion if needed
  const insertImageOverlay = useCallback(async (filePathOrBase64: string, dropX?: number, dropY?: number) => {
    let base64Data = filePathOrBase64;
    if (!filePathOrBase64.startsWith("data:image")) {
      try {
        base64Data = await invoke<string>("read_image_base64", { filePath: filePathOrBase64 });
      } catch (err) {
        console.error("Failed to read image for overlay:", err);
        return;
      }
    }

    const img = new Image();
    img.src = base64Data;
    img.onload = () => {
      overlayImageCache.set(base64Data, img);

      // Default size
      let w = img.naturalWidth || 300;
      let h = img.naturalHeight || 200;
      const maxDim = 450;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      let curW = canvasDim.width;
      let curH = canvasDim.height;

      let posX = dropX !== undefined ? dropX : Math.round((curW - w) / 2);
      let posY = dropY !== undefined ? dropY : Math.round((curH - h) / 2);

      // Expand canvas if dropped outside
      let nextW = curW;
      let nextH = curH;
      if (posX + w > nextW) nextW = posX + w + 40;
      if (posY + h > nextH) nextH = posY + h + 40;

      const newId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const imgObj: ImageOverlayObject = {
        id: newId,
        type: "image",
        x: posX,
        y: posY,
        width: w,
        height: h,
        src: base64Data,
      };

      if (nextW !== curW || nextH !== curH) {
        setCanvasDim({ width: nextW, height: nextH });
        pushState([...objects, imgObj], undefined, { width: nextW, height: nextH });
      } else {
        pushState([...objects, imgObj]);
      }

      setSelectedId(newId);
      setActiveTool("select");
    };
  }, [objects, canvasDim, pushState]);

  // Global Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+C, Ctrl+V, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (textBoxEditor.visible) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) handleDeleteSelected();
      } else if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleExportImageAs();
      } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (selectedId) {
          const selObj = objects.find((o) => o.id === selectedId);
          if (selObj) internalCopiedObjectRef.current = selObj;
        }
        handleCopyMerged();
      } else if (e.ctrlKey && e.key.toLowerCase() === "v") {
        if (internalCopiedObjectRef.current) {
          const copied = internalCopiedObjectRef.current;
          const newId = `obj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          const pastedObj = moveObjectFromOrigin(copied, 20, 20);
          pastedObj.id = newId;
          pushState([...objects, pastedObj]);
          setSelectedId(newId);
        }
      } else if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        handleZoomIn();
      } else if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        handleZoomOut();
      } else if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        handleZoomReset();
      } else if (e.key === "Escape") {
        if (selectedId) setSelectedId(null);
        else if (isCropMode) {
          setIsCropMode(false);
          setCropRect(null);
        } else if (isCropOutMode) {
          setIsCropOutMode(false);
          setCropRect(null);
        } else if (activeTool === "eyedropper") {
          setActiveTool("select");
        }
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (textBoxEditor.visible) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (evt) => {
              const src = evt.target?.result as string;
              if (src) insertImageOverlay(src);
            };
            reader.readAsDataURL(blob);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("paste", handlePaste);
    };
  }, [
    selectedId,
    isCropMode,
    isCropOutMode,
    textBoxEditor.visible,
    activeTool,
    objects,
    handleDeleteSelected,
    handleUndo,
    handleRedo,
    handleCopyMerged,
    handleExportImageAs,
    insertImageOverlay,
    pushState,
  ]);

  // 2. Render Canvas Frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bgImage) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== canvasDim.width || canvas.height !== canvasDim.height) {
      canvas.width = canvasDim.width;
      canvas.height = canvasDim.height;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw background image
    ctx.drawImage(bgImage, 0, 0);

    const allObjects = [...objects];
    if (currentTempObjectRef.current) {
      allObjects.push(currentTempObjectRef.current);
    }

    for (const obj of allObjects) {
      if (textBoxEditor.visible && textBoxEditor.editingId === obj.id) {
        continue;
      }
      drawAnnotationObject(ctx, obj, bgImage);
    }

    if (selectedId && !isCropMode && !isCropOutMode) {
      const selObj = objects.find((o) => o.id === selectedId);
      if (selObj && (!textBoxEditor.visible || textBoxEditor.editingId !== selObj.id)) {
        drawSelectionBox(ctx, selObj);
      }
    }

    if ((isCropMode || isCropOutMode) && cropRect && cropRect.w > 0 && cropRect.h > 0) {
      drawCropOverlay(ctx, cropRect, canvas.width, canvas.height, isCropOutMode);
    }

    // Draw Figma-Style Magnetic Alignment Guides
    if (snapGuides.xLines.length > 0 || snapGuides.yLines.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#06b6d4";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      for (const lx of snapGuides.xLines) {
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx, canvas.height);
        ctx.stroke();
      }

      for (const ly of snapGuides.yLines) {
        ctx.beginPath();
        ctx.moveTo(0, ly);
        ctx.lineTo(canvas.width, ly);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [bgImage, canvasDim, objects, selectedId, isCropMode, isCropOutMode, cropRect, snapGuides, textBoxEditor]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const hitTestObject = (x: number, y: number): AnnotationObject | null => {
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (isPointInsideObject(x, y, obj)) {
        return obj;
      }
    }
    return null;
  };

  // Check if click/hover is on a resize handle of the selected object
  const hitTestHandle = (x: number, y: number, obj: AnnotationObject): ResizeHandleType | null => {
    const bounds = getObjectBoundingBox(obj);
    const pad = 6;
    const bx = bounds.minX - pad;
    const by = bounds.minY - pad;
    const bw = bounds.maxX - bounds.minX + pad * 2;
    const bh = bounds.maxY - bounds.minY + pad * 2;

    const handleRadius = 8;
    const handles: { type: ResizeHandleType; cx: number; cy: number }[] = [
      { type: "nw", cx: bx, cy: by },
      { type: "ne", cx: bx + bw, cy: by },
      { type: "se", cx: bx + bw, cy: by + bh },
      { type: "sw", cx: bx, cy: by + bh },
      { type: "n", cx: bx + bw / 2, cy: by },
      { type: "s", cx: bx + bw / 2, cy: by + bh },
      { type: "w", cx: bx, cy: by + bh / 2 },
      { type: "e", cx: bx + bw, cy: by + bh / 2 },
    ];

    for (const h of handles) {
      if (Math.hypot(x - h.cx, y - h.cy) <= handleRadius) {
        return h.type;
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    startPosRef.current = { x, y };

    if (textBoxEditor.visible) {
      handleCommitTextBox();
    }

    if (activeTool === "eyedropper") {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
          const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase()}`;
          handleUpdateSelectedColor(hex);
          setActiveTool("select");
        }
      }
      return;
    }

    if (isCropMode || isCropOutMode) {
      isDrawingRef.current = true;
      setCropRect({ x, y, w: 0, h: 0 });
      return;
    }

    if (activeTool === "select") {
      // 1. Check if clicking on resize handle of currently selected object
      if (selectedId) {
        const selObj = objects.find((o) => o.id === selectedId);
        if (selObj) {
          const handle = hitTestHandle(x, y, selObj);
          if (handle) {
            isResizingRef.current = true;
            activeHandleRef.current = handle;
            resizeInitialObjRef.current = JSON.parse(JSON.stringify(selObj));
            resizeStartPosRef.current = { x, y };
            return;
          }
        }
      }

      // 2. Check if clicking inside another object
      const hit = hitTestObject(x, y);
      if (hit) {
        setSelectedId(hit.id);
        isDraggingObjectRef.current = true;
        dragStartPosRef.current = { x, y };
        dragInitialObjRef.current = JSON.parse(JSON.stringify(hit));
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (activeTool === "text") {
      isDrawingRef.current = true;
      currentTempObjectRef.current = {
        id: "temp_text",
        type: "rect",
        x,
        y,
        width: 0,
        height: 0,
        color: currentColor,
        strokeWidth: currentStrokeWidth,
        fillColor: "rgba(15, 23, 42, 0.5)",
      };
      return;
    }

    isDrawingRef.current = true;
    const newId = `obj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    if (activeTool === "step") {
      const stepObj: AnnotationObject = {
        id: newId,
        type: "stepBadge",
        x,
        y,
        number: stepCounter,
        color: currentColor,
        textColor: currentColor === "#FFDE2A" || currentColor === "#FFFFFF" ? "#000000" : "#FFFFFF",
        radius: Math.max(16, currentStrokeWidth * 4),
      };
      setStepCounter((c) => c + 1);
      pushState([...objects, stepObj]);
      setSelectedId(newId);
      isDrawingRef.current = false;
      return;
    }

    if (activeTool === "pen") {
      const penObj: PenObject = {
        id: newId,
        type: "pen",
        points: [{ x, y }],
        color: currentColor,
        strokeWidth: currentStrokeWidth,
      };
      currentTempObjectRef.current = penObj;
    } else if (activeTool === "arrow") {
      currentTempObjectRef.current = {
        id: newId,
        type: "arrow",
        startX: x,
        startY: y,
        endX: x,
        endY: y,
        color: currentColor,
        strokeWidth: currentStrokeWidth,
      };
    } else if (activeTool === "rect") {
      currentTempObjectRef.current = {
        id: newId,
        type: "rect",
        x,
        y,
        width: 0,
        height: 0,
        color: currentColor,
        strokeWidth: currentStrokeWidth,
        fillColor: fillShape ? `${currentColor}33` : undefined,
      };
    } else if (activeTool === "ellipse") {
      currentTempObjectRef.current = {
        id: newId,
        type: "ellipse",
        x,
        y,
        radiusX: 0,
        radiusY: 0,
        color: currentColor,
        strokeWidth: currentStrokeWidth,
        fillColor: fillShape ? `${currentColor}33` : undefined,
      };
    } else if (activeTool === "line") {
      currentTempObjectRef.current = {
        id: newId,
        type: "line",
        startX: x,
        startY: y,
        endX: x,
        endY: y,
        color: currentColor,
        strokeWidth: currentStrokeWidth,
      };
    } else if (activeTool === "highlight") {
      currentTempObjectRef.current = {
        id: newId,
        type: "highlight",
        x,
        y,
        width: 0,
        height: 0,
        color: currentColor,
        opacity: 0.35,
      };
    } else if (activeTool === "blur") {
      currentTempObjectRef.current = {
        id: newId,
        type: "blur",
        x,
        y,
        width: 0,
        height: 0,
        blurRadius: 15,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);

    // Update dynamic hover cursor for handles
    if (activeTool === "select" && selectedId && !isResizingRef.current && !isDraggingObjectRef.current) {
      const selObj = objects.find((o) => o.id === selectedId);
      if (selObj) {
        const handle = hitTestHandle(x, y, selObj);
        if (handle === "nw" || handle === "se") setCursorStyle("nwse-resize");
        else if (handle === "ne" || handle === "sw") setCursorStyle("nesw-resize");
        else if (handle === "n" || handle === "s") setCursorStyle("ns-resize");
        else if (handle === "e" || handle === "w") setCursorStyle("ew-resize");
        else if (isPointInsideObject(x, y, selObj)) setCursorStyle("move");
        else setCursorStyle("default");
      }
    }

    if ((isCropMode || isCropOutMode) && isDrawingRef.current) {
      const start = startPosRef.current;
      const r = {
        x: Math.min(start.x, x),
        y: Math.min(start.y, y),
        w: Math.abs(x - start.x),
        h: Math.abs(y - start.y),
      };
      setCropRect(r);

      const canvas = canvasRef.current;
      if (canvas && bgImage) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#09090b";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bgImage, 0, 0);
          for (const obj of objects) {
            drawAnnotationObject(ctx, obj, bgImage);
          }
          if (r.w > 0 && r.h > 0) {
            drawCropOverlay(ctx, r, canvas.width, canvas.height, isCropOutMode);
          }
        }
      }
      return;
    }

    // Handle Object Resizing (Smooth transform with handles)
    if (isResizingRef.current && selectedId && resizeInitialObjRef.current && activeHandleRef.current) {
      const dx = x - resizeStartPosRef.current.x;
      const dy = y - resizeStartPosRef.current.y;
      const initial = resizeInitialObjRef.current;
      const handle = activeHandleRef.current;

      setObjects((prev) =>
        prev.map((obj) => {
          if (obj.id !== selectedId) return obj;
          return resizeObjectFromOrigin(initial, handle, dx, dy);
        })
      );
      return;
    }

    // Handle Object Dragging / Moving with Figma-Style Magnetic Snap
    if (isDraggingObjectRef.current && selectedId && dragInitialObjRef.current) {
      let dx = x - dragStartPosRef.current.x;
      let dy = y - dragStartPosRef.current.y;
      const initial = dragInitialObjRef.current;
      const currentBounds = getObjectBoundingBox(moveObjectFromOrigin(initial, dx, dy));

      const snapThreshold = 10;
      const activeXLines: number[] = [];
      const activeYLines: number[] = [];

      // Collect candidate snap targets (other objects + canvas edges & centers)
      const targetX = [0, canvasDim.width / 2, canvasDim.width];
      const targetY = [0, canvasDim.height / 2, canvasDim.height];

      for (const obj of objects) {
        if (obj.id === selectedId) continue;
        const b = getObjectBoundingBox(obj);
        targetX.push(b.minX, b.maxX, (b.minX + b.maxX) / 2);
        targetY.push(b.minY, b.maxY, (b.minY + b.maxY) / 2);
      }

      // Test Snap X (left, right, center)
      const curCenterX = (currentBounds.minX + currentBounds.maxX) / 2;
      for (const tx of targetX) {
        if (Math.abs(currentBounds.minX - tx) < snapThreshold) {
          dx += tx - currentBounds.minX;
          activeXLines.push(tx);
          break;
        } else if (Math.abs(currentBounds.maxX - tx) < snapThreshold) {
          dx += tx - currentBounds.maxX;
          activeXLines.push(tx);
          break;
        } else if (Math.abs(curCenterX - tx) < snapThreshold) {
          dx += tx - curCenterX;
          activeXLines.push(tx);
          break;
        }
      }

      // Test Snap Y (top, bottom, center)
      const curCenterY = (currentBounds.minY + currentBounds.maxY) / 2;
      for (const ty of targetY) {
        if (Math.abs(currentBounds.minY - ty) < snapThreshold) {
          dy += ty - currentBounds.minY;
          activeYLines.push(ty);
          break;
        } else if (Math.abs(currentBounds.maxY - ty) < snapThreshold) {
          dy += ty - currentBounds.maxY;
          activeYLines.push(ty);
          break;
        } else if (Math.abs(curCenterY - ty) < snapThreshold) {
          dy += ty - curCenterY;
          activeYLines.push(ty);
          break;
        }
      }

      setSnapGuides({ xLines: activeXLines, yLines: activeYLines });

      setObjects((prev) =>
        prev.map((obj) => {
          if (obj.id !== selectedId) return obj;
          return moveObjectFromOrigin(initial, dx, dy);
        })
      );
      return;
    }

    if (!isDrawingRef.current || !currentTempObjectRef.current) return;
    const start = startPosRef.current;
    const temp = currentTempObjectRef.current;

    if (temp.type === "pen") {
      temp.points.push({ x, y });
    } else if (temp.type === "arrow" || temp.type === "line") {
      temp.endX = x;
      temp.endY = y;
    } else if (temp.type === "rect" || temp.type === "highlight" || temp.type === "blur") {
      temp.x = Math.min(start.x, x);
      temp.y = Math.min(start.y, y);
      temp.width = Math.abs(x - start.x);
      temp.height = Math.abs(y - start.y);
    } else if (temp.type === "ellipse") {
      temp.x = (start.x + x) / 2;
      temp.y = (start.y + y) / 2;
      temp.radiusX = Math.abs(x - start.x) / 2;
      temp.radiusY = Math.abs(y - start.y) / 2;
    }

    const canvas = canvasRef.current;
    if (canvas && bgImage) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#09090b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bgImage, 0, 0);
        for (const obj of [...objects, temp]) {
          drawAnnotationObject(ctx, obj, bgImage);
        }
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setSnapGuides({ xLines: [], yLines: [] });

    if (isCropMode || isCropOutMode) {
      isDrawingRef.current = false;
      return;
    }

    if (isResizingRef.current) {
      isResizingRef.current = false;
      activeHandleRef.current = null;
      resizeInitialObjRef.current = null;
      pushState(objects);
      return;
    }

    if (isDraggingObjectRef.current) {
      isDraggingObjectRef.current = false;
      dragInitialObjRef.current = null;
      pushState(objects);
      return;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (activeTool === "text") {
      const { x, y } = getCanvasCoords(e);
      const start = startPosRef.current;
      currentTempObjectRef.current = null;

      const minX = Math.min(start.x, x);
      const minY = Math.min(start.y, y);
      const boxW = Math.max(160, Math.abs(x - start.x));
      const boxH = Math.max(60, Math.abs(y - start.y));

      setTextBoxEditor({
        visible: true,
        editingId: null,
        x: minX,
        y: minY,
        width: boxW,
        height: boxH,
        text: "",
        fontSize: Math.max(18, currentStrokeWidth * 5),
        textColor: currentColor,
        bold: false,
        italic: false,
        underline: false,
        hasBorder: true,
        borderColor: currentColor,
        borderWidth: Math.max(2, currentStrokeWidth),
        hasBg: true,
        bgColor: "#FFFFFF",
      });
      return;
    }

    if (currentTempObjectRef.current) {
      const finalObj = currentTempObjectRef.current;
      currentTempObjectRef.current = null;

      let isSignificant = true;
      if (finalObj.type === "rect" || finalObj.type === "highlight" || finalObj.type === "blur") {
        if (finalObj.width < 5 || finalObj.height < 5) isSignificant = false;
      } else if (finalObj.type === "arrow" || finalObj.type === "line") {
        const dist = Math.hypot(finalObj.endX - finalObj.startX, finalObj.endY - finalObj.startY);
        if (dist < 5) isSignificant = false;
      } else if (finalObj.type === "pen") {
        if (finalObj.points.length < 2) isSignificant = false;
      }

      if (isSignificant) {
        pushState([...objects, finalObj]);
        setSelectedId(finalObj.id);
      }
    }
  };

  // Double Click to Edit Existing Text
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const clickedObj = [...objects].reverse().find((obj) => isPointInsideObject(x, y, obj));
    if (clickedObj && clickedObj.type === "text") {
      const textObj = clickedObj as TextObject;
      setTextBoxEditor({
        visible: true,
        editingId: textObj.id,
        x: textObj.x,
        y: textObj.y,
        width: textObj.width || 240,
        height: textObj.height || 80,
        text: textObj.text,
        fontSize: textObj.fontSize || 22,
        textColor: textObj.color || "#EF4444",
        bold: !!textObj.bold,
        italic: !!textObj.italic,
        underline: !!textObj.underline,
        hasBorder: textObj.hasBorder !== undefined ? textObj.hasBorder : !!textObj.borderColor,
        borderColor: textObj.borderColor || textObj.color || "#EF4444",
        borderWidth: textObj.borderWidth || 2,
        hasBg: textObj.hasBg !== undefined ? textObj.hasBg : !!textObj.bgColor,
        bgColor: textObj.bgColor || "#FFFFFF",
      });
      setSelectedId(textObj.id);
    }
  };

  const handleCommitTextBox = () => {
    if (!textBoxEditor.text.trim()) {
      if (textBoxEditor.editingId) {
        pushState(objects.filter((o) => o.id !== textBoxEditor.editingId));
      }
      setTextBoxEditor((prev) => ({ ...prev, visible: false, text: "", editingId: null }));
      return;
    }

    const targetId = textBoxEditor.editingId || `txt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const textObj: TextObject = {
      id: targetId,
      type: "text",
      x: textBoxEditor.x,
      y: textBoxEditor.y,
      width: textBoxEditor.width,
      height: textBoxEditor.height,
      text: textBoxEditor.text,
      fontSize: textBoxEditor.fontSize,
      color: textBoxEditor.textColor,
      bold: textBoxEditor.bold,
      italic: textBoxEditor.italic,
      underline: textBoxEditor.underline,
      hasBg: textBoxEditor.hasBg,
      bgColor: textBoxEditor.hasBg ? textBoxEditor.bgColor : undefined,
      hasBorder: textBoxEditor.hasBorder,
      borderColor: textBoxEditor.hasBorder ? textBoxEditor.borderColor : undefined,
      borderWidth: textBoxEditor.hasBorder ? textBoxEditor.borderWidth : undefined,
    };

    if (textBoxEditor.editingId) {
      pushState(objects.map((o) => (o.id === textBoxEditor.editingId ? textObj : o)));
    } else {
      pushState([...objects, textObj]);
    }

    setSelectedId(targetId);
    setTextBoxEditor((prev) => ({ ...prev, visible: false, text: "", editingId: null }));
    setActiveTool("select");
  };

  // Crop Action: Overwrites disk file and database record permanently
  const handleApplyCrop = async () => {
    if (!cropRect || cropRect.w < 10 || cropRect.h < 10 || !bgImage) return;

    const cropCanvas = document.createElement("canvas");
    const cropW = Math.round(cropRect.w);
    const cropH = Math.round(cropRect.h);
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;

    cropCtx.drawImage(
      bgImage,
      Math.round(cropRect.x),
      Math.round(cropRect.y),
      cropW,
      cropH,
      0,
      0,
      cropW,
      cropH
    );

    const croppedDataUrl = cropCanvas.toDataURL("image/png");
    const croppedImg = new Image();
    croppedImg.src = croppedDataUrl;
    croppedImg.onload = async () => {
      setBgImage(croppedImg);
      currentBgSrcRef.current = croppedDataUrl;
      originalDataUrlRef.current = croppedDataUrl;
      setIsCropped(false);

      const newDim = { width: cropW, height: cropH };
      setCanvasDim(newDim);

      const shiftedObjects = objects
        .map((obj) => moveObjectFromOrigin(obj, -Math.round(cropRect.x), -Math.round(cropRect.y)))
        .filter((obj) => isObjectInsideBounds(obj, cropW, cropH));

      pushState(shiftedObjects, croppedDataUrl, newDim);
      setIsCropMode(false);
      setCropRect(null);

      // Overwrite file on disk and in database
      try {
        const updatedRecord = await invoke<CaptureRecord>("overwrite_capture_image", {
          id: record.id,
          base64Data: croppedDataUrl,
          width: cropW,
          height: cropH,
        });
        if (updatedRecord) {
          onUpdateRecord(updatedRecord);
        }
      } catch (err) {
        console.error("Failed to overwrite cropped capture on disk:", err);
      }
    };
  };

  // Crop Out Action: Cuts out the selected area and joins the remaining image pieces or erases area
  const handleApplyCropOut = async (mode: "strip-vertical" | "strip-horizontal" | "erase") => {
    if (!cropRect || cropRect.w < 5 || cropRect.h < 5 || !bgImage) return;

    const cutX = Math.round(cropRect.x);
    const cutY = Math.round(cropRect.y);
    const cutW = Math.round(cropRect.w);
    const cutH = Math.round(cropRect.h);
    const curW = canvasDim.width;
    const curH = canvasDim.height;

    const outCanvas = document.createElement("canvas");
    let newW = curW;
    let newH = curH;

    if (mode === "strip-vertical") {
      // Cut out horizontal strip from cutY to cutY + cutH, collapse top and bottom
      newH = Math.max(20, curH - cutH);
      outCanvas.width = newW;
      outCanvas.height = newH;
      const ctx = outCanvas.getContext("2d");
      if (!ctx) return;

      // Top piece: from 0 to cutY
      if (cutY > 0) {
        ctx.drawImage(bgImage, 0, 0, curW, cutY, 0, 0, curW, cutY);
      }
      // Bottom piece: from cutY + cutH to curH -> placed at cutY
      const bottomH = curH - (cutY + cutH);
      if (bottomH > 0) {
        ctx.drawImage(bgImage, 0, cutY + cutH, curW, bottomH, 0, cutY, curW, bottomH);
      }
    } else if (mode === "strip-horizontal") {
      // Cut out vertical strip from cutX to cutX + cutW, collapse left and right
      newW = Math.max(20, curW - cutW);
      outCanvas.width = newW;
      outCanvas.height = newH;
      const ctx = outCanvas.getContext("2d");
      if (!ctx) return;

      // Left piece: from 0 to cutX
      if (cutX > 0) {
        ctx.drawImage(bgImage, 0, 0, cutX, curH, 0, 0, cutX, curH);
      }
      // Right piece: from cutX + cutW to curW -> placed at cutX
      const rightW = curW - (cutX + cutW);
      if (rightW > 0) {
        ctx.drawImage(bgImage, cutX + cutW, 0, rightW, curH, cutX, 0, rightW, curH);
      }
    } else {
      // Erase Area
      outCanvas.width = newW;
      outCanvas.height = newH;
      const ctx = outCanvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bgImage, 0, 0, curW, curH);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(cutX, cutY, cutW, cutH);
    }

    const outDataUrl = outCanvas.toDataURL("image/png");
    const outImg = new Image();
    outImg.src = outDataUrl;
    outImg.onload = async () => {
      setBgImage(outImg);
      currentBgSrcRef.current = outDataUrl;
      originalDataUrlRef.current = outDataUrl;
      setIsCropped(false);

      const newDim = { width: newW, height: newH };
      setCanvasDim(newDim);

      // Adjust annotations for collapsed strips
      let shiftedObjects = objects;
      if (mode === "strip-vertical") {
        shiftedObjects = objects
          .map((obj) => {
            const topY = "y" in obj ? (obj as any).y : "startY" in obj ? Math.min((obj as any).startY, (obj as any).endY) : 0;
            if (topY >= cutY + cutH) {
              return moveObjectFromOrigin(obj, 0, -cutH);
            }
            return obj;
          })
          .filter((obj) => isObjectInsideBounds(obj, newW, newH));
      } else if (mode === "strip-horizontal") {
        shiftedObjects = objects
          .map((obj) => {
            const leftX = "x" in obj ? (obj as any).x : "startX" in obj ? Math.min((obj as any).startX, (obj as any).endX) : 0;
            if (leftX >= cutX + cutW) {
              return moveObjectFromOrigin(obj, -cutW, 0);
            }
            return obj;
          })
          .filter((obj) => isObjectInsideBounds(obj, newW, newH));
      }

      pushState(shiftedObjects, outDataUrl, newDim);
      setIsCropMode(false);
      setCropRect(null);

      // Overwrite file on disk and in database
      try {
        const updatedRecord = await invoke<CaptureRecord>("overwrite_capture_image", {
          id: record.id,
          base64Data: outDataUrl,
          width: newW,
          height: newH,
        });
        if (updatedRecord) {
          onUpdateRecord(updatedRecord);
        }
      } catch (err) {
        console.error("Failed to overwrite cropped capture on disk:", err);
      }
    };
  };

  const handleUpdateSelectedColor = (newColor: string) => {
    setCurrentColor(newColor);
    if (selectedId) {
      const updated = objects.map((obj) => {
        if (obj.id !== selectedId) return obj;
        if (obj.type === "text") {
          return { ...obj, color: newColor };
        }
        if ("color" in obj) {
          return { ...obj, color: newColor };
        }
        return obj;
      });
      pushState(updated);
    }
  };

  const handleToggleSelectedTextProp = (prop: "bold" | "italic" | "underline" | "hasBorder" | "hasBg") => {
    if (!selectedId) return;
    const updated = objects.map((obj) => {
      if (obj.id !== selectedId || obj.type !== "text") return obj;
      if (prop === "hasBorder") {
        const nextVal = obj.hasBorder !== false && !!obj.borderColor ? false : true;
        return {
          ...obj,
          hasBorder: nextVal,
          borderColor: nextVal ? obj.borderColor || obj.color || "#EF4444" : undefined,
          borderWidth: nextVal ? obj.borderWidth || 2 : undefined,
        };
      }
      if (prop === "hasBg") {
        const nextVal = obj.hasBg !== false && !!obj.bgColor ? false : true;
        return {
          ...obj,
          hasBg: nextVal,
          bgColor: nextVal ? obj.bgColor || "#FFFFFF" : undefined,
        };
      }
      return {
        ...obj,
        [prop]: !obj[prop],
      };
    });
    pushState(updated);
  };

  const handleUpdateSelectedTextProp = (prop: string, val: any) => {
    if (!selectedId) return;
    const updated = objects.map((obj) => {
      if (obj.id !== selectedId || obj.type !== "text") return obj;
      return {
        ...obj,
        [prop]: val,
      };
    });
    pushState(updated);
  };

  const handleUpdateSelectedStroke = (newWidth: number) => {
    setCurrentStrokeWidth(newWidth);
    if (selectedId) {
      const updated = objects.map((obj) => {
        if (obj.id !== selectedId) return obj;
        if ("strokeWidth" in obj) {
          return { ...obj, strokeWidth: newWidth };
        }
        if ("borderWidth" in obj) {
          return { ...obj, borderWidth: newWidth };
        }
        return obj;
      });
      pushState(updated);
    }
  };

  // Robust Drag & Drop on Canvas
  const handleDropOnCanvas = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const canvas = canvasRef.current;
    let dropX: number | undefined;
    let dropY: number | undefined;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      dropX = Math.round((e.clientX - rect.left) * scaleX);
      dropY = Math.round((e.clientY - rect.top) * scaleY);
    }

    const jsonStr = e.dataTransfer.getData("application/json");
    const textStr = e.dataTransfer.getData("text/plain");

    if (jsonStr) {
      try {
        const item: CaptureRecord = JSON.parse(jsonStr);
        if (item.originalPath) {
          insertImageOverlay(item.originalPath, dropX, dropY);
          return;
        }
      } catch {}
    }

    if (textStr && (textStr.includes("\\") || textStr.includes("/") || textStr.startsWith("data:image"))) {
      insertImageOverlay(textStr, dropX, dropY);
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const src = evt.target?.result as string;
          if (src) insertImageOverlay(src, dropX, dropY);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col select-none animate-in fade-in duration-150">
      {/* Top Toolbar - Fully Responsive with Glassmorphism Badges */}
      <div className="min-h-[52px] h-auto border-b border-zinc-800/80 bg-zinc-900/95 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shadow-lg backdrop-blur-md">
        {/* Left: Tools Group */}
        <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none">
          <ToolButton
            active={activeTool === "select" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("select");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<MousePointer className="w-4 h-4" />}
            label="Select, Move & Resize with Handles (V)"
          />
          <ToolButton
            active={activeTool === "pen" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("pen");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<Pencil className="w-4 h-4" />}
            label="Freehand Pen / Doodle"
          />
          <ToolButton
            active={activeTool === "arrow" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("arrow");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<ArrowRight className="w-4 h-4 -rotate-45" />}
            label="Arrow (A)"
          />
          <ToolButton
            active={activeTool === "rect" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("rect");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<Square className="w-4 h-4" />}
            label="Rectangle (R)"
          />
          <ToolButton
            active={activeTool === "ellipse" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("ellipse");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<Circle className="w-4 h-4" />}
            label="Ellipse (O)"
          />
          <ToolButton
            active={activeTool === "line" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("line");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<Minus className="w-4 h-4" />}
            label="Line (L)"
          />
          <ToolButton
            active={activeTool === "text" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("text");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<Type className="w-4 h-4" />}
            label="Text Box (Drag box with border color)"
          />
          <ToolButton
            active={activeTool === "highlight" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("highlight");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<Highlighter className="w-4 h-4" />}
            label="Highlighter"
          />
          <ToolButton
            active={activeTool === "blur" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("blur");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<EyeOff className="w-4 h-4" />}
            label="Blur / Obfuscate"
          />
          <ToolButton
            active={activeTool === "step" && !isCropMode && !isCropOutMode}
            onClick={() => {
              setActiveTool("step");
              setIsCropMode(false);
              setIsCropOutMode(false);
            }}
            icon={<ListOrdered className="w-4 h-4" />}
            label="Step Number Badge (①②③)"
          />
          <ToolButton
            active={isCropMode}
            onClick={() => {
              setIsCropMode(!isCropMode);
              setIsCropOutMode(false);
              setSelectedId(null);
            }}
            icon={<Crop className="w-4 h-4 text-emerald-400" />}
            label="Crop Image (Keep Area)"
          />
          <ToolButton
            active={isCropOutMode}
            onClick={() => {
              setIsCropOutMode(!isCropOutMode);
              setIsCropMode(false);
              setSelectedId(null);
            }}
            icon={<Scissors className="w-4 h-4 text-amber-400" />}
            label="Crop Out / Cutout (Cut strip & join image)"
          />

          {/* Revert crop button */}
          {isCropped && (
            <button
              onClick={handleRevertToOriginal}
              className="p-1.5 px-2 rounded-lg bg-zinc-800 text-amber-400 hover:bg-amber-500/20 text-xs flex items-center gap-1 font-medium transition-colors"
              title="Revert back to original uncropped image"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Uncrop</span>
            </button>
          )}

          {/* Canvas Size Adjust Controls: + Canvas, - Canvas, Fit */}
          <div className="flex items-center gap-0.5 bg-zinc-950/70 p-0.5 rounded-lg border border-zinc-800">
            <button
              onClick={() => handleExpandCanvas(300, 200)}
              className="p-1 px-1.5 rounded text-sky-400 hover:bg-sky-500/20 text-xs flex items-center gap-1 font-medium transition-colors"
              title="Expand Canvas Workspace (+300w, +200h)"
            >
              <Maximize2 className="w-3 h-3" />
              <span>+ Canvas</span>
            </button>
            <button
              onClick={() => handleShrinkCanvas(300, 200)}
              className="p-1 px-1.5 rounded text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 text-xs flex items-center gap-1 font-medium transition-colors"
              title="Shrink / Reduce Canvas Size (-300w, -200h)"
            >
              <span>- Canvas</span>
            </button>
            <button
              onClick={handleTrimToContent}
              className="p-1 px-1.5 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 text-[10px] font-medium transition-colors"
              title="Auto Trim Canvas to fit around all images & drawings"
            >
              <span>Fit</span>
            </button>
          </div>

          {/* Smart Auto-Layout controls when images exist on canvas */}
          {objects.some((o) => o.type === "image") && (
            <div className="flex items-center gap-0.5 bg-indigo-950/40 p-0.5 rounded-lg border border-indigo-500/30 animate-in fade-in">
              <button
                onClick={() => handleAutoLayout("horizontal")}
                className="p-1 px-1.5 rounded text-sky-300 hover:bg-sky-500/20 text-xs flex items-center gap-1 font-medium transition-colors"
                title="Smart Auto-Layout: Side-by-Side horizontally (Ghép hàng ngang)"
              >
                <Columns className="w-3 h-3" />
                <span className="hidden sm:inline">Row</span>
              </button>
              <button
                onClick={() => handleAutoLayout("vertical")}
                className="p-1 px-1.5 rounded text-indigo-300 hover:bg-indigo-500/20 text-xs flex items-center gap-1 font-medium transition-colors"
                title="Smart Auto-Layout: Stack vertically (Ghép hàng dọc)"
              >
                <Rows className="w-3 h-3" />
                <span className="hidden sm:inline">Stack</span>
              </button>
              <button
                onClick={() => handleAutoLayout("grid")}
                className="p-1 px-1.5 rounded text-amber-300 hover:bg-amber-500/20 text-xs flex items-center gap-1 font-medium transition-colors"
                title="Smart Auto-Layout: Grid Matrix (Ghép lưới)"
              >
                <Grid2X2 className="w-3 h-3" />
                <span className="hidden sm:inline">Grid</span>
              </button>
            </div>
          )}

          <div className="h-5 w-px bg-zinc-800 mx-0.5" />

          {/* Delete Selected Item */}
          {selectedId && (
            <button
              onClick={handleDeleteSelected}
              className="p-1.5 px-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white transition-all shadow-md flex items-center gap-1 text-xs font-semibold"
              title="Delete Selected Annotation (Del / Backspace)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Delete</span>
            </button>
          )}

          {/* Clear All Annotations */}
          <button
            onClick={handleClearAll}
            disabled={objects.length === 0}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 disabled:opacity-20 hover:bg-zinc-800 transition-colors"
            title="Clear All Annotations"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Undo / Redo */}
          <button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 disabled:opacity-20 hover:bg-zinc-800 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 disabled:opacity-20 hover:bg-zinc-800 transition-colors"
            title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Center: Style Options (Color Palette & Eyedropper & Stroke & Fill) */}
        <div className="flex items-center gap-1.5">
          {(() => {
            const selObj = objects.find((o) => o.id === selectedId);
            if (selObj && selObj.type === "text") {
              const textObj = selObj as TextObject;
              return (
                <div className="flex flex-wrap items-center gap-1.5 bg-zinc-900/90 border border-sky-500/40 p-1 rounded-xl shadow-lg animate-in fade-in">
                  {/* Font Size */}
                  <div className="flex items-center gap-0.5 bg-zinc-950/70 p-0.5 rounded-lg border border-zinc-800">
                    {[14, 18, 24, 32, 42].map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => handleUpdateSelectedTextProp("fontSize", sz)}
                        className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                          (textObj.fontSize || 22) === sz
                            ? "bg-amber-500 text-black font-bold"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>

                  {/* Bold, Italic, Underline */}
                  <div className="flex items-center gap-0.5 bg-zinc-950/70 p-0.5 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => handleToggleSelectedTextProp("bold")}
                      className={`p-1 rounded text-xs transition-colors ${
                        textObj.bold ? "bg-sky-600 text-white font-bold" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      }`}
                      title="Bold (Ctrl+B)"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleSelectedTextProp("italic")}
                      className={`p-1 rounded text-xs transition-colors ${
                        textObj.italic ? "bg-sky-600 text-white font-bold" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      }`}
                      title="Italic (Ctrl+I)"
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleSelectedTextProp("underline")}
                      className={`p-1 rounded text-xs transition-colors ${
                        textObj.underline ? "bg-sky-600 text-white font-bold" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      }`}
                      title="Underline (Ctrl+U)"
                    >
                      <Underline className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Text Font Color (T) */}
                  <div className="flex items-center gap-1 bg-zinc-950/70 p-1 rounded-lg border border-zinc-800" title="Text Font Color">
                    <span className="text-[10px] font-bold text-zinc-400 px-0.5">T</span>
                    {["#FFFFFF", "#000000", "#EF4444", "#3B82F6", "#22C55E", "#FFDE2A"].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleUpdateSelectedTextProp("color", c)}
                        className={`w-3.5 h-3.5 rounded-full transition-transform ${
                          (textObj.color || "").toUpperCase() === c.toUpperCase()
                            ? "scale-125 ring-2 ring-sky-400"
                            : "hover:scale-110 opacity-80 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: c, border: c === "#000000" ? "1px solid #444" : "none" }}
                      />
                    ))}
                    <div className="relative flex items-center justify-center w-3.5 h-3.5 rounded-full overflow-hidden border border-zinc-700 cursor-pointer">
                      <input
                        type="color"
                        value={textObj.color || "#EF4444"}
                        onChange={(e) => handleUpdateSelectedTextProp("color", e.target.value)}
                        className="absolute -top-2 -left-2 w-8 h-8 cursor-pointer opacity-0"
                      />
                      <div className="w-full h-full" style={{ backgroundColor: textObj.color || "#EF4444" }} />
                    </div>
                  </div>

                  {/* Independent Border Controls */}
                  <div className="flex items-center gap-1 bg-zinc-950/70 p-0.5 px-1 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => handleToggleSelectedTextProp("hasBorder")}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        textObj.hasBorder !== false && textObj.borderColor
                          ? "bg-amber-600/30 text-amber-300 font-bold border border-amber-500/40"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      Border: {textObj.hasBorder !== false && textObj.borderColor ? "ON" : "OFF"}
                    </button>
                    {textObj.hasBorder !== false && textObj.borderColor && (
                      <div className="flex items-center gap-1 pl-0.5 border-l border-zinc-800">
                        {["#EF4444", "#3B82F6", "#000000", "#FFFFFF", "#FFDE2A"].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => handleUpdateSelectedTextProp("borderColor", c)}
                            className={`w-2.5 h-2.5 rounded-full transition-transform ${
                              (textObj.borderColor || "").toUpperCase() === c.toUpperCase()
                                ? "scale-125 ring-1.5 ring-amber-400"
                                : "opacity-75 hover:opacity-100"
                            }`}
                            style={{ backgroundColor: c }}
                            title={`Border: ${c}`}
                          />
                        ))}
                        {[1, 2, 4].map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => handleUpdateSelectedTextProp("borderWidth", w)}
                            className={`px-1 py-0.2 text-[9px] font-mono rounded ${
                              (textObj.borderWidth || 2) === w
                                ? "bg-amber-500 text-black font-bold"
                                : "text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            {w}px
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Independent Background Fill Controls */}
                  <div className="flex items-center gap-1 bg-zinc-950/70 p-0.5 px-1 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => handleToggleSelectedTextProp("hasBg")}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        textObj.hasBg !== false && textObj.bgColor
                          ? "bg-sky-600/30 text-sky-300 font-bold border border-sky-500/40"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      Fill: {textObj.hasBg !== false && textObj.bgColor ? "ON" : "OFF"}
                    </button>
                    {textObj.hasBg !== false && textObj.bgColor && (
                      <div className="flex items-center gap-1 pl-0.5 border-l border-zinc-800">
                        {[
                          { name: "White", val: "#FFFFFF" },
                          { name: "Dark", val: "#0F172A" },
                          { name: "Note", val: "#FEF08A" },
                          { name: "Cyan", val: "#CFFAFE" },
                        ].map((item) => (
                          <button
                            key={item.name}
                            type="button"
                            onClick={() => handleUpdateSelectedTextProp("bgColor", item.val)}
                            className={`w-2.5 h-2.5 rounded-full transition-transform ${
                              (textObj.bgColor || "").toUpperCase() === item.val.toUpperCase()
                                ? "scale-125 ring-1.5 ring-sky-400"
                                : "opacity-75 hover:opacity-100"
                            }`}
                            style={{ backgroundColor: item.val, border: "1px solid #444" }}
                            title={`Fill: ${item.name}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Edit Text Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setTextBoxEditor({
                        visible: true,
                        editingId: textObj.id,
                        x: textObj.x,
                        y: textObj.y,
                        width: textObj.width || 240,
                        height: textObj.height || 80,
                        text: textObj.text,
                        fontSize: textObj.fontSize || 22,
                        textColor: textObj.color || "#EF4444",
                        bold: !!textObj.bold,
                        italic: !!textObj.italic,
                        underline: !!textObj.underline,
                        hasBorder: textObj.hasBorder !== false && !!textObj.borderColor,
                        borderColor: textObj.borderColor || textObj.color || "#EF4444",
                        borderWidth: textObj.borderWidth || 2,
                        hasBg: textObj.hasBg !== false && !!textObj.bgColor,
                        bgColor: textObj.bgColor || "#FFFFFF",
                      });
                    }}
                    className="px-2 py-0.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                  >
                    <Type className="w-3.5 h-3.5" />
                    <span>Edit Text</span>
                  </button>
                </div>
              );
            }

            return (
              <>
                {/* Color Palette + Eyedropper */}
                <div className="flex items-center gap-1 bg-zinc-950/70 p-1 rounded-lg border border-zinc-800">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => handleUpdateSelectedColor(c)}
                      className={`w-3.5 h-3.5 rounded-full transition-transform ${
                        currentColor.toUpperCase() === c.toUpperCase()
                          ? "scale-125 ring-2 ring-sky-400 ring-offset-1 ring-offset-zinc-900 shadow-sm"
                          : "hover:scale-110 opacity-85 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}

                  {/* Custom Color Picker Input */}
                  <div className="relative flex items-center justify-center w-3.5 h-3.5 rounded-full overflow-hidden border border-zinc-700 cursor-pointer" title="Custom Color Picker">
                    <input
                      type="color"
                      value={currentColor}
                      onChange={(e) => handleUpdateSelectedColor(e.target.value)}
                      className="absolute -top-2 -left-2 w-8 h-8 cursor-pointer opacity-0"
                    />
                    <div className="w-full h-full" style={{ backgroundColor: currentColor }} />
                  </div>

                  {/* Eyedropper Tool */}
                  <button
                    onClick={handleTriggerEyedropper}
                    className={`p-0.5 rounded transition-colors ${
                      activeTool === "eyedropper"
                        ? "bg-amber-500 text-black"
                        : "text-zinc-400 hover:text-amber-400 hover:bg-zinc-800"
                    }`}
                    title="Eyedropper / Bút chọn màu (Click to pick color)"
                  >
                    <Pipette className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Stroke Width */}
                <div className="flex items-center gap-0.5 bg-zinc-950/70 p-1 rounded-lg border border-zinc-800">
                  {STROKE_WIDTHS.map((w) => (
                    <button
                      key={w}
                      onClick={() => handleUpdateSelectedStroke(w)}
                      className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                        currentStrokeWidth === w
                          ? "bg-sky-600 text-white font-bold"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {w}p
                    </button>
                  ))}
                </div>

                {/* Fill shape toggle */}
                <button
                  onClick={() => setFillShape(!fillShape)}
                  className={`px-1.5 py-1 text-[10px] font-medium rounded-lg border transition-all ${
                    fillShape
                      ? "bg-sky-600/30 text-sky-300 border-sky-500/50 font-bold"
                      : "bg-zinc-950/60 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                  }`}
                  title="Toggle Semi-transparent Fill for Shapes"
                >
                  {fillShape ? "Fill" : "Outline"}
                </button>
              </>
            );
          })()}

          <div className="h-5 w-px bg-zinc-800 mx-0.5" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 bg-zinc-950/70 p-1 rounded-lg border border-zinc-800">
            <button
              onClick={handleZoomOut}
              className="p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              title="Zoom Out (Ctrl -)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomReset}
              className="px-1 py-0.5 text-[10px] font-mono text-zinc-300 hover:text-white font-medium"
              title="Reset Zoom to 100% (Ctrl 0)"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              title="Zoom In (Ctrl +)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Actions (Copy, Save Image As, Save Project, Close) */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopyMerged}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-sky-600/20"
            title="Copy result image to clipboard (Ctrl+C)"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? "Copied!" : "Copy"}</span>
          </button>

          <button
            onClick={handleExportImageAs}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-emerald-600/20"
            title="Save annotated image as PNG / JPG (Ctrl+S)"
          >
            {exported ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{exported ? "Saved!" : "Save As"}</span>
          </button>

          <button
            onClick={handleSaveProject}
            className="flex items-center gap-1 px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold transition-all border border-zinc-700"
            title="Save vector project (re-editable later)"
          >
            {saved ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Save className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{saved ? "Saved" : "Project"}</span>
          </button>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors ml-1"
            title="Close Editor (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={handleDropOnCanvas}
        className="flex-1 overflow-auto bg-zinc-950 flex items-center justify-center p-8 relative"
      >
        {/* Floating Crop (Keep) Actions Banner */}
        {isCropMode && (
          <div className="absolute top-6 z-30 bg-zinc-900/95 border border-emerald-500/80 px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2.5 animate-in slide-in-from-top-2">
            <span className="text-xs text-zinc-200 font-medium mr-1 flex items-center gap-1.5">
              <Crop className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {cropRect && cropRect.w > 5 && cropRect.h > 5
                  ? `Crop Area: ${Math.round(cropRect.w)} × ${Math.round(cropRect.h)} px`
                  : "Drag on canvas to crop & keep selected area"}
              </span>
            </span>
            {cropRect && cropRect.w > 5 && cropRect.h > 5 && (
              <button
                type="button"
                onClick={handleApplyCrop}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-md shadow-emerald-600/30"
                title="Keep selected area and crop out everything else"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply Crop</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsCropMode(false);
                setCropRect(null);
              }}
              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-all ml-1"
            >
              Cancel (Esc)
            </button>
          </div>
        )}

        {/* Floating Crop Out (Cutout & Remove Strip) Actions Banner */}
        {isCropOutMode && (
          <div className="absolute top-6 z-30 bg-zinc-900/95 border border-amber-500/80 px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2.5 animate-in slide-in-from-top-2">
            <span className="text-xs text-zinc-200 font-medium mr-1 flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {cropRect && cropRect.w > 5 && cropRect.h > 5
                  ? `Cutout Strip: ${Math.round(cropRect.w)} × ${Math.round(cropRect.h)} px`
                  : "Drag box over section to cut out & join image"}
              </span>
            </span>
            {cropRect && cropRect.w > 5 && cropRect.h > 5 && (
              <>
                <button
                  type="button"
                  onClick={() => handleApplyCropOut(cropRect.w >= cropRect.h ? "strip-vertical" : "strip-horizontal")}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-md shadow-amber-600/30"
                  title="Remove this strip and join remaining pieces together"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Cut & Join</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleApplyCropOut("erase")}
                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
                  title="Erase / clear content in selected area"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>Erase Area</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setIsCropOutMode(false);
                setCropRect(null);
              }}
              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-all ml-1"
            >
              Cancel (Esc)
            </button>
          </div>
        )}

        {!bgImage ? (
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-sky-500 animate-spin" />
            <span className="text-xs">Loading capture image...</span>
          </div>
        ) : (
          <div
            className="relative"
            style={{
              transform: `scale(${zoomLevel})`,
              transformOrigin: "center center",
              transition: "transform 0.1s ease-out",
            }}
          >
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={handleDropOnCanvas}
              style={{
                cursor:
                isCropMode || activeTool === "eyedropper"
                  ? "crosshair"
                  : activeTool === "select"
                  ? cursorStyle
                  : "crosshair",
              }}
              className="shadow-2xl border border-zinc-800/80 rounded-lg max-w-none"
            />

            {/* Direct In-Place Inline Text Box Editor on Canvas */}
            {textBoxEditor.visible && (
              <div
                style={{
                  position: "absolute",
                  left: textBoxEditor.x,
                  top: textBoxEditor.y,
                  width: Math.max(160, textBoxEditor.width),
                  minHeight: Math.max(42, textBoxEditor.height),
                  zIndex: 50,
                }}
                className="flex flex-col select-text pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Floating mini formatting bar above active text box */}
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 0,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-wrap items-center gap-1.5 bg-zinc-900/95 border border-zinc-700/80 p-1.5 rounded-xl shadow-2xl text-xs z-50 whitespace-nowrap backdrop-blur-md max-w-[540px]"
                >
                  {/* Font Size */}
                  <div className="flex items-center gap-0.5 bg-zinc-950/70 p-0.5 rounded-lg border border-zinc-800">
                    {[14, 18, 24, 32, 42].map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setTextBoxEditor((prev) => ({ ...prev, fontSize: sz }))}
                        className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                          textBoxEditor.fontSize === sz
                            ? "bg-amber-500 text-black font-bold"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>

                  {/* Rich Text Style (Bold, Italic, Underline) */}
                  <div className="flex items-center gap-0.5 bg-zinc-950/70 p-0.5 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTextBoxEditor((prev) => ({ ...prev, bold: !prev.bold }))}
                      className={`p-1 rounded text-xs transition-colors ${
                        textBoxEditor.bold
                          ? "bg-sky-600 text-white font-bold"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      }`}
                      title="Bold (Ctrl+B)"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTextBoxEditor((prev) => ({ ...prev, italic: !prev.italic }))}
                      className={`p-1 rounded text-xs transition-colors ${
                        textBoxEditor.italic
                          ? "bg-sky-600 text-white font-bold"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      }`}
                      title="Italic (Ctrl+I)"
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTextBoxEditor((prev) => ({ ...prev, underline: !prev.underline }))}
                      className={`p-1 rounded text-xs transition-colors ${
                        textBoxEditor.underline
                          ? "bg-sky-600 text-white font-bold"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      }`}
                      title="Underline (Ctrl+U)"
                    >
                      <Underline className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Text Color Picker */}
                  <div className="flex items-center gap-1 bg-zinc-950/70 p-1 rounded-lg border border-zinc-800" title="Text Font Color">
                    <span className="text-[10px] font-bold text-zinc-400 px-0.5">T</span>
                    {["#FFFFFF", "#000000", "#EF4444", "#3B82F6", "#22C55E", "#FFDE2A"].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setTextBoxEditor((prev) => ({ ...prev, textColor: c }))}
                        className={`w-3 h-3 rounded-full transition-transform ${
                          textBoxEditor.textColor.toUpperCase() === c.toUpperCase()
                            ? "scale-125 ring-2 ring-sky-400"
                            : "hover:scale-110 opacity-80 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: c, border: c === "#000000" ? "1px solid #444" : "none" }}
                      />
                    ))}
                    <div className="relative flex items-center justify-center w-3 h-3 rounded-full overflow-hidden border border-zinc-700 cursor-pointer">
                      <input
                        type="color"
                        value={textBoxEditor.textColor}
                        onChange={(e) => setTextBoxEditor((prev) => ({ ...prev, textColor: e.target.value }))}
                        className="absolute -top-2 -left-2 w-8 h-8 cursor-pointer opacity-0"
                      />
                      <div className="w-full h-full" style={{ backgroundColor: textBoxEditor.textColor }} />
                    </div>
                  </div>

                  {/* Independent Border Controls */}
                  <div className="flex items-center gap-1 bg-zinc-950/70 p-0.5 px-1 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTextBoxEditor((prev) => ({ ...prev, hasBorder: !prev.hasBorder }))}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        textBoxEditor.hasBorder
                          ? "bg-amber-600/30 text-amber-300 font-bold border border-amber-500/40"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      Border: {textBoxEditor.hasBorder ? "ON" : "OFF"}
                    </button>

                    {textBoxEditor.hasBorder && (
                      <div className="flex items-center gap-1 pl-0.5 border-l border-zinc-800">
                        {["#EF4444", "#3B82F6", "#000000", "#FFFFFF", "#FFDE2A"].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setTextBoxEditor((prev) => ({ ...prev, borderColor: c }))}
                            className={`w-2.5 h-2.5 rounded-full transition-transform ${
                              textBoxEditor.borderColor.toUpperCase() === c.toUpperCase()
                                ? "scale-125 ring-1.5 ring-amber-400"
                                : "opacity-75 hover:opacity-100"
                            }`}
                            style={{ backgroundColor: c }}
                            title={`Border: ${c}`}
                          />
                        ))}
                        {[1, 2, 4].map((w) => (
                          <button
                            key={w}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setTextBoxEditor((prev) => ({ ...prev, borderWidth: w }))}
                            className={`px-1 py-0.2 text-[9px] font-mono rounded ${
                              textBoxEditor.borderWidth === w
                                ? "bg-amber-500 text-black font-bold"
                                : "text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            {w}px
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Independent Background Fill Controls */}
                  <div className="flex items-center gap-1 bg-zinc-950/70 p-0.5 px-1 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTextBoxEditor((prev) => ({ ...prev, hasBg: !prev.hasBg }))}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        textBoxEditor.hasBg
                          ? "bg-sky-600/30 text-sky-300 font-bold border border-sky-500/40"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      Fill: {textBoxEditor.hasBg ? "ON" : "OFF"}
                    </button>

                    {textBoxEditor.hasBg && (
                      <div className="flex items-center gap-1 pl-0.5 border-l border-zinc-800">
                        {[
                          { name: "White", val: "#FFFFFF" },
                          { name: "Dark", val: "#0F172A" },
                          { name: "Note", val: "#FEF08A" },
                          { name: "Cyan", val: "#CFFAFE" },
                        ].map((item) => (
                          <button
                            key={item.name}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setTextBoxEditor((prev) => ({ ...prev, bgColor: item.val }))}
                            className={`w-2.5 h-2.5 rounded-full transition-transform ${
                              textBoxEditor.bgColor.toUpperCase() === item.val.toUpperCase()
                                ? "scale-125 ring-1.5 ring-sky-400"
                                : "opacity-75 hover:opacity-100"
                            }`}
                            style={{ backgroundColor: item.val, border: "1px solid #444" }}
                            title={`Fill: ${item.name}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 ml-auto">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleCommitTextBox}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg flex items-center gap-1 shadow-md shadow-emerald-600/20"
                    >
                      <Check className="w-3 h-3" />
                      <span>Done</span>
                    </button>

                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTextBoxEditor((prev) => ({ ...prev, visible: false, text: "", editingId: null }))}
                      className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg"
                      title="Cancel (Esc)"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Direct In-Place Textarea */}
                <textarea
                  autoFocus
                  value={textBoxEditor.text}
                  onChange={(e) => setTextBoxEditor((prev) => ({ ...prev, text: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      if (e.key === "b" || e.key === "B") {
                        e.preventDefault();
                        setTextBoxEditor((prev) => ({ ...prev, bold: !prev.bold }));
                      } else if (e.key === "i" || e.key === "I") {
                        e.preventDefault();
                        setTextBoxEditor((prev) => ({ ...prev, italic: !prev.italic }));
                      } else if (e.key === "u" || e.key === "U") {
                        e.preventDefault();
                        setTextBoxEditor((prev) => ({ ...prev, underline: !prev.underline }));
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        handleCommitTextBox();
                      }
                    } else if (e.key === "Escape") {
                      setTextBoxEditor((prev) => ({ ...prev, visible: false, text: "", editingId: null }));
                    }
                  }}
                  placeholder="Type here..."
                  style={{
                    color: textBoxEditor.textColor,
                    fontSize: `${textBoxEditor.fontSize}px`,
                    lineHeight: 1.35,
                    fontFamily: "'Segoe UI', system-ui, sans-serif",
                    fontWeight: textBoxEditor.bold ? "bold" : "600",
                    fontStyle: textBoxEditor.italic ? "italic" : "normal",
                    textDecoration: textBoxEditor.underline ? "underline" : "none",
                    backgroundColor: textBoxEditor.hasBg ? textBoxEditor.bgColor : "rgba(15, 23, 42, 0.4)",
                    border: textBoxEditor.hasBorder
                      ? `${textBoxEditor.borderWidth}px solid ${textBoxEditor.borderColor}`
                      : "1.5px dashed rgba(255, 255, 255, 0.4)",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    width: "100%",
                    minHeight: `${Math.max(42, textBoxEditor.height)}px`,
                    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                    outline: "none",
                    resize: "both",
                  }}
                  className="caret-sky-400 font-semibold"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Filmstrip Dock: Drag image onto canvas to merge / Click to switch */}
      {captures.length > 0 && onSelectRecord && (
        <div className="border-t border-zinc-800/80 bg-zinc-900/90 backdrop-blur-md px-3 py-2 flex flex-col gap-1.5 shadow-2xl transition-all">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-400">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span>Recent Captures ({captures.length})</span>
              <span className="text-[10px] text-zinc-400 font-normal">
                (Kéo thả ảnh vào vùng vẽ để ghép • Click để chuyển ảnh)
              </span>
            </div>

            <button
              onClick={() => setShowBottomDock(!showBottomDock)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-[10px] flex items-center gap-1"
            >
              <span>{showBottomDock ? "Hide" : "Show"}</span>
              {showBottomDock ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
          </div>

          {showBottomDock && (
            <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin scrollbar-thumb-zinc-700">
              {captures.map((item) => (
                <BottomThumbnailCard
                  key={item.id}
                  item={item}
                  isActive={item.id === record.id}
                  onClick={() => onSelectRecord(item)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Bottom Miniature Card (Draggable for Merging & Quick Delete)
const BottomThumbnailCard: React.FC<{
  item: CaptureRecord;
  isActive: boolean;
  onClick: () => void;
}> = ({ item, isActive, onClick }) => {
  const [thumbSrc, setThumbSrc] = useState<string>("");

  useEffect(() => {
    let isMounted = true;
    const loadThumb = async () => {
      try {
        const dataUrl = await invoke<string>("read_image_base64", {
          filePath: item.thumbnailPath,
        });
        if (isMounted) setThumbSrc(dataUrl);
      } catch (err) {
        console.error("Failed to load thumbnail:", err);
      }
    };
    loadThumb();
    return () => {
      isMounted = false;
    };
  }, [item.thumbnailPath, item.updatedAt, item.width, item.height]);

  const handleDeleteItem = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("delete_capture", { id: item.id });
      window.dispatchEvent(new Event("focus"));
    } catch (err) {
      console.error("Failed to delete capture:", err);
    }
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.originalPath);
        e.dataTransfer.setData("application/json", JSON.stringify(item));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onClick}
      className={`group relative flex-shrink-0 w-32 h-20 rounded-lg overflow-hidden border cursor-grab active:cursor-grabbing transition-all select-none ${
        isActive
          ? "border-sky-400 ring-2 ring-sky-500/40 scale-105 shadow-md shadow-sky-500/20"
          : "border-zinc-800 hover:border-zinc-500 opacity-80 hover:opacity-100 hover:scale-[1.02]"
      }`}
      title="Click để chỉnh sửa • Kéo & Thả vào vùng vẽ để ghép ảnh"
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt="Thumbnail"
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <div className="w-full h-full bg-zinc-950 flex items-center justify-center text-[10px] text-zinc-600">
          Loading...
        </div>
      )}

      {/* Delete Button in top right on hover */}
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleDeleteItem}
          className="p-1 rounded bg-black/75 hover:bg-red-600 text-zinc-300 hover:text-white transition-all shadow-md backdrop-blur-sm"
          title="Xóa ảnh chụp này"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-1.5 py-0.5 text-[9px] text-zinc-300 font-mono flex items-center justify-between pointer-events-none">
        <span>{item.width}x{item.height}</span>
        <span className="text-[8px] text-zinc-400 font-sans">Kéo để ghép</span>
      </div>
    </div>
  );
};

const ToolButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`p-2 rounded-lg text-xs flex items-center gap-1.5 transition-all ${
      active
        ? "bg-sky-600 text-white shadow-md shadow-sky-600/20 font-bold"
        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
    }`}
    title={label}
  >
    {icon}
  </button>
);

function drawAnnotationObject(
  ctx: CanvasRenderingContext2D,
  obj: AnnotationObject,
  bgImage: HTMLImageElement
) {
  ctx.save();

  if (obj.type === "image") {
    let img = overlayImageCache.get(obj.src);
    if (!img) {
      img = new Image();
      img.src = obj.src;
      overlayImageCache.set(obj.src, img);
    }
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, obj.x, obj.y, obj.width, obj.height);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
    }
  } else if (obj.type === "pen") {
    if (obj.points.length > 0) {
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(obj.points[0].x, obj.points[0].y);
      for (let i = 1; i < obj.points.length; i++) {
        ctx.lineTo(obj.points[i].x, obj.points[i].y);
      }
      ctx.stroke();
    }
  } else if (obj.type === "arrow") {
    ctx.strokeStyle = obj.color;
    ctx.fillStyle = obj.color;
    ctx.lineWidth = obj.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(obj.startX, obj.startY);
    ctx.lineTo(obj.endX, obj.endY);
    ctx.stroke();

    const angle = Math.atan2(obj.endY - obj.startY, obj.endX - obj.startX);
    const headLength = Math.max(12, obj.strokeWidth * 3.5);

    ctx.beginPath();
    ctx.moveTo(obj.endX, obj.endY);
    ctx.lineTo(
      obj.endX - headLength * Math.cos(angle - Math.PI / 6),
      obj.endY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      obj.endX - headLength * Math.cos(angle + Math.PI / 6),
      obj.endY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  } else if (obj.type === "rect") {
    if (obj.fillColor) {
      ctx.fillStyle = obj.fillColor;
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
    }
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = obj.strokeWidth;
    ctx.beginPath();
    ctx.rect(obj.x, obj.y, obj.width, obj.height);
    ctx.stroke();
  } else if (obj.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(obj.x, obj.y, obj.radiusX, obj.radiusY, 0, 0, 2 * Math.PI);
    if (obj.fillColor) {
      ctx.fillStyle = obj.fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = obj.strokeWidth;
    ctx.stroke();
  } else if (obj.type === "line") {
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = obj.strokeWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(obj.startX, obj.startY);
    ctx.lineTo(obj.endX, obj.endY);
    ctx.stroke();
  } else if (obj.type === "text") {
    const fontSize = obj.fontSize || 22;
    const isBold = !!obj.bold;
    const isItalic = !!obj.italic;
    const isUnderline = !!obj.underline;

    ctx.font = `${isItalic ? "italic " : ""}${isBold ? "bold " : "600 "}${fontSize}px 'Segoe UI', system-ui, sans-serif`;

    const lines = obj.text.split("\n");
    const lineHeight = fontSize * 1.35;
    const padding = 10;

    let boxW = obj.width || 0;
    let boxH = obj.height || 0;

    if (!boxW || !boxH) {
      let maxLineWidth = 0;
      for (const line of lines) {
        maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
      }
      boxW = maxLineWidth + padding * 2;
      boxH = lines.length * lineHeight + padding * 2;
    }

    if (obj.hasBg !== false && obj.bgColor) {
      ctx.fillStyle = obj.bgColor;
      ctx.beginPath();
      ctx.roundRect(obj.x, obj.y, boxW, boxH, 8);
      ctx.fill();
    }

    if (obj.hasBorder !== false && obj.borderColor) {
      ctx.strokeStyle = obj.borderColor;
      ctx.lineWidth = obj.borderWidth || 2;
      ctx.beginPath();
      ctx.roundRect(obj.x, obj.y, boxW, boxH, 8);
      ctx.stroke();
    }

    ctx.fillStyle = obj.color || "#EF4444";
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      const lineY = obj.y + padding + i * lineHeight;
      ctx.fillText(lines[i], obj.x + padding, lineY);

      if (isUnderline) {
        const textMetrics = ctx.measureText(lines[i]);
        const underlineY = lineY + fontSize + 2;
        ctx.strokeStyle = obj.color || "#EF4444";
        ctx.lineWidth = Math.max(1.5, fontSize / 14);
        ctx.beginPath();
        ctx.moveTo(obj.x + padding, underlineY);
        ctx.lineTo(obj.x + padding + textMetrics.width, underlineY);
        ctx.stroke();
      }
    }
  } else if (obj.type === "highlight") {
    ctx.fillStyle = obj.color;
    ctx.globalAlpha = obj.opacity;
    ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
  } else if (obj.type === "blur") {
    if (obj.width > 2 && obj.height > 2) {
      const blockSize = 10;
      const sx = Math.max(0, Math.floor(obj.x));
      const sy = Math.max(0, Math.floor(obj.y));
      const sw = Math.min(bgImage.naturalWidth - sx, Math.floor(obj.width));
      const sh = Math.min(bgImage.naturalHeight - sy, Math.floor(obj.height));

      if (sw > 0 && sh > 0) {
        const imgData = ctx.getImageData(sx, sy, sw, sh);
        const data = imgData.data;

        for (let y = 0; y < sh; y += blockSize) {
          for (let x = 0; x < sw; x += blockSize) {
            const i = (y * sw + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            for (let dy = 0; dy < blockSize && y + dy < sh; dy++) {
              for (let dx = 0; dx < blockSize && x + dx < sw; dx++) {
                const targetIdx = ((y + dy) * sw + (x + dx)) * 4;
                data[targetIdx] = r;
                data[targetIdx + 1] = g;
                data[targetIdx + 2] = b;
              }
            }
          }
        }
        ctx.putImageData(imgData, sx, sy);
      }
    }
  } else if (obj.type === "stepBadge") {
    ctx.fillStyle = obj.color;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.radius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = obj.textColor;
    ctx.font = `bold ${obj.radius * 1.1}px 'Segoe UI', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(obj.number.toString(), obj.x, obj.y);
  }

  ctx.restore();
}

// Draw Selection outline and 8 resize handles for resizing
function drawSelectionBox(ctx: CanvasRenderingContext2D, obj: AnnotationObject) {
  const bounds = getObjectBoundingBox(obj);
  const pad = 6;
  const x = bounds.minX - pad;
  const y = bounds.minY - pad;
  const w = bounds.maxX - bounds.minX + pad * 2;
  const h = bounds.maxY - bounds.minY + pad * 2;

  ctx.save();
  ctx.strokeStyle = "#38BDF8";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x, y, w, h);

  // 8 Handles
  const handles = [
    { cx: x, cy: y },
    { cx: x + w / 2, cy: y },
    { cx: x + w, cy: y },
    { cx: x + w, cy: y + h / 2 },
    { cx: x + w, cy: y + h },
    { cx: x + w / 2, cy: y + h },
    { cx: x, cy: y + h },
    { cx: x, cy: y + h / 2 },
  ];

  ctx.setLineDash([]);
  const handleSize = 8;
  for (const c of handles) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(c.cx - handleSize / 2, c.cy - handleSize / 2, handleSize, handleSize);
    ctx.strokeStyle = "#0284C7";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.cx - handleSize / 2, c.cy - handleSize / 2, handleSize, handleSize);
  }

  // Dimension tag
  const dimText = `${Math.round(w - pad * 2)} × ${Math.round(h - pad * 2)}`;
  ctx.font = "bold 10px monospace";
  const tagW = ctx.measureText(dimText).width + 8;
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.beginPath();
  ctx.roundRect(x + w / 2 - tagW / 2, y + h + 8, tagW, 16, 4);
  ctx.fill();
  ctx.fillStyle = "#38BDF8";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(dimText, x + w / 2, y + h + 16);

  ctx.restore();
}

function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  crop: { x: number; y: number; w: number; h: number },
  cw: number,
  ch: number,
  isCropOut = false
) {
  ctx.save();
  if (isCropOut) {
    // Crop Out: Highlight strip to remove with amber/red overlay and dashed border
    ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
    ctx.fillRect(crop.x, crop.y, crop.w, crop.h);

    ctx.strokeStyle = "#F59E0B";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
  } else {
    // Crop Keep: Dim outside area, highlight inside with emerald border
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(0, 0, cw, crop.y);
    ctx.fillRect(0, crop.y + crop.h, cw, ch - (crop.y + crop.h));
    ctx.fillRect(0, crop.y, crop.x, crop.h);
    ctx.fillRect(crop.x + crop.w, crop.y, cw - (crop.x + crop.w), crop.h);

    ctx.strokeStyle = "#10B981";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
  }
  ctx.restore();
}

function getObjectBoundingBox(obj: AnnotationObject): { minX: number; minY: number; maxX: number; maxY: number } {
  if (obj.type === "image" || obj.type === "rect" || obj.type === "highlight" || obj.type === "blur") {
    return {
      minX: obj.x,
      minY: obj.y,
      maxX: obj.x + obj.width,
      maxY: obj.y + obj.height,
    };
  } else if (obj.type === "pen") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of obj.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  } else if (obj.type === "arrow" || obj.type === "line") {
    return {
      minX: Math.min(obj.startX, obj.endX),
      minY: Math.min(obj.startY, obj.endY),
      maxX: Math.max(obj.startX, obj.endX),
      maxY: Math.max(obj.startY, obj.endY),
    };
  } else if (obj.type === "ellipse") {
    return {
      minX: obj.x - obj.radiusX,
      minY: obj.y - obj.radiusY,
      maxX: obj.x + obj.radiusX,
      maxY: obj.y + obj.radiusY,
    };
  } else if (obj.type === "stepBadge") {
    return {
      minX: obj.x - obj.radius,
      minY: obj.y - obj.radius,
      maxX: obj.x + obj.radius,
      maxY: obj.y + obj.radius,
    };
  } else if (obj.type === "text") {
    return {
      minX: obj.x,
      minY: obj.y,
      maxX: obj.x + (obj.width || 200),
      maxY: obj.y + (obj.height || 60),
    };
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function isPointInsideObject(px: number, py: number, obj: AnnotationObject): boolean {
  const b = getObjectBoundingBox(obj);
  const pad = 8;
  return px >= b.minX - pad && px <= b.maxX + pad && py >= b.minY - pad && py <= b.maxY + pad;
}

function moveObjectFromOrigin(initial: AnnotationObject, dx: number, dy: number): AnnotationObject {
  if (initial.type === "pen") {
    return {
      ...initial,
      points: initial.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    };
  } else if (initial.type === "arrow" || initial.type === "line") {
    return {
      ...initial,
      startX: initial.startX + dx,
      startY: initial.startY + dy,
      endX: initial.endX + dx,
      endY: initial.endY + dy,
    };
  } else if (
    initial.type === "image" ||
    initial.type === "rect" ||
    initial.type === "highlight" ||
    initial.type === "blur" ||
    initial.type === "text" ||
    initial.type === "ellipse" ||
    initial.type === "stepBadge"
  ) {
    return {
      ...initial,
      x: initial.x + dx,
      y: initial.y + dy,
    };
  }
  return initial;
}

// Resize Object from handles with smooth proportional scaling for images
function resizeObjectFromOrigin(
  initial: AnnotationObject,
  handle: ResizeHandleType,
  dx: number,
  dy: number
): AnnotationObject {
  if (initial.type === "image" || initial.type === "rect" || initial.type === "highlight" || initial.type === "blur") {
    let nx = initial.x;
    let ny = initial.y;
    let nw = initial.width;
    let nh = initial.height;
    const minSize = 25;

    // Corner with aspect ratio preservation for images
    if (initial.type === "image" && (handle === "se" || handle === "sw" || handle === "ne" || handle === "nw")) {
      const origAspect = initial.width / (initial.height || 1);
      if (handle === "se") {
        nw = Math.max(minSize, initial.width + dx);
        nh = Math.round(nw / origAspect);
      } else if (handle === "sw") {
        nw = Math.max(minSize, initial.width - dx);
        nh = Math.round(nw / origAspect);
        nx = initial.x + (initial.width - nw);
      } else if (handle === "ne") {
        nw = Math.max(minSize, initial.width + dx);
        nh = Math.round(nw / origAspect);
        ny = initial.y + (initial.height - nh);
      } else if (handle === "nw") {
        nw = Math.max(minSize, initial.width - dx);
        nh = Math.round(nw / origAspect);
        nx = initial.x + (initial.width - nw);
        ny = initial.y + (initial.height - nh);
      }
      return { ...initial, x: nx, y: ny, width: nw, height: nh };
    }

    // Freeform handles
    if (handle.includes("e")) nw = Math.max(minSize, initial.width + dx);
    if (handle.includes("s")) nh = Math.max(minSize, initial.height + dy);
    if (handle.includes("w")) {
      nw = Math.max(minSize, initial.width - dx);
      nx = initial.x + (initial.width - nw);
    }
    if (handle.includes("n")) {
      nh = Math.max(minSize, initial.height - dy);
      ny = initial.y + (initial.height - nh);
    }

    return { ...initial, x: nx, y: ny, width: nw, height: nh };
  } else if (initial.type === "text") {
    let nx = initial.x;
    let ny = initial.y;
    let nw = initial.width || 200;
    let nh = initial.height || 60;
    const minSize = 40;

    if (handle.includes("e")) nw = Math.max(minSize, (initial.width || 200) + dx);
    if (handle.includes("s")) nh = Math.max(minSize, (initial.height || 60) + dy);
    if (handle.includes("w")) {
      nw = Math.max(minSize, (initial.width || 200) - dx);
      nx = initial.x + ((initial.width || 200) - nw);
    }
    if (handle.includes("n")) {
      nh = Math.max(minSize, (initial.height || 60) - dy);
      ny = initial.y + ((initial.height || 60) - nh);
    }
    return { ...initial, x: nx, y: ny, width: nw, height: nh };
  }

  return initial;
}

function isObjectInsideBounds(obj: AnnotationObject, w: number, h: number): boolean {
  const b = getObjectBoundingBox(obj);
  return b.maxX >= 0 && b.minX <= w && b.maxY >= 0 && b.minY <= h;
}
