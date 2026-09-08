import type { TextObject, TextRun } from "../../types";

export const textFont = (run: TextRun) => `${run.italic ? "italic " : ""}${run.bold ? "700" : "400"} ${run.fontSize}px 'Segoe UI', system-ui, sans-serif`;

export function layoutText(ctx: Pick<CanvasRenderingContext2D, "font" | "measureText">, obj: TextObject) {
  const runs = obj.runs || [{ text: obj.text, fontSize: obj.fontSize || 22, color: obj.color, bold: obj.bold, italic: obj.italic, underline: obj.underline }];
  const maxWidth = Math.max(1, (obj.width || 240) - 20);
  const lines: { runs: (TextRun & { width: number })[]; width: number; height: number }[] = [];
  let line = { runs: [] as (TextRun & { width: number })[], width: 0, height: (obj.fontSize || 22) * 1.35 };
  const nextLine = () => { lines.push(line); line = { runs: [], width: 0, height: (obj.fontSize || 22) * 1.35 }; };
  const append = (text: string, run: TextRun) => {
    ctx.font = textFont(run);
    const width = ctx.measureText(text).width;
    line.runs.push({ ...run, text, width });
    line.width += width;
    line.height = Math.max(line.height, run.fontSize * 1.35);
  };
  for (const run of runs) {
    for (const token of run.text.split(/(\n|[^\S\n]+|[^\s]+)/u).filter(Boolean)) {
      if (token === "\n") { nextLine(); continue; }
      ctx.font = textFont(run);
      const width = ctx.measureText(token).width;
      if (line.width && line.width + width > maxWidth) nextLine();
      if (width <= maxWidth) append(token, run);
      else {
        for (const char of Array.from(token)) {
          ctx.font = textFont(run);
          if (line.width && line.width + ctx.measureText(char).width > maxWidth) nextLine();
          append(char, run);
        }
      }
    }
  }
  lines.push(line);
  return { lines, height: lines.reduce((sum, item) => sum + item.height, 0) + 20 };
}

export function drawTextBox(ctx: CanvasRenderingContext2D, obj: TextObject) {
  const layout = layoutText(ctx, obj);
  const width = obj.width || 240;
  const height = Math.max(obj.height || 0, layout.height);
  if (obj.hasBg !== false && obj.bgColor) {
    ctx.fillStyle = obj.bgColor;
    ctx.beginPath(); ctx.roundRect(obj.x, obj.y, width, height, 8); ctx.fill();
  }
  if (obj.hasBorder !== false && obj.borderColor) {
    ctx.strokeStyle = obj.borderColor; ctx.lineWidth = obj.borderWidth || 2;
    ctx.beginPath(); ctx.roundRect(obj.x, obj.y, width, height, 8); ctx.stroke();
  }
  ctx.beginPath(); ctx.rect(obj.x + 10, obj.y + 10, Math.max(1, width - 20), height - 20); ctx.clip();
  ctx.textBaseline = "top";
  let y = obj.y + 10;
  for (const line of layout.lines) {
    let x = obj.x + 10;
    for (const run of line.runs) {
      ctx.font = textFont(run); ctx.fillStyle = run.color;
      ctx.fillText(run.text, x, y);
      if (run.underline) {
        ctx.strokeStyle = run.color; ctx.lineWidth = Math.max(1.5, run.fontSize / 14);
        ctx.beginPath(); ctx.moveTo(x, y + run.fontSize + 2); ctx.lineTo(x + run.width, y + run.fontSize + 2); ctx.stroke();
      }
      x += run.width;
    }
    y += line.height;
  }
}
