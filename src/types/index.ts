export interface CaptureRecord {
  id: string;
  captureType: string;
  originalPath: string;
  thumbnailPath: string;
  projectPath?: string | null;
  width: number;
  height: number;
  monitorId?: string | null;
  isPinned: boolean;
  isClosed: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number | null;
}

export type ToolType =
  | "select"
  | "arrow"
  | "rect"
  | "ellipse"
  | "line"
  | "pen"
  | "text"
  | "highlight"
  | "blur"
  | "pixelate"
  | "step"
  | "crop";

export interface ArrowObject {
  id: string;
  type: "arrow";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  strokeWidth: number;
}

export interface RectObject {
  id: string;
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  fillColor?: string;
  borderRadius?: number;
}

export interface EllipseObject {
  id: string;
  type: "ellipse";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  color: string;
  strokeWidth: number;
  fillColor?: string;
}

export interface LineObject {
  id: string;
  type: "line";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  strokeWidth: number;
}

export interface PenObject {
  id: string;
  type: "pen";
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
}

export interface TextObject {
  id: string;
  type: "text";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  fontSize: number;
  color: string;
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface ImageOverlayObject {
  id: string;
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
}

export interface HighlightObject {
  id: string;
  type: "highlight";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
}

export interface BlurObject {
  id: string;
  type: "blur";
  x: number;
  y: number;
  width: number;
  height: number;
  blurRadius: number;
}

export interface StepBadgeObject {
  id: string;
  type: "stepBadge";
  x: number;
  y: number;
  number: number;
  color: string;
  textColor: string;
  radius: number;
}

export type AnnotationObject =
  | ArrowObject
  | RectObject
  | EllipseObject
  | LineObject
  | PenObject
  | TextObject
  | ImageOverlayObject
  | HighlightObject
  | BlurObject
  | StepBadgeObject;

export interface AnnotationProject {
  version: number;
  captureId: string;
  canvasWidth: number;
  canvasHeight: number;
  objects: AnnotationObject[];
}

export interface AppSettings {
  hotkeyCapture: string;
  hotkeyRecord: string;
  autoStartWithWindows: boolean;
  copyToClipboardOnCapture: boolean;
  openEditorOnCapture: boolean;
  saveDirectory: string;
}
