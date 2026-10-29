import { useEffect, useRef, useState } from "react";
import { guideLines, lensFrame, type Rect } from "../logic/frameGuides.ts";
import type { DepthImage } from "../logic/depthPreview.ts";

/** The depth guide as a canvas, scaled to its box. */
export function DepthCanvas({ image, className, style }: { image: DepthImage; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d")?.putImageData(new ImageData(image.rgba as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  }, [image]);
  return <canvas ref={ref} className={className} style={style} />;
}

interface Props {
  aspect: number;
  resolution: { width: number; height: number };
  frame: number;
  focalMm: number;
  guides: boolean;
  depth: boolean;
  image: DepthImage | null;
}

/** Drawn over the viewport in lens mode: the frame mask, optional composition guides, and the depth guide inside the frame. */
export function LensOverlay({ aspect, resolution, frame, focalMm, guides, depth, image }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const f: Rect = lensFrame(size.w, size.h, aspect);
  return (
    <div ref={root} className="lens-overlay" aria-hidden={size.w === 0}>
      {size.w > 0 && (
        <>
          {depth && image && <DepthCanvas image={image} className="lens-depth" style={{ left: f.x, top: f.y, width: f.w, height: f.h }} />}
          <div className="lens-frame" style={{ left: f.x, top: f.y, width: f.w, height: f.h }} />
          {guides && (
            <svg className="lens-guides" width={size.w} height={size.h}>
              {guideLines(f).map((l, i) => <line key={i} {...l} className={l.kind} />)}
            </svg>
          )}
          <span className="lens-label mono" style={{ left: f.x, top: Math.min(size.h - 18, f.y + f.h + 4) }}>
            shot frame {resolution.width}x{resolution.height} · {focalMm.toFixed(0)} mm · frame {frame}{depth ? " · depth guide" : ""}
          </span>
        </>
      )}
    </div>
  );
}
