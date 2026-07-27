import { useState, useRef, useEffect, useCallback } from 'react';

const VIEW_W = 500;
const VIEW_H = 500;
const MIN_CROP = 40; // minimum WIDTH in viewport px; height floor is derived from ASPECT

// Headshots are always displayed at a 3:4 (width:height) box everywhere in
// the app — the grid cards (ArtistCard.jsx's `aspect-[3/4]`) and the roster
// PDF (`padding-bottom:133%`, i.e. height = 1.333x width = 4/3). Previously
// this crop tool let you draw ANY freeform rectangle, so unless you happened
// to eyeball the exact same ratio, the browser/PDF would silently re-crop
// your selection again at display time via object-fit:cover — invisibly
// trimming off whatever didn't fit (most often the top of the head, since
// that's where the extra headroom people tend to leave usually lives).
// Locking the tool itself to 3:4 means what you select is exactly what you
// get, everywhere, with no second silent crop.
const ASPECT = 3 / 4; // width / height
const MIN_H = MIN_CROP / ASPECT;

// Which edges each handle affects: [left, top, right, bottom]
const HANDLES = [
  { id: 'nw', cursor: 'nw-resize', edges: [1,1,0,0], x: 'left',   y: 'top'    },
  { id: 'n',  cursor: 'n-resize',  edges: [0,1,0,0], x: 'center', y: 'top'    },
  { id: 'ne', cursor: 'ne-resize', edges: [0,1,1,0], x: 'right',  y: 'top'    },
  { id: 'e',  cursor: 'e-resize',  edges: [0,0,1,0], x: 'right',  y: 'center' },
  { id: 'se', cursor: 'se-resize', edges: [0,0,1,1], x: 'right',  y: 'bottom' },
  { id: 's',  cursor: 's-resize',  edges: [0,0,0,1], x: 'center', y: 'bottom' },
  { id: 'sw', cursor: 'sw-resize', edges: [1,0,0,1], x: 'left',   y: 'bottom' },
  { id: 'w',  cursor: 'w-resize',  edges: [1,0,0,0], x: 'left',   y: 'center' },
];

