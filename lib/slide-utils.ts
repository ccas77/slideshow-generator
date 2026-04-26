// TikTok resolution: 1080x1920 (9:16)
export const SLIDE_W = 1080;
export const SLIDE_H = 1920;

export function renderSlideToCanvas(
  imageSrc: string | null,
  text: string,
  textStyle?: number
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = SLIDE_W;
    canvas.height = SLIDE_H;
    const ctx = canvas.getContext("2d")!;

    function drawTextAndResolve() {
      const grad = ctx.createLinearGradient(0, SLIDE_H, 0, 0);
      grad.addColorStop(0, "rgba(0,0,0,0.85)");
      grad.addColorStop(0.5, "rgba(0,0,0,0.2)");
      grad.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const fontSize = 72;
      ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
      const maxWidth = SLIDE_W - 160;
      const words = text.split(" ");
      const lines: string[] = [];
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);

      const lineHeight = fontSize * 1.35;
      const totalHeight = lines.length * lineHeight;
      const startY = (SLIDE_H - totalHeight) / 2 + lineHeight / 2;

      // Pick text style (use provided or random)
      const resolvedStyle = textStyle ?? Math.floor(Math.random() * 3);
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;

      if (resolvedStyle === 0) {
        // Style 1: White text with black outline
        ctx.strokeStyle = "black";
        ctx.lineWidth = Math.round(fontSize * 0.18);
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 12;
        for (let i = 0; i < lines.length; i++) {
          ctx.strokeText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = "white";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
      } else if (resolvedStyle === 1) {
        // Style 2: White text with 50% opacity background shadow
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = "white";
        // Double-draw for stronger shadow
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else {
        // Style 3: Black text with solid white shadow
        ctx.shadowColor = "white";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = "black";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }

      resolve(canvas);
    }

    if (imageSrc) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const scale = Math.max(SLIDE_W / img.width, SLIDE_H / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SLIDE_W - w) / 2, (SLIDE_H - h) / 2, w, h);
        drawTextAndResolve();
      };
      img.onerror = () => {
        ctx.fillStyle = "#18181b";
        ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
        drawTextAndResolve();
      };
      img.src = imageSrc;
    } else {
      ctx.fillStyle = "#18181b";
      ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
      drawTextAndResolve();
    }
  });
}

// Convert UTC "HH:MM" to local "HH:MM" for display
export function utcToLocal(utc: string): string {
  const [h, m] = utc.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

// Convert local "HH:MM" to UTC "HH:MM"
export function localToUtc(local: string): string {
  const [h, m] = local.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes()
  ).padStart(2, "0")}`;
}
