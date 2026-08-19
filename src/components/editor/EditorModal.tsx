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
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  AnnotationObject,
  AnnotationProject,
  CaptureRecord,
  PenObject,
  TextObject,
  ToolType,
} from "../../types";

interface EditorModalProps {
  record: CaptureRecord;
  onClose: () => void;
  onUpdateRecord: (record: CaptureRecord) => void;
}

const COLORS = [
  "#EF4444", // Red
  "#F97316", // Orange
  "#EAB308", // Yellow
  "#22C55E", // Green
  "#06B6D4", // Cyan
  "#3B82F6", // Blue
  "#A855F7", // Purple
  "#EC4899", // Pink
  "#FFFFFF", // White
  "#000000", // Black
];

const STROKE_WIDTHS = [2, 4, 6, 8, 12];

export const EditorModal: React.FC<EditorModalProps> = ({
  record,
  onClose,
  onUpdateRecord,
}) => {
  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [currentColor, setCurrentColor] = useState<string>("#EF4444");
  const [currentStrokeWidth, setCurrentStrokeWidth] = useState<number>(4);
  const [fillShape, setFillShape] = useState<boolean>(false);
  const [stepCounter, setStepCounter] = useState<number>(1);

  // Zoom & Viewport state
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<AnnotationObject[][]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Inline Text Editor State
  const [inlineText, setInlineText] = useState<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
    fontSize: number;
    hasBg: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    text: "",
    fontSize: 24,
    hasBg: true,
  });

  // Crop mode state
  const [isCropMode, setIsCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exported, setExported] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDrawingRef = useRef(false);
  const isDraggingObjectRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragInitialObjRef = useRef<AnnotationObject | null>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentTempObjectRef = useRef<AnnotationObject | null>(null);

  // 1. Load Background Image & Project Annotations
  useEffect(() => {
    let isMounted = true;

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
          }
        };

        if (record.projectPath) {
          const jsonStr = await invoke<string>("load_annotation_project", {
            projectPath: record.projectPath,
          });
          const project: AnnotationProject = JSON.parse(jsonStr);
          if (isMounted && project.objects) {
            setObjects(project.objects);
            setHistory([project.objects]);
            setHistoryIndex(0);

            const maxStep = project.objects
              .filter((o): o is import("../../types").StepBadgeObject => o.type === "stepBadge")
              .reduce((max, obj) => Math.max(max, obj.number), 0);
            setStepCounter(maxStep + 1);
          }
        } else {
          setHistory([[]]);
          setHistoryIndex(0);
        }
      } catch (err) {
        console.error("Failed to load editor data:", err);
      }
    };

    loadData();
    return () => {
      isMounted = false;
    };
  }, [record.id, record.originalPath, record.projectPath]);

  const pushState = useCallback((newObjects: AnnotationObject[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newObjects);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setObjects(newObjects);
  }, [history, historyIndex]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      setObjects(history[nextIdx]);
      setSelectedId(null);
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      setObjects(history[nextIdx]);
      setSelectedId(null);
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

  // Zoom helpers
  const handleZoomIn = () => setZoomLevel((z) => Math.min(4.0, Number((z + 0.25).toFixed(2))));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))));
  const handleZoomReset = () => setZoomLevel(1.0);

  // Wheel listener for Zooming
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    }
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (inlineText.visible) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          handleDeleteSelected();
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === "z") {
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        handleRedo();
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
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, isCropMode, inlineText.visible, handleDeleteSelected, handleUndo, handleRedo]);

  // 2. Render Canvas Frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bgImage) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== bgImage.naturalWidth || canvas.height !== bgImage.naturalHeight) {
      canvas.width = bgImage.naturalWidth;
      canvas.height = bgImage.naturalHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background screenshot
    ctx.drawImage(bgImage, 0, 0);

    // Draw all objects
    const allObjects = [...objects];
    if (currentTempObjectRef.current) {
      allObjects.push(currentTempObjectRef.current);
    }

    for (const obj of allObjects) {
      drawAnnotationObject(ctx, obj, bgImage);
    }

    // Draw Selection Bounding Box & Handles
    if (selectedId && !isCropMode) {
      const selObj = objects.find((o) => o.id === selectedId);
      if (selObj) {
        drawSelectionBox(ctx, selObj);
      }
    }

    // Draw Crop Overlay
    if (isCropMode && cropRect && cropRect.w > 0 && cropRect.h > 0) {
      drawCropOverlay(ctx, cropRect, canvas.width, canvas.height);
    }
  }, [bgImage, objects, selectedId, isCropMode, cropRect]);

  // Canvas Native Coordinate Mapping (accounts for dynamic zoom)
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

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    startPosRef.current = { x, y };

    if (isCropMode) {
      isDrawingRef.current = true;
      setCropRect({ x, y, w: 0, h: 0 });
      return;
    }

    if (activeTool === "select") {
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
      setInlineText({
        visible: true,
        x,
        y,
        text: "",
        fontSize: Math.max(20, currentStrokeWidth * 5),
        hasBg: true,
      });
      return;
    }

    // Creating new annotation object
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
        textColor: "#FFFFFF",
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

    if (isCropMode && isDrawingRef.current) {
      const start = startPosRef.current;
      setCropRect({
        x: Math.min(start.x, x),
        y: Math.min(start.y, y),
        w: Math.abs(x - start.x),
        h: Math.abs(y - start.y),
      });
      return;
    }

    if (isDraggingObjectRef.current && selectedId && dragInitialObjRef.current) {
      const dx = x - dragStartPosRef.current.x;
      const dy = y - dragStartPosRef.current.y;
      const initial = dragInitialObjRef.current;

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
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bgImage, 0, 0);
        for (const obj of [...objects, temp]) {
          drawAnnotationObject(ctx, obj, bgImage);
        }
      }
    }
  };

  const handleMouseUp = () => {
    if (isCropMode) {
      isDrawingRef.current = false;
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

  // Commit inline text creation
  const handleCommitInlineText = () => {
    if (!inlineText.text.trim()) {
      setInlineText((prev) => ({ ...prev, visible: false }));
      return;
    }

    const newId = `obj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const textObj: TextObject = {
      id: newId,
      type: "text",
      x: inlineText.x,
      y: inlineText.y,
      text: inlineText.text,
      fontSize: inlineText.fontSize,
      color: currentColor,
      bgColor: inlineText.hasBg ? "rgba(15, 23, 42, 0.85)" : undefined,
    };

    pushState([...objects, textObj]);
    setSelectedId(newId);
    setInlineText((prev) => ({ ...prev, visible: false, text: "" }));
    setActiveTool("select");
  };

  // Apply Crop Action
  const handleApplyCrop = () => {
    if (!cropRect || cropRect.w < 20 || cropRect.h < 20 || !bgImage) return;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropRect.w;
    cropCanvas.height = cropRect.h;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;

    cropCtx.drawImage(
      bgImage,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0,
      0,
      cropRect.w,
      cropRect.h
    );

    const croppedImg = new Image();
    croppedImg.src = cropCanvas.toDataURL("image/png");
    croppedImg.onload = () => {
      setBgImage(croppedImg);

      const shiftedObjects = objects
        .map((obj) => moveObjectFromOrigin(obj, -cropRect.x, -cropRect.y))
        .filter((obj) => isObjectInsideBounds(obj, cropRect.w, cropRect.h));

      pushState(shiftedObjects);
      setIsCropMode(false);
      setCropRect(null);
    };
  };

  // Update selected object style (Color & Stroke)
  const handleUpdateSelectedColor = (newColor: string) => {
    setCurrentColor(newColor);
    if (selectedId) {
      const updated = objects.map((obj) => {
        if (obj.id !== selectedId) return obj;
        if ("color" in obj) {
          return { ...obj, color: newColor };
        }
        return obj;
      });
      pushState(updated);
    }
  };

  const handleUpdateSelectedStroke = (newWidth: number) => {
    setCurrentStrokeWidth(newWidth);
    if (selectedId) {
      const updated = objects.map((obj) => {
        if (obj.id !== selectedId) return obj;
        if ("strokeWidth" in obj) {
          return { ...obj, strokeWidth: newWidth };
        }
        return obj;
      });
      pushState(updated);
    }
  };

  // Export merged image & Copy to clipboard
  const handleCopyMerged = async () => {
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
  };

  // Save As file dialog
  const handleExportImageAs = async () => {
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
  };

  // Save Project JSON
  const handleSaveProject = async () => {
    if (!bgImage) return;

    const project: AnnotationProject = {
      version: 1,
      captureId: record.id,
      canvasWidth: bgImage.naturalWidth,
      canvasHeight: bgImage.naturalHeight,
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
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col select-none animate-in fade-in duration-150">
      {/* Top Toolbar */}
      <div className="h-14 border-b border-zinc-800/80 bg-zinc-900/95 px-4 flex items-center justify-between gap-2 shadow-lg backdrop-blur-md">
        {/* Tools Group */}
        <div className="flex items-center gap-1 overflow-x-auto py-1">
          <ToolButton
            active={activeTool === "select" && !isCropMode}
            onClick={() => {
              setActiveTool("select");
              setIsCropMode(false);
            }}
            icon={<MousePointer className="w-4 h-4" />}
            label="Select & Move (V)"
          />
          <ToolButton
            active={activeTool === "pen" && !isCropMode}
            onClick={() => {
              setActiveTool("pen");
              setIsCropMode(false);
            }}
            icon={<Pencil className="w-4 h-4" />}
            label="Freehand Pen / Doodle"
          />
          <ToolButton
            active={activeTool === "arrow" && !isCropMode}
            onClick={() => {
              setActiveTool("arrow");
              setIsCropMode(false);
            }}
            icon={<ArrowRight className="w-4 h-4 -rotate-45" />}
            label="Arrow (A)"
          />
          <ToolButton
            active={activeTool === "rect" && !isCropMode}
            onClick={() => {
              setActiveTool("rect");
              setIsCropMode(false);
            }}
            icon={<Square className="w-4 h-4" />}
            label="Rectangle (R)"
          />
          <ToolButton
            active={activeTool === "ellipse" && !isCropMode}
            onClick={() => {
              setActiveTool("ellipse");
              setIsCropMode(false);
            }}
            icon={<Circle className="w-4 h-4" />}
            label="Ellipse (O)"
          />
          <ToolButton
            active={activeTool === "line" && !isCropMode}
            onClick={() => {
              setActiveTool("line");
              setIsCropMode(false);
            }}
            icon={<Minus className="w-4 h-4" />}
            label="Line (L)"
          />
          <ToolButton
            active={activeTool === "text" && !isCropMode}
            onClick={() => {
              setActiveTool("text");
              setIsCropMode(false);
            }}
            icon={<Type className="w-4 h-4" />}
            label="Text (T)"
          />
          <ToolButton
            active={activeTool === "highlight" && !isCropMode}
            onClick={() => {
              setActiveTool("highlight");
              setIsCropMode(false);
            }}
            icon={<Highlighter className="w-4 h-4" />}
            label="Highlighter"
          />
          <ToolButton
            active={activeTool === "blur" && !isCropMode}
            onClick={() => {
              setActiveTool("blur");
              setIsCropMode(false);
            }}
            icon={<EyeOff className="w-4 h-4" />}
            label="Blur / Obfuscate"
          />
          <ToolButton
            active={activeTool === "step" && !isCropMode}
            onClick={() => {
              setActiveTool("step");
              setIsCropMode(false);
            }}
            icon={<ListOrdered className="w-4 h-4" />}
            label="Step Number Badge (①②③)"
          />
          <ToolButton
            active={isCropMode}
            onClick={() => {
              setIsCropMode(!isCropMode);
              setSelectedId(null);
            }}
            icon={<Crop className="w-4 h-4 text-emerald-400" />}
            label="Crop Image"
          />

          <div className="h-5 w-px bg-zinc-800 mx-1" />

          {/* Delete Selected Item */}
          {selectedId && (
            <button
              onClick={handleDeleteSelected}
              className="p-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white transition-all shadow-md flex items-center gap-1 text-xs font-semibold"
              title="Delete Selected Annotation (Del / Backspace)"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          )}

          {/* Clear All Annotations */}
          <button
            onClick={handleClearAll}
            disabled={objects.length === 0}
            className="p-2 rounded-lg text-zinc-400 hover:text-red-400 disabled:opacity-20 hover:bg-zinc-800 transition-colors"
            title="Clear All Annotations"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Undo / Redo */}
          <button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 disabled:opacity-20 hover:bg-zinc-800 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 disabled:opacity-20 hover:bg-zinc-800 transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        {/* Style Options (Color & Stroke & Fill) */}
        <div className="flex items-center gap-2">
          {/* Color Palette */}
          <div className="flex items-center gap-1 bg-zinc-950/70 p-1 rounded-lg border border-zinc-800">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => handleUpdateSelectedColor(c)}
                className={`w-4 h-4 rounded-full transition-transform ${
                  currentColor === c
                    ? "scale-125 ring-2 ring-sky-400 ring-offset-1 ring-offset-zinc-900"
                    : "hover:scale-110 opacity-80 hover:opacity-100"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>

          {/* Stroke Width */}
          <div className="flex items-center gap-1 bg-zinc-950/70 p-1 rounded-lg border border-zinc-800">
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => handleUpdateSelectedStroke(w)}
                className={`px-1.5 py-0.5 text-[11px] font-mono rounded ${
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
            className={`px-2 py-1 text-[11px] font-medium rounded-lg border transition-all ${
              fillShape
                ? "bg-sky-600/30 text-sky-300 border-sky-500/50 font-bold"
                : "bg-zinc-950/60 text-zinc-400 border-zinc-800 hover:text-zinc-200"
            }`}
            title="Toggle Semi-transparent Fill for Shapes"
          >
            {fillShape ? "Filled" : "Outline"}
          </button>

          <div className="h-5 w-px bg-zinc-800 mx-1" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 bg-zinc-950/70 p-1 rounded-lg border border-zinc-800">
            <button
              onClick={handleZoomOut}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              title="Zoom Out (Ctrl -)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomReset}
              className="px-1.5 py-0.5 text-[11px] font-mono text-zinc-300 hover:text-white font-medium"
              title="Reset Zoom to 100% (Ctrl 0)"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              title="Zoom In (Ctrl +)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right Actions: Copy, Save Image As, Save Project, Close */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyMerged}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-sky-600/20"
            title="Copy final image to clipboard (Ctrl+C)"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copied!" : "Copy Result"}</span>
          </button>

          <button
            onClick={handleExportImageAs}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-emerald-600/20"
            title="Save annotated image as PNG / JPG"
          >
            {exported ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
            <span>{exported ? "Saved!" : "Save Image As..."}</span>
          </button>

          <button
            onClick={handleSaveProject}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold transition-all border border-zinc-700"
            title="Save vector project (can edit later)"
          >
            {saved ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saved ? "Saved" : "Save Project"}</span>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors ml-1"
            title="Close Editor (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport (Scrollable & Zoomable) */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className="flex-1 overflow-auto bg-zinc-950 flex items-center justify-center p-8 relative"
      >
        {/* Floating Crop Actions Banner */}
        {isCropMode && (
          <div className="absolute top-6 z-30 bg-zinc-900/95 border border-zinc-700/80 px-4 py-2 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-2">
            <span className="text-xs text-zinc-300">
              Drag a box on the image to crop.
            </span>
            {cropRect && cropRect.w > 20 && cropRect.h > 20 && (
              <button
                onClick={handleApplyCrop}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply Crop</span>
              </button>
            )}
            <button
              onClick={() => {
                setIsCropMode(false);
                setCropRect(null);
              }}
              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-all"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Inline Floating Text Card Editor */}
        {inlineText.visible && (
          <div className="absolute top-6 z-30 bg-zinc-900/95 border border-sky-500/80 p-3 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[320px] animate-in slide-in-from-top-2">
            <div className="flex items-center justify-between text-xs text-zinc-300">
              <span className="font-semibold flex items-center gap-1 text-sky-400">
                <Type className="w-3.5 h-3.5" />
                Add Styled Text
              </span>
              <button
                onClick={() => setInlineText((prev) => ({ ...prev, hasBg: !prev.hasBg }))}
                className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                  inlineText.hasBg
                    ? "bg-sky-600/30 text-sky-300 border-sky-500/40"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                {inlineText.hasBg ? "Badge BG: ON" : "Badge BG: OFF"}
              </button>
            </div>

            <input
              type="text"
              autoFocus
              value={inlineText.text}
              onChange={(e) => setInlineText((prev) => ({ ...prev, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitInlineText();
                if (e.key === "Escape") setInlineText((prev) => ({ ...prev, visible: false }));
              }}
              placeholder="Type annotation text..."
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500"
            />

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1">
                {[16, 22, 28, 36].map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setInlineText((prev) => ({ ...prev, fontSize: sz }))}
                    className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                      inlineText.fontSize === sz
                        ? "bg-sky-600 text-white font-bold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {sz}px
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setInlineText((prev) => ({ ...prev, visible: false }))}
                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCommitInlineText}
                  className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-md transition-colors shadow-md shadow-sky-600/20"
                >
                  Add Text
                </button>
              </div>
            </div>
          </div>
        )}

        {!bgImage ? (
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-sky-500 animate-spin" />
            <span className="text-xs">Loading capture image...</span>
          </div>
        ) : (
          <div
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
              className={`shadow-2xl border border-zinc-800/80 rounded-lg max-w-none ${
                isCropMode
                  ? "cursor-crosshair"
                  : activeTool === "select"
                  ? "cursor-default"
                  : "cursor-crosshair"
              }`}
            />
          </div>
        )}
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

// Draw Annotation Object onto Canvas
function drawAnnotationObject(
  ctx: CanvasRenderingContext2D,
  obj: AnnotationObject,
  bgImage: HTMLImageElement
) {
  ctx.save();

  if (obj.type === "pen") {
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
    ctx.font = `600 ${obj.fontSize}px 'Segoe UI', system-ui, sans-serif`;

    if (obj.bgColor) {
      const metrics = ctx.measureText(obj.text);
      const textWidth = metrics.width;
      const padX = 10;
      const padY = 6;
      const rx = obj.x - padX;
      const ry = obj.y - obj.fontSize - padY / 2;
      const rw = textWidth + padX * 2;
      const rh = obj.fontSize + padY * 2;
      const radius = 6;

      ctx.fillStyle = obj.bgColor;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, radius);
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
    }

    ctx.fillStyle = obj.color;
    ctx.fillText(obj.text, obj.x, obj.y);
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

// Draw Selection Bounding Box with Corner Handles
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

  ctx.fillStyle = "#38BDF8";
  ctx.setLineDash([]);
  const handleSize = 6;
  const corners = [
    { cx: x, cy: y },
    { cx: x + w, cy: y },
    { cx: x, cy: y + h },
    { cx: x + w, cy: y + h },
  ];
  for (const c of corners) {
    ctx.fillRect(c.cx - handleSize / 2, c.cy - handleSize / 2, handleSize, handleSize);
  }

  ctx.restore();
}

// Draw Crop Overlay
function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  crop: { x: number; y: number; w: number; h: number },
  cw: number,
  ch: number
) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, 0, cw, crop.y);
  ctx.fillRect(0, crop.y + crop.h, cw, ch - (crop.y + crop.h));
  ctx.fillRect(0, crop.y, crop.x, crop.h);
  ctx.fillRect(crop.x + crop.w, crop.y, cw - (crop.x + crop.w), crop.h);

  ctx.strokeStyle = "#10B981";
  ctx.lineWidth = 2;
  ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
  ctx.restore();
}

function getObjectBoundingBox(obj: AnnotationObject): { minX: number; minY: number; maxX: number; maxY: number } {
  if (obj.type === "pen") {
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
  } else if (obj.type === "rect" || obj.type === "highlight" || obj.type === "blur") {
    return {
      minX: obj.x,
      minY: obj.y,
      maxX: obj.x + obj.width,
      maxY: obj.y + obj.height,
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
      minX: obj.x - 10,
      minY: obj.y - obj.fontSize - 6,
      maxX: obj.x + obj.text.length * (obj.fontSize * 0.6) + 10,
      maxY: obj.y + 8,
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
  } else if (initial.type === "rect" || initial.type === "highlight" || initial.type === "blur") {
    return {
      ...initial,
      x: initial.x + dx,
      y: initial.y + dy,
    };
  } else if (initial.type === "ellipse" || initial.type === "stepBadge" || initial.type === "text") {
    return {
      ...initial,
      x: initial.x + dx,
      y: initial.y + dy,
    };
  }
  return initial;
}

function isObjectInsideBounds(obj: AnnotationObject, w: number, h: number): boolean {
  const b = getObjectBoundingBox(obj);
  return b.maxX >= 0 && b.minX <= w && b.maxY >= 0 && b.minY <= h;
}
