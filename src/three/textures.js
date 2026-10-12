// Paper and screen artwork, drawn at runtime from the CSS palette so the 3D
// never downloads an image and never uses a color that isn't in the brand.

export const ATLAS_SIZE = 1024;
// x, y, w, h in atlas pixels. Order matches the paper type index.
export const ATLAS_RECTS = [
  [0, 0, 400, 520],    // 0 invoice
  [410, 0, 400, 520],  // 1 form
  [0, 530, 400, 400],  // 2 sticky note
  [820, 0, 200, 476],  // 3 receipt
];
export const PAPER_ASPECT = ATLAS_RECTS.map(([, , w, h]) => w / h);

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}

const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

function bar(ctx, color, x, y, w, h, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawPaperAtlas(ctx, P) {
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  // Invoice
  {
    const [x, y, w, h] = ATLAS_RECTS[0];
    ctx.fillStyle = P.paper;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = P.accent;
    rr(ctx, x + 28, y + 30, 46, 46, 8);
    ctx.fill();
    bar(ctx, P.ink, x + 88, y + 36, 130, 14);
    bar(ctx, P.inkFaint, x + 88, y + 60, 90, 9);
    bar(ctx, P.inkSoft, x + 290, y + 36, 82, 14);
    ctx.fillStyle = P.paper2;
    ctx.fillRect(x + 28, y + 118, w - 56, 30);
    for (let i = 0; i < 7; i++) {
      const ry = y + 172 + i * 34;
      bar(ctx, P.ink, x + 36, ry, 150 - (i % 3) * 30, 8, 0.55);
      bar(ctx, P.ink, x + 300, ry, 64, 8, 0.55);
      ctx.fillStyle = P.ink;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(x + 28, ry + 20, w - 56, 2);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = P.accentDeep;
    rr(ctx, x + 228, y + 426, w - 256, 48, 6);
    ctx.fill();
    bar(ctx, P.paper, x + 246, y + 444, 70, 12);
  }

  // Form
  {
    const [x, y, w, h] = ATLAS_RECTS[1];
    ctx.fillStyle = P.paper;
    ctx.fillRect(x, y, w, h);
    bar(ctx, P.ink, x + 30, y + 34, 170, 16);
    bar(ctx, P.inkFaint, x + 30, y + 62, 230, 9);
    for (let i = 0; i < 4; i++) {
      const ry = y + 104 + i * 66;
      bar(ctx, P.inkSoft, x + 30, ry, 90 + (i % 2) * 40, 8);
      ctx.strokeStyle = P.inkFaint;
      ctx.lineWidth = 3;
      rr(ctx, x + 30, ry + 18, w - 60, 30, 5);
      ctx.stroke();
    }
    for (let i = 0; i < 3; i++) {
      const ry = y + 380 + i * 40;
      ctx.strokeStyle = P.inkSoft;
      ctx.lineWidth = 3;
      rr(ctx, x + 30, ry, 24, 24, 4);
      ctx.stroke();
      if (i !== 1) {
        ctx.strokeStyle = P.accentDeep;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x + 35, ry + 12);
        ctx.lineTo(x + 41, ry + 18);
        ctx.lineTo(x + 51, ry + 6);
        ctx.stroke();
      }
      bar(ctx, P.ink, x + 68, ry + 8, 150 + i * 24, 8, 0.5);
    }
  }

  // Sticky note
  {
    const [x, y, w, h] = ATLAS_RECTS[2];
    ctx.fillStyle = P.paper2;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = P.paper3;
    ctx.fillRect(x, y, w, 48);
    ctx.strokeStyle = P.accentDeep;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (let line = 0; line < 4; line++) {
      const ly = y + 110 + line * 62;
      const len = w - 90 - (line % 2) * 70;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const px = x + 40 + (len * i) / 40;
        const py = ly + Math.sin(i * 1.1 + line) * 7 + Math.sin(i * 0.37) * 4;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // Receipt (zigzag top and bottom edges are cut out with transparency)
  {
    const [x, y, w, h] = ATLAS_RECTS[3];
    const z = 12;
    ctx.fillStyle = P.paper;
    ctx.beginPath();
    ctx.moveTo(x, y + z);
    for (let i = 0; i <= w / z; i++) ctx.lineTo(x + i * z, y + (i % 2 ? 0 : z));
    ctx.lineTo(x + w, y + h - z);
    for (let i = w / z; i >= 0; i--) ctx.lineTo(x + i * z, y + h - (i % 2 ? 0 : z));
    ctx.closePath();
    ctx.fill();
    bar(ctx, P.ink, x + 50, y + 40, 100, 12);
    bar(ctx, P.inkFaint, x + 66, y + 62, 68, 8);
    for (let i = 0; i < 8; i++) {
      const ry = y + 104 + i * 30;
      bar(ctx, P.ink, x + 24, ry, 80 - (i % 3) * 14, 7, 0.5);
      bar(ctx, P.ink, x + 140, ry, 36, 7, 0.5);
    }
    ctx.strokeStyle = P.inkFaint;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(x + 20, y + 360);
    ctx.lineTo(x + w - 20, y + 360);
    ctx.stroke();
    ctx.setLineDash([]);
    bar(ctx, P.ink, x + 24, y + 384, 70, 12);
    bar(ctx, P.accentDeep, x + 126, y + 384, 50, 12);
  }
}

export const SCREEN_W = 1024;
export const SCREEN_H = 640;

// A tidy website with a small dashboard beside it: the "after" picture.
export function drawScreen(ctx, P) {
  const W = SCREEN_W, H = SCREEN_H;
  ctx.fillStyle = P.paper2;
  ctx.fillRect(0, 0, W, H);

  // Website window
  const sx = 34, sy = 34, sw = 600, sh = H - 68;
  ctx.fillStyle = P.paper;
  rr(ctx, sx, sy, sw, sh, 12);
  ctx.fill();
  ctx.fillStyle = P.paper3;
  ctx.fillRect(sx, sy + 46, sw, 2);
  ctx.fillStyle = P.accent;
  ctx.beginPath();
  ctx.arc(sx + 30, sy + 23, 9, 0, Math.PI * 2);
  ctx.fill();
  bar(ctx, P.ink, sx + 48, sy + 18, 70, 10);
  for (let i = 0; i < 3; i++) bar(ctx, P.inkFaint, sx + sw - 200 + i * 56, sy + 19, 40, 8);
  bar(ctx, P.ink, sx + 36, sy + 90, 290, 24);
  bar(ctx, P.ink, sx + 36, sy + 124, 210, 24);
  bar(ctx, P.inkFaint, sx + 36, sy + 168, 250, 10);
  bar(ctx, P.inkFaint, sx + 36, sy + 186, 220, 10);
  ctx.fillStyle = P.accentDeep;
  rr(ctx, sx + 36, sy + 220, 120, 36, 6);
  ctx.fill();
  ctx.fillStyle = P.paper3;
  rr(ctx, sx + 360, sy + 84, 204, 172, 8);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    const cx = sx + 36 + i * 182;
    ctx.fillStyle = P.paper2;
    rr(ctx, cx, sy + 290, 164, 230, 8);
    ctx.fill();
    ctx.fillStyle = P.paper3;
    rr(ctx, cx + 16, sy + 306, 132, 90, 6);
    ctx.fill();
    bar(ctx, P.ink, cx + 16, sy + 414, 100, 10);
    bar(ctx, P.inkSoft, cx + 16, sy + 434, 120, 8);
    bar(ctx, P.inkSoft, cx + 16, sy + 450, 90, 8);
  }

  // Dashboard panel
  const dx = 660, dy = 34, dw = W - 694, dh = H - 68;
  ctx.fillStyle = P.paper;
  rr(ctx, dx, dy, dw, dh, 12);
  ctx.fill();
  bar(ctx, P.ink, dx + 24, dy + 26, 120, 12);
  for (let i = 0; i < 2; i++) {
    const tx = dx + 24 + i * 152;
    ctx.fillStyle = P.paper2;
    rr(ctx, tx, dy + 58, 136, 84, 8);
    ctx.fill();
    bar(ctx, P.ink, tx + 16, dy + 78, 62, 18);
    bar(ctx, P.inkSoft, tx + 16, dy + 110, 92, 8);
  }
  const base = dy + 330;
  const heights = [70, 110, 92, 150, 128, 176];
  heights.forEach((bh, i) => {
    ctx.fillStyle = i === heights.length - 1 ? P.accentDeep : P.accent;
    rr(ctx, dx + 28 + i * 46, base - bh, 30, bh, 4);
    ctx.fill();
  });
  ctx.fillStyle = P.paper3;
  ctx.fillRect(dx + 24, base + 6, dw - 48, 2);
  for (let i = 0; i < 4; i++) {
    const ry = base + 34 + i * 44;
    ctx.fillStyle = i < 3 ? P.accentDeep : P.paper3;
    ctx.beginPath();
    ctx.arc(dx + 34, ry + 6, 7, 0, Math.PI * 2);
    ctx.fill();
    bar(ctx, P.ink, dx + 52, ry, 120 + (i % 2) * 40, 10, 0.7);
    bar(ctx, P.inkFaint, dx + dw - 90, ry, 60, 10);
  }
}
