export interface FilmstripLayout {
  tw: number;
  th: number;
  rows: number;
  cols: number;
  cell(i: number): [number, number];
}

export function filmstripLayout(frames: number, columns: number, width: number, height: number, thumbWidth: number): FilmstripLayout {
  const cols = Math.min(columns, frames);
  const tw = thumbWidth;
  const th = Math.round((thumbWidth * height) / width);
  const rows = Math.ceil(frames / cols);
  return { tw, th, rows, cols, cell: (i) => [(i % cols) * tw, Math.floor(i / cols) * th] };
}

export interface FilmstripOptions {
  frames: number;
  stepsBetween: number;
  columns: number;
  thumbWidth: number;
}

/**
 * Advance the simulation deterministically and grab a frame after each advance.
 * Each frame is copied right after render() in the same task, so no preserveDrawingBuffer is needed.
 */
export function captureFilmstrip(
  opts: FilmstripOptions,
  advance: (steps: number) => void,
  render: () => void,
  source: HTMLCanvasElement,
): HTMLCanvasElement {
  const l = filmstripLayout(opts.frames, opts.columns, source.width, source.height, opts.thumbWidth);
  const out = document.createElement('canvas');
  out.width = l.tw * l.cols;
  out.height = l.th * l.rows;
  const ctx = out.getContext('2d')!;
  ctx.font = '12px sans-serif';
  for (let i = 0; i < opts.frames; i++) {
    if (i > 0) advance(opts.stepsBetween);
    render();
    const [x, y] = l.cell(i);
    ctx.drawImage(source, x, y, l.tw, l.th);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, 26, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i), x + 4, y + 12);
  }
  return out;
}

export function showOverlay(canvas: HTMLCanvasElement): void {
  const overlay = document.getElementById('overlay')!;
  (overlay.querySelector('img') as HTMLImageElement).src = canvas.toDataURL('image/png');
  overlay.classList.add('show');
  overlay.onclick = hideOverlay;
}

export function hideOverlay(): void {
  document.getElementById('overlay')?.classList.remove('show');
}