export default function CropModal({ imageSrc, onConfirm, onClose }) {
  // Image position within viewport (panning)
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  // Crop box in viewport coords — always kept at the locked ASPECT ratio
  const [crop, setCrop] = useState({ x: 60, y: 30, w: 260, h: 260 / ASPECT });
  const [imgSize, setImgSize] = useState({ w: VIEW_W, h: VIEW_H });

  // Refs always hold latest values — used in handleConfirm to avoid stale closure
  const imgPosRef = useRef({ x: 0, y: 0 });
  const cropRef = useRef({ x: 60, y: 30, w: 260, h: 260 / ASPECT });
  const imgSizeRef = useRef({ w: VIEW_W, h: VIEW_H });

  const dragging = useRef(null);
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const displayImgRef = useRef(null);

  const syncImgPos = (v) => { imgPosRef.current = v; setImgPos(v); };
  const syncCrop   = (v) => { cropRef.current   = v; setCrop(v);   };
  const syncImgSize= (v) => { imgSizeRef.current = v; setImgSize(v); };

  const handleImageLoad = (e) => {
    const img = e.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    // Fit the entire image within the viewport so nothing is clipped
    const scale = Math.min(VIEW_W / nw, VIEW_H / nh);
    const sw = Math.round(nw * scale);
    const sh = Math.round(nh * scale);
    const pos = { x: Math.round((VIEW_W - sw) / 2), y: Math.round((VIEW_H - sh) / 2) };

    // Default crop box: as large as possible at the locked ASPECT ratio,
    // centered on the photo, with a small margin so it starts just inside
    // the photo's edges rather than touching them.
    const maxW = sw * 0.92, maxH = sh * 0.92;
    let cw, ch;
    if (maxW / maxH > ASPECT) { ch = maxH; cw = ch * ASPECT; }
    else { cw = maxW; ch = cw / ASPECT; }
    const cropBox = {
      x: Math.round(pos.x + (sw - cw) / 2),
      y: Math.round(pos.y + (sh - ch) / 2),
      w: Math.round(cw),
      h: Math.round(ch),
    };
    syncImgSize({ w: sw, h: sh });
    syncImgPos(pos);
    syncCrop(cropBox);
  };

  const handlePointerDown = (e, type, handle = null) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = viewportRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    dragging.current = {
      type,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startVX: e.clientX - rect.left,
      startVY: e.clientY - rect.top,
      imgPos: { ...imgPos },
      crop: { ...crop },
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // The crop box must never extend beyond the PHOTO itself — only the
  // portion of the 500x500 viewport actually covered by the image (most
  // photos aren't square, so the image is letterboxed and doesn't fill the
  // whole viewport). Every interaction below clamps against these bounds,
  // not the viewport, so the box can never sit partly over empty/gray
  // space.
  const getImageBounds = () => {
    const { x: px, y: py } = imgPosRef.current;
    const { w: iw, h: ih } = imgSizeRef.current;
    return { left: px, top: py, right: px + iw, bottom: py + ih };
  };

  const handlePointerMove = useCallback((e) => {
    const d = dragging.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.type === 'pan') {
      const newPos = { x: d.imgPos.x + dx, y: d.imgPos.y + dy };
      syncImgPos(newPos);
      // Re-clamp the existing crop box so panning can never leave it
      // hanging outside the photo's new position. Size is untouched (it's
      // already at the locked aspect ratio), only position moves.
      const b = { left: newPos.x, top: newPos.y, right: newPos.x + imgSizeRef.current.w, bottom: newPos.y + imgSizeRef.current.h };
      const c = cropRef.current;
      const w = Math.min(c.w, b.right - b.left);
      const h = w / ASPECT;
      const x = Math.max(b.left, Math.min(b.right - w, c.x));
      const y = Math.max(b.top, Math.min(b.bottom - h, c.y));
      if (x !== c.x || y !== c.y || w !== c.w || h !== c.h) syncCrop({ x, y, w, h });
      return;
    }

    if (d.type === 'draw') {
      // Anchor is the fixed point where the drag started; the box grows
      // toward wherever the pointer moves, sized from the horizontal drag
      // distance with height derived from the locked aspect ratio.
      const b = getImageBounds();
      const anchorX = d.startVX, anchorY = d.startVY;
      const dirX = dx >= 0 ? 1 : -1;
      const dirY = dy >= 0 ? 1 : -1;
      const wantedW = Math.max(MIN_CROP, Math.abs(dx));
      const maxW = dirX > 0 ? (b.right - anchorX) : (anchorX - b.left);
      const maxH = dirY > 0 ? (b.bottom - anchorY) : (anchorY - b.top);
      const finalW = Math.min(wantedW, maxW, maxH * ASPECT);
      const finalH = finalW / ASPECT;
      if (finalW > MIN_CROP && finalH > MIN_H) {
        const x = dirX > 0 ? anchorX : anchorX - finalW;
        const y = dirY > 0 ? anchorY : anchorY - finalH;
        syncCrop({ x, y, w: finalW, h: finalH });
      }
      return;
    }

    if (d.type === 'move-crop') {
      const b = getImageBounds();
      const next = {
        ...d.crop,
        x: Math.max(b.left, Math.min(b.right - d.crop.w, d.crop.x + dx)),
        y: Math.max(b.top, Math.min(b.bottom - d.crop.h, d.crop.y + dy)),
      };
      syncCrop(next);
      return;
    }

    if (d.type === 'handle') {
      const [left, top, right, bottom] = d.handle.edges;
      const b = getImageBounds();
      const d0 = d.crop;

      // Drive the resize from whichever axis the handle actually owns, and
      // derive the other dimension from the locked aspect ratio. Edge
      // handles (only one of left/top/right/bottom set) grow/shrink
      // symmetrically about the box's own center on the axis they don't
      // own, matching how most fixed-aspect croppers behave.
      let newW, newH;
      if (left || right) {
        newW = Math.max(MIN_CROP, d0.w + (right ? dx : -dx));
        newH = newW / ASPECT;
      } else {
        newH = Math.max(MIN_H, d0.h + (bottom ? dy : -dy));
        newW = newH * ASPECT;
      }

      const anchorX = left ? d0.x + d0.w : right ? d0.x : d0.x + d0.w / 2;
      const anchorY = top ? d0.y + d0.h : bottom ? d0.y : d0.y + d0.h / 2;

      // Clamp to the photo's actual bounds, preserving both the anchor and
      // the aspect ratio — shrink (never balloon past the anchor) if the
      // requested size doesn't fit.
      const maxW = left ? (anchorX - b.left) : right ? (b.right - anchorX) : 2 * Math.min(anchorX - b.left, b.right - anchorX);
      const maxH = top  ? (anchorY - b.top)  : bottom ? (b.bottom - anchorY) : 2 * Math.min(anchorY - b.top, b.bottom - anchorY);
      const finalW = Math.max(MIN_CROP, Math.min(newW, maxW, maxH * ASPECT));
      const finalH = finalW / ASPECT;

      const x = left ? anchorX - finalW : right ? anchorX : anchorX - finalW / 2;
      const y = top ? anchorY - finalH : bottom ? anchorY : anchorY - finalH / 2;

      syncCrop({ x, y, w: finalW, h: finalH });
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    dragging.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  }, [handlePointerMove]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  }, [handlePointerMove, handlePointerUp]);

  const handleConfirm = () => {
    // Read from refs — always the latest values, no stale closure risk
    const { x: cx, y: cy, w: cw, h: ch } = cropRef.current;
    const { x: px, y: py } = imgPosRef.current;
    const { w: iw, h: ih } = imgSizeRef.current;

    // Draw from the SAME <img> element the user is actually looking at
    // while cropping, instead of decoding a second, brand-new Image() from
    // the original source. Safari has a long-standing inconsistency where
    // an on-screen <img> auto-rotates a photo per its EXIF orientation tag
    // for display, but a fresh Image()/canvas drawImage() pair doesn't
    // always apply that same correction. Reusing the already-rendered
    // element removes that second, inconsistent decode.
    const imgEl = displayImgRef.current;
    if (!imgEl) return;
    const scaleX = imgEl.naturalWidth  / iw;
    const scaleY = imgEl.naturalHeight / ih;
    const srcX = Math.max(0, (cx - px) * scaleX);
    const srcY = Math.max(0, (cy - py) * scaleY);
    const srcW = Math.min(cw * scaleX, imgEl.naturalWidth  - srcX);
    const srcH = Math.min(ch * scaleY, imgEl.naturalHeight - srcY);
    const canvas = canvasRef.current;
    canvas.width  = Math.round(srcW);
    canvas.height = Math.round(srcH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
    onConfirm(canvas.toDataURL('image/jpeg', 0.95));
  };

  const hx = (h) => h.x === 'left' ? crop.x : h.x === 'right' ? crop.x + crop.w : crop.x + crop.w / 2;
  const hy = (h) => h.y === 'top'  ? crop.y : h.y === 'bottom' ? crop.y + crop.h : crop.y + crop.h / 2;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-charcoal text-white">
          <div>
            <p className="font-bold text-sm">Crop Headshot</p>
            <p className="text-xs text-gray-400">Draw new crop area · drag inside crop to pan · drag handles to resize — locked to headshot proportions</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Viewport */}
        <div className="flex justify-center bg-gray-200 py-4">
          <div
            ref={viewportRef}
            style={{ width: VIEW_W, height: VIEW_H, position: 'relative', overflow: 'hidden', cursor: 'crosshair', background: '#ccc' }}
            onPointerDown={e => {
              // Determine click position relative to the viewport div
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - rect.left;
              const my = e.clientY - rect.top;
              const c = cropRef.current;
              // If click is inside the existing crop box → pan image instead
              const insideCrop = mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h;
              if (insideCrop) {
                handlePointerDown(e, 'pan');
              } else {
                // Start drawing a new crop box from this point
                handlePointerDown(e, 'draw');
              }
            }}
          >
            {/* Image — not stretched, positioned by pan */}
            <img
              ref={displayImgRef}
              src={imageSrc}
              alt=""
              draggable={false}
              onLoad={handleImageLoad}
              style={{
                position: 'absolute',
                left: imgPos.x,
                top: imgPos.y,
                width: imgSize.w,
                height: imgSize.h,
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />

            {/* Dark overlay outside crop box */}
            <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width={VIEW_W} height={VIEW_H}>
              <defs>
                <mask id="crop-mask">
                  <rect width={VIEW_W} height={VIEW_H} fill="white" />
                  <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="black" />
                </mask>
              </defs>
              <rect width={VIEW_W} height={VIEW_H} fill="rgba(0,0,0,0.55)" mask="url(#crop-mask)" />
              {/* Crop border */}
              <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="none" stroke="#C9A84C" strokeWidth={2} />
              {/* Rule-of-thirds grid */}
              {[1/3,2/3].map(f => (
                <g key={f}>
                  <line x1={crop.x + crop.w*f} y1={crop.y} x2={crop.x + crop.w*f} y2={crop.y+crop.h} stroke="#C9A84C" strokeWidth={0.5} strokeOpacity={0.5} />
                  <line x1={crop.x} y1={crop.y + crop.h*f} x2={crop.x+crop.w} y2={crop.y + crop.h*f} stroke="#C9A84C" strokeWidth={0.5} strokeOpacity={0.5} />
                </g>
              ))}
            </svg>

            {/* Move crop box — inner drag zone */}
            <div
              style={{ position:'absolute', left:crop.x+12, top:crop.y+12, width:crop.w-24, height:crop.h-24, cursor:'move' }}
              onPointerDown={e => handlePointerDown(e, 'move-crop')}
            />

            {/* Resize handles */}
            {HANDLES.map(h => (
              <div
                key={h.id}
                onPointerDown={e => handlePointerDown(e, 'handle', h)}
                style={{
                  position: 'absolute',
                  left: hx(h) - 6,
                  top: hy(h) - 6,
                  width: 12,
                  height: 12,
                  background: '#C9A84C',
                  border: '2px solid white',
                  borderRadius: 2,
                  cursor: h.cursor,
                  zIndex: 10,
                }}
              />
            ))}
          </div>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Crop size info */}
        <div className="text-center text-xs text-gray-400 py-1">
          Crop: {Math.round(crop.w)} × {Math.round(crop.h)} px
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end px-5 py-4 border-t">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleConfirm} className="btn-gold">✓ Use This Crop</button>
        </div>
      </div>
    </div>
  );
}
