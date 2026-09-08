import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { TextRun } from "../../types";

export interface RichTextInputHandle {
  format: (style: Partial<Omit<TextRun, "text">>) => void;
}

interface Props {
  initialRuns: TextRun[];
  style: CSSProperties;
  onChange: (runs: TextRun[], height: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

// The DOM owns the editing selection; React owns the serialized text runs.
export const RichTextInput = forwardRef<RichTextInputHandle, Props>(function RichTextInput(
  { initialRuns, style, onChange, onKeyDown }, ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const initial = useRef(initialRuns);

  const read = () => {
    const editor = root.current;
    if (!editor) return;
    const runs: TextRun[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        const css = getComputedStyle(node.parentElement!);
        runs.push({ text: node.textContent, fontSize: parseFloat(css.fontSize), color: css.color,
          bold: Number(css.fontWeight) >= 700, italic: css.fontStyle === "italic",
          underline: css.textDecorationLine.includes("underline") || !!node.parentElement?.closest("u") });
      } else if (node instanceof HTMLElement) {
        if (node.tagName === "BR") {
          runs.push({ ...initial.current[0], text: "\n" });
        } else {
          if ((node.tagName === "DIV" || node.tagName === "P") && runs.length && !runs[runs.length - 1].text.endsWith("\n")) {
            runs.push({ ...initial.current[0], text: "\n" });
          }
          node.childNodes.forEach(walk);
        }
      }
    };
    editor.childNodes.forEach(walk);
    onChange(runs, editor.scrollHeight);
  };

  useLayoutEffect(() => {
    const editor = root.current!;
    for (const run of initial.current) {
      const span = document.createElement("span");
      span.textContent = run.text;
      Object.assign(span.style, { fontSize: `${run.fontSize}px`, color: run.color,
        fontWeight: run.bold ? "700" : "400", fontStyle: run.italic ? "italic" : "normal",
        textDecoration: run.underline ? "underline" : "none" });
      editor.append(span);
    }
    editor.focus();
    const remember = () => {
      const selection = window.getSelection();
      if (selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
        savedRange.current = selection.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);

  useImperativeHandle(ref, () => ({
    format(patch) {
      const editor = root.current!;
      editor.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = savedRange.current?.cloneRange() || document.createRange();
      // With no text selection, format the box. With a selection, touch only that range.
      if (!savedRange.current || range.collapsed) range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("styleWithCSS", false, "true");
      if (patch.color !== undefined) document.execCommand("foreColor", false, patch.color);
      if (patch.fontSize !== undefined) {
        document.execCommand("fontSize", false, "7");
        editor.querySelectorAll('font[size="7"]').forEach(el => {
          (el as HTMLElement).style.fontSize = `${patch.fontSize}px`;
          el.removeAttribute("size");
        });
        editor.querySelectorAll<HTMLElement>('[style*="xxx-large"]').forEach(el => { el.style.fontSize = `${patch.fontSize}px`; });
      }
      for (const name of ["bold", "italic", "underline"] as const) {
        if (patch[name] !== undefined) document.execCommand(name);
      }
      if (selection.rangeCount) savedRange.current = selection.getRangeAt(0).cloneRange();
      read();
    },
  }));

  return <div ref={root} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
    onInput={read} onKeyDown={onKeyDown}
    onPaste={event => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); read(); }}
    style={{ ...style, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "normal", resize: "none", overflow: "hidden" }}
    className="caret-sky-400" />;
});
