import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

/* ---------- Brand palette ---------- */
const COLORS = {
  navy:   '#2E2B7D',
  green:  '#71C1B0',
  yellow: '#E8CC4D',
  pink:   '#DB6376',
};
const SWATCHES = [COLORS.navy, COLORS.green, COLORS.yellow, COLORS.pink];
const BG = '#F8F4E8';
const INK = '#2D2C7E';

/* ---------- Shape library ----------
   `body(color)` returns raw SVG xml — used both by the React renderer
   (via dangerouslySetInnerHTML inside an <svg>) and by the export builder.
*/
const SHAPES = {
  circle: {
    label: 'Círculo', w: 333, h: 333, defColor: COLORS.navy,
    body: (c) => `<circle cx="166.5" cy="166.5" r="166.5" fill="${c}"/>`,
  },
  hexagon: {
    label: 'Hexágono', w: 371, h: 333, defColor: COLORS.navy,
    body: (c) => `<path fill="${c}" d="M364.064 142.731C372.495 157.296 372.495 175.258 364.064 189.823L295.02 309.1C286.617 323.616 271.116 332.554 254.343 332.554L116.044 332.554C99.2712 332.554 83.7697 323.616 75.3671 309.1L6.32323 189.823C-2.10786 175.258 -2.10786 157.296 6.32323 142.731L75.3671 23.4541C83.7697 8.93812 99.2712 0 116.044 0L254.343 0C271.116 0 286.617 8.93813 295.02 23.4541L364.064 142.731Z"/>`,
  },
  squircle: {
    label: 'Diamante', w: 334, h: 334, defColor: COLORS.yellow,
    body: (c) => `<path fill="${c}" d="M133.298 13.766C151.653 -4.58865 181.411 -4.58864 199.766 13.766L319.298 133.298C337.653 151.653 337.653 181.411 319.298 199.766L199.766 319.298C181.411 337.653 151.653 337.653 133.298 319.298L13.766 199.766C-4.58865 181.411 -4.58864 151.653 13.766 133.298L133.298 13.766Z"/>`,
  },
  triangle: {
    label: 'Triángulo', w: 303, h: 335, defColor: COLORS.green,
    body: (c) => `<path fill="${c}" d="M23.5001 208.151C-7.83324 190.061 -7.83333 144.835 23.5 126.744L232 6.36696C263.333 -11.7233 302.5 10.8895 302.5 47.0701L302.5 287.825C302.5 324.006 263.333 346.619 232 328.528L23.5001 208.151Z"/>`,
  },
  pill: {
    label: 'Píldora', w: 614, h: 333, defColor: COLORS.yellow,
    body: (c) => `<rect width="614" height="333" rx="47" fill="${c}"/>`,
  },
  square: {
    label: 'Cuadrado', w: 333, h: 333, defColor: COLORS.pink,
    body: (c) => `<rect width="333" height="333" rx="47" fill="${c}"/>`,
  },
  dome: {
    label: 'Domo', w: 480, h: 333, defColor: COLORS.green,
    body: (c) => `<path fill="${c}" d="M480 286C480 311.957 458.957 333 433 333L47 333C21.0426 333 0 311.957 0 286L0 240C0 107.452 107.452 0 240 0C372.548 0 480 107.452 480 240L480 286Z"/>`,
  },
};
const SHAPE_KEYS = Object.keys(SHAPES);

/* ---------- Helpers ---------- */
let _uid = 1;
const uid = () => 's' + (_uid++);

function ShapeSVG({ kind, color, width, rotation = 0, style }) {
  const def = SHAPES[kind];
  const h = width * (def.h / def.w);
  return (
    <svg
      width={width}
      height={h}
      viewBox={`0 0 ${def.w} ${def.h}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform: `rotate(${rotation}deg)`, display: 'block', overflow: 'visible', ...style }}
      dangerouslySetInnerHTML={{ __html: def.body(color) }}
    />
  );
}

/* AABB of an item, accounting for rotation */
function itemAABB(it) {
  const def = SHAPES[it.kind];
  const w = it.w;
  const h = it.w * (def.h / def.w);
  const r = (it.rot * Math.PI) / 180;
  const cs = Math.abs(Math.cos(r));
  const sn = Math.abs(Math.sin(r));
  const rw = w * cs + h * sn;
  const rh = w * sn + h * cs;
  return {
    x1: it.x - rw / 2, y1: it.y - rh / 2,
    x2: it.x + rw / 2, y2: it.y + rh / 2,
    cx: it.x, cy: it.y, rw, rh,
  };
}

/* ---------- Magnetism ---------- */
const SNAP_RADIUS = 14;
const SNAP_GAP    = 6;
const UNSTICK     = 22;

function computeSnap(self, proposedCx, proposedCy, others) {
  const def = SHAPES[self.kind];
  const w = self.w;
  const h = self.w * (def.h / def.w);
  const r = (self.rot * Math.PI) / 180;
  const cs = Math.abs(Math.cos(r));
  const sn = Math.abs(Math.sin(r));
  const rw = w * cs + h * sn;
  const rh = w * sn + h * cs;

  const px1 = proposedCx - rw / 2, px2 = proposedCx + rw / 2;
  const py1 = proposedCy - rh / 2, py2 = proposedCy + rh / 2;

  let bestX = null, bestY = null;
  const tryX = (cand) => {
    const d = Math.abs(cand.value - proposedCx);
    if (d < SNAP_RADIUS && (bestX === null || d < bestX.dist)) bestX = { ...cand, dist: d };
  };
  const tryY = (cand) => {
    const d = Math.abs(cand.value - proposedCy);
    if (d < SNAP_RADIUS && (bestY === null || d < bestY.dist)) bestY = { ...cand, dist: d };
  };

  for (const o of others) {
    const a = itemAABB(o);
    const yOverlap = !(py2 < a.y1 - SNAP_RADIUS || py1 > a.y2 + SNAP_RADIUS);
    const xOverlap = !(px2 < a.x1 - SNAP_RADIUS || px1 > a.x2 + SNAP_RADIUS);
    if (yOverlap) {
      tryX({ value: a.x1 - SNAP_GAP - rw / 2, guide: a.x1 - SNAP_GAP / 2 });
      tryX({ value: a.x2 + SNAP_GAP + rw / 2, guide: a.x2 + SNAP_GAP / 2 });
      tryX({ value: a.cx, guide: a.cx });
    }
    if (xOverlap) {
      tryY({ value: a.y1 - SNAP_GAP - rh / 2, guide: a.y1 - SNAP_GAP / 2 });
      tryY({ value: a.y2 + SNAP_GAP + rh / 2, guide: a.y2 + SNAP_GAP / 2 });
      tryY({ value: a.cy, guide: a.cy });
    }
  }
  return { x: bestX, y: bestY };
}

/* ---------- Export ---------- */
function contentBounds(items) {
  if (items.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const it of items) {
    const a = itemAABB(it);
    if (a.x1 < x1) x1 = a.x1;
    if (a.y1 < y1) y1 = a.y1;
    if (a.x2 > x2) x2 = a.x2;
    if (a.y2 > y2) y2 = a.y2;
  }
  return { x1, y1, x2, y2 };
}

function buildExportSVG(items, opts = {}) {
  const bounds = contentBounds(items);
  if (!bounds) return null;
  const pad = opts.pad ?? 48;
  const includeBg = opts.background ?? true;
  const vbX = bounds.x1 - pad;
  const vbY = bounds.y1 - pad;
  const vbW = bounds.x2 - bounds.x1 + pad * 2;
  const vbH = bounds.y2 - bounds.y1 + pad * 2;

  const layers = items.map((it) => {
    const def = SHAPES[it.kind];
    const sx = it.w / def.w;
    return (
      `<g transform="translate(${it.x.toFixed(2)} ${it.y.toFixed(2)}) ` +
      `rotate(${it.rot.toFixed(2)}) scale(${sx.toFixed(4)}) ` +
      `translate(${(-def.w / 2).toFixed(2)} ${(-def.h / 2).toFixed(2)})">` +
      def.body(it.color) + `</g>`
    );
  }).join('');

  const bg = includeBg
    ? `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${BG}"/>`
    : '';

  return {
    xml:
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${Math.round(vbW)}" height="${Math.round(vbH)}" ` +
      `viewBox="${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}">` +
      bg + layers + `</svg>`,
    width: vbW,
    height: vbH,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

function exportSVG(items) {
  const out = buildExportSVG(items, { background: true });
  if (!out) return;
  downloadBlob(new Blob([out.xml], { type: 'image/svg+xml;charset=utf-8' }), 'somo-siete.svg');
}

function exportPNG(items, { transparent = false, scale = 2 } = {}) {
  const out = buildExportSVG(items, { background: !transparent });
  if (!out) return;
  const svgBlob = new Blob([out.xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(out.width * scale);
    c.height = Math.round(out.height * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((b) => {
      if (b) downloadBlob(b, transparent ? 'somo-siete-transp.png' : 'somo-siete.png');
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('No se pudo generar el PNG. Intenta de nuevo.');
  };
  img.src = url;
}

/* ---------- App ---------- */
function App() {
  const [items, setItems] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [guides, setGuides] = useState({ x: null, y: null });
  const [marquee, setMarquee] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const canvasRef = useRef(null);
  const [canvasRect, setCanvasRect] = useState({ w: 1200, h: 700 });
  const [showHint, setShowHint] = useState(true);
  const seededRef = useRef(false);

  /* Measure canvas */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setCanvasRect({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Seed starter once we know the canvas size */
  useEffect(() => {
    if (seededRef.current) return;
    if (canvasRect.w < 400) return;
    seededRef.current = true;
    const cx = canvasRect.w / 2;
    const cy = canvasRect.h / 2;
    const seed = [
      { id: uid(), kind: 'hexagon',  x: cx,       y: cy + 20,  w: 220, rot: 0,  color: COLORS.yellow },
      { id: uid(), kind: 'circle',   x: cx,       y: cy - 156, w: 140, rot: 0,  color: COLORS.navy },
      { id: uid(), kind: 'squircle', x: cx,       y: cy - 156, w: 56,  rot: 0,  color: COLORS.yellow },
      { id: uid(), kind: 'dome',     x: cx + 130, y: cy - 156, w: 60,  rot: 90, color: COLORS.pink },
      { id: uid(), kind: 'square',   x: cx - 160, y: cy + 20,  w: 50,  rot: 0,  color: COLORS.pink },
      { id: uid(), kind: 'pill',     x: cx,       y: cy + 165, w: 130, rot: 0,  color: COLORS.green },
      { id: uid(), kind: 'triangle', x: cx,       y: cy + 222, w: 38,  rot: 90, color: COLORS.navy },
    ];
    setItems(seed);
    setShowHint(false);
  }, [canvasRect.w, canvasRect.h]);

  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds]
  );
  const singleSelected = selectedItems.length === 1 ? selectedItems[0] : null;

  const updateItem = useCallback((id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const updateMany = useCallback((idsSet, patch) => {
    setItems((prev) => prev.map((it) => (idsSet.has(it.id) ? { ...it, ...patch } : it)));
  }, []);

  const addShape = (kind) => {
    const def = SHAPES[kind];
    const startW = Math.min(180, def.w * 0.55);
    const it = {
      id: uid(),
      kind,
      x: canvasRect.w / 2 + (Math.random() - 0.5) * 80,
      y: canvasRect.h / 2 + (Math.random() - 0.5) * 80,
      w: startW,
      rot: 0,
      color: def.defColor,
    };
    setItems((prev) => [...prev, it]);
    setSelectedIds(new Set([it.id]));
    setShowHint(false);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    setSelectedIds(new Set());
  };

  const duplicateSelected = () => {
    if (selectedIds.size === 0) return;
    const newIds = new Set();
    const copies = items.filter((i) => selectedIds.has(i.id)).map((src) => {
      const id = uid();
      newIds.add(id);
      return { ...src, id, x: src.x + 30, y: src.y + 30 };
    });
    setItems((prev) => [...prev, ...copies]);
    setSelectedIds(newIds);
  };

  const reorderSingle = (id, dir) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const [it] = next.splice(idx, 1);
      const newIdx = Math.max(0, Math.min(next.length, idx + dir));
      next.splice(newIdx, 0, it);
      return next;
    });
  };

  const clearAll = () => {
    if (items.length === 0) return;
    if (!window.confirm('¿Borrar todas las formas del lienzo?')) return;
    setItems([]);
    setSelectedIds(new Set());
    setShowHint(true);
  };

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((i) => i.id)));
  }, [items]);

  /* ---------- Marquee selection ---------- */
  const marqueeRef = useRef(null);

  const onCanvasPointerDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    marqueeRef.current = {
      startX: sx, startY: sy,
      pointerId: e.pointerId,
      additive,
      base: additive ? new Set(selectedIds) : new Set(),
      moved: false,
    };
    setMarquee({ x1: sx, y1: sy, x2: sx, y2: sy });
    if (!additive) setSelectedIds(new Set());
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  };

  const onCanvasPointerMove = (e) => {
    const m = marqueeRef.current;
    if (!m) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const dx = cx - m.startX, dy = cy - m.startY;
    if (!m.moved && (Math.abs(dx) + Math.abs(dy)) > 2) m.moved = true;
    const x1 = Math.min(m.startX, cx);
    const y1 = Math.min(m.startY, cy);
    const x2 = Math.max(m.startX, cx);
    const y2 = Math.max(m.startY, cy);
    setMarquee({ x1, y1, x2, y2 });

    const hits = new Set(m.base);
    for (const it of items) {
      const a = itemAABB(it);
      const intersects = !(a.x2 < x1 || a.x1 > x2 || a.y2 < y1 || a.y1 > y2);
      if (intersects) hits.add(it.id);
    }
    setSelectedIds(hits);
  };

  const onCanvasPointerUp = (e) => {
    if (!marqueeRef.current) return;
    marqueeRef.current = null;
    setMarquee(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  /* ---------- Magnetic drag (single + group) ---------- */
  const dragRef = useRef(null);

  const onShapePointerDown = (e, it) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    let nextSelection;
    if (additive) {
      nextSelection = new Set(selectedIds);
      if (nextSelection.has(it.id)) nextSelection.delete(it.id);
      else nextSelection.add(it.id);
    } else if (!selectedIds.has(it.id)) {
      nextSelection = new Set([it.id]);
    } else {
      nextSelection = selectedIds;
    }
    setSelectedIds(nextSelection);

    if (!nextSelection.has(it.id)) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const groupMembers = items
      .filter((o) => nextSelection.has(o.id))
      .map((o) => ({ id: o.id, dx: o.x - it.x, dy: o.y - it.y }));

    dragRef.current = {
      id: it.id,
      offsetX: e.clientX - rect.left - it.x,
      offsetY: e.clientY - rect.top - it.y,
      ghostX: it.x,
      ghostY: it.y,
      lockX: null,
      lockY: null,
      group: groupMembers,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  };

  const onShapePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const ghostX = e.clientX - rect.left - d.offsetX;
    const ghostY = e.clientY - rect.top - d.offsetY;
    d.ghostX = ghostX;
    d.ghostY = ghostY;

    if (d.lockX && Math.abs(ghostX - d.lockX.anchorGhost) > UNSTICK) d.lockX = null;
    if (d.lockY && Math.abs(ghostY - d.lockY.anchorGhost) > UNSTICK) d.lockY = null;

    setItems((prev) => {
      const self = prev.find((p) => p.id === d.id);
      if (!self) return prev;
      const groupIds = new Set(d.group.map((g) => g.id));
      const others = prev.filter((p) => !groupIds.has(p.id));

      const snap = computeSnap(self, ghostX, ghostY, others);

      if (!d.lockX && snap.x) {
        d.lockX = { snapValue: snap.x.value, anchorGhost: ghostX, guide: snap.x.guide };
      }
      if (!d.lockY && snap.y) {
        d.lockY = { snapValue: snap.y.value, anchorGhost: ghostY, guide: snap.y.guide };
      }

      const renderX = d.lockX ? d.lockX.snapValue : ghostX;
      const renderY = d.lockY ? d.lockY.snapValue : ghostY;

      setGuides({
        x: d.lockX ? d.lockX.guide : null,
        y: d.lockY ? d.lockY.guide : null,
      });

      return prev.map((it) => {
        const g = d.group.find((m) => m.id === it.id);
        if (!g) return it;
        return { ...it, x: renderX + g.dx, y: renderY + g.dy };
      });
    });
  };

  const onShapePointerUp = (e) => {
    dragRef.current = null;
    setGuides({ x: null, y: null });
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  /* Keyboard */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === 'Escape') {
        setSelectedIds(new Set());
        setExportOpen(false);
        return;
      }
      if (selectedIds.size === 0) return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key.toLowerCase() === 'd' && mod) {
        e.preventDefault(); duplicateSelected();
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
        setItems((prev) => prev.map((it) => (selectedIds.has(it.id) ? { ...it, x: it.x + dx, y: it.y + dy } : it)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, items, selectAll]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Close export dropdown on outside click */
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e) => {
      if (!e.target.closest('.export-wrap')) setExportOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [exportOpen]);

  return (
    <div className="app">
      {/* Header */}
      <header className="hdr">
        <button className="back-btn" onClick={() => window.history.back()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Inicio</span>
        </button>
        <div className="logo-wrap">
          <img src="/assets/logo.svg" alt="somos siete" className="logo" />
        </div>
        <div className="hdr-right">
          <div className="export-wrap">
            <button
              className="btn-primary"
              onClick={() => setExportOpen((v) => !v)}
              disabled={items.length === 0}
              title={items.length === 0 ? 'Añade alguna forma primero' : 'Exportar figura'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 15V3m0 12l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Exportar</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.7 }}>
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {exportOpen && (
              <div className="export-menu" role="menu">
                <button className="menu-item" onClick={() => { exportPNG(items, { transparent: false }); setExportOpen(false); }}>
                  <div className="menu-icon" style={{ background: BG, border: '1px solid var(--line)' }} />
                  <div>
                    <div className="menu-title">PNG · con fondo</div>
                    <div className="menu-sub">Imagen lista para compartir</div>
                  </div>
                </button>
                <button className="menu-item" onClick={() => { exportPNG(items, { transparent: true }); setExportOpen(false); }}>
                  <div className="menu-icon menu-icon-transp" />
                  <div>
                    <div className="menu-title">PNG · transparente</div>
                    <div className="menu-sub">Solo las formas, sin fondo</div>
                  </div>
                </button>
                <div className="menu-divider" />
                <button className="menu-item" onClick={() => { exportSVG(items); setExportOpen(false); }}>
                  <div className="menu-icon" style={{ background: 'linear-gradient(135deg,#E8CC4D 0%, #DB6376 100%)' }} />
                  <div>
                    <div className="menu-title">SVG · vectorial</div>
                    <div className="menu-sub">Editable y escalable</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="body">
        {/* Left palette */}
        <aside className="palette">
          <div className="palette-title">Formas</div>
          <div className="palette-grid">
            {SHAPE_KEYS.map((k) => (
              <button
                key={k}
                className="palette-item"
                onClick={() => addShape(k)}
                title={SHAPES[k].label}
              >
                <ShapeSVG kind={k} color={SHAPES[k].defColor} width={42} />
              </button>
            ))}
          </div>
          <div className="palette-hint">
            Toca para añadir<br/>al lienzo
          </div>
        </aside>

        {/* Canvas */}
        <main className="canvas-wrap">
          <div
            ref={canvasRef}
            className="canvas"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
          >
            {showHint && items.length === 0 && (
              <div className="hint">
                <div className="hint-title">Crea tu figura</div>
                <div className="hint-sub">Toca una forma de la izquierda para empezar</div>
              </div>
            )}

            {items.map((it) => {
              const def = SHAPES[it.kind];
              const h = it.w * (def.h / def.w);
              const sel = selectedIds.has(it.id);
              return (
                <div
                  key={it.id}
                  className={'item' + (sel ? ' selected' : '')}
                  style={{
                    left: it.x,
                    top: it.y,
                    width: it.w,
                    height: h,
                    transform: `translate(-50%, -50%) rotate(${it.rot}deg)`,
                  }}
                  onPointerDown={(e) => onShapePointerDown(e, it)}
                  onPointerMove={onShapePointerMove}
                  onPointerUp={onShapePointerUp}
                  onPointerCancel={onShapePointerUp}
                >
                  <ShapeSVG kind={it.kind} color={it.color} width={it.w} />
                </div>
              );
            })}

            {/* Marquee */}
            {marquee && (
              <div
                className="marquee"
                style={{
                  left: marquee.x1,
                  top: marquee.y1,
                  width: marquee.x2 - marquee.x1,
                  height: marquee.y2 - marquee.y1,
                }}
              />
            )}

            {/* Magnet alignment guides */}
            {guides.x !== null && (
              <div className="guide guide-v" style={{ left: guides.x }} />
            )}
            {guides.y !== null && (
              <div className="guide guide-h" style={{ top: guides.y }} />
            )}

            {/* Counter */}
            <div className="counter">
              {items.length} {items.length === 1 ? 'forma' : 'formas'}
              {selectedIds.size > 0 && <span className="counter-sel"> · {selectedIds.size} sel.</span>}
            </div>
          </div>

          {/* Floating clear button */}
          {items.length > 0 && (
            <button className="clear-fab" onClick={clearAll} title="Limpiar lienzo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Limpiar</span>
            </button>
          )}
        </main>

        {/* Right inspector */}
        <aside className="inspector">
          {selectedItems.length === 0 && <EmptyInspector />}
          {selectedItems.length === 1 && (
            <Inspector
              item={singleSelected}
              onChange={(patch) => updateItem(singleSelected.id, patch)}
              onDelete={deleteSelected}
              onDuplicate={duplicateSelected}
              onForward={() => reorderSingle(singleSelected.id, +1)}
              onBackward={() => reorderSingle(singleSelected.id, -1)}
            />
          )}
          {selectedItems.length > 1 && (
            <MultiInspector
              count={selectedItems.length}
              items={selectedItems}
              onColor={(c) => updateMany(selectedIds, { color: c })}
              onDelete={deleteSelected}
              onDuplicate={duplicateSelected}
              onClear={() => setSelectedIds(new Set())}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------- Inspector ---------- */
function EmptyInspector() {
  return (
    <div className="insp-empty">
      <div className="insp-empty-icon">
        <svg width="48" height="48" viewBox="0 0 64 64" fill="none">
          <circle cx="22" cy="22" r="10" stroke={INK} strokeWidth="2.5"/>
          <rect x="34" y="34" width="20" height="20" rx="4" stroke={INK} strokeWidth="2.5"/>
        </svg>
      </div>
      <div className="insp-empty-title">Nada seleccionado</div>
      <div className="insp-empty-sub">
        Toca una forma del lienzo, o arrastra sobre el área vacía para seleccionar varias.
      </div>
      <div className="magnet-tip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M5 4h4v8a3 3 0 006 0V4h4v8a7 7 0 01-14 0V4z" stroke={INK} strokeWidth="2" strokeLinejoin="round"/>
          <path d="M5 4h4M15 4h4" stroke={INK} strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <span>Las formas se atraen entre sí al moverlas</span>
      </div>
      <div className="kbd-tips">
        <div className="kbd-row"><kbd>Arrastrar</kbd><span>Marco de selección</span></div>
        <div className="kbd-row"><kbd>⇧</kbd><span>+ clic / + arrastrar</span></div>
        <div className="kbd-row"><kbd>⌘A</kbd><span>Seleccionar todo</span></div>
        <div className="kbd-row"><kbd>↑↓←→</kbd><span>Mover</span></div>
        <div className="kbd-row"><kbd>⌫</kbd><span>Borrar</span></div>
        <div className="kbd-row"><kbd>⌘D</kbd><span>Duplicar</span></div>
        <div className="kbd-row"><kbd>Esc</kbd><span>Deseleccionar</span></div>
      </div>
    </div>
  );
}

function Inspector({ item, onChange, onDelete, onDuplicate, onForward, onBackward }) {
  const def = SHAPES[item.kind];
  return (
    <div className="insp">
      <div className="insp-header">
        <div className="insp-preview">
          <ShapeSVG kind={item.kind} color={item.color} width={Math.min(56, 56 * (def.w / Math.max(def.w, def.h)))} />
        </div>
        <div>
          <div className="insp-kind">{def.label}</div>
          <div className="insp-id">id · {item.id}</div>
        </div>
      </div>

      <section className="insp-section">
        <div className="insp-label">Color</div>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={'swatch' + (item.color.toLowerCase() === c.toLowerCase() ? ' on' : '')}
              style={{ background: c }}
              onClick={() => onChange({ color: c })}
              title={c}
            />
          ))}
        </div>
      </section>

      <section className="insp-section">
        <div className="insp-label-row">
          <span className="insp-label">Tamaño</span>
          <span className="insp-value">{Math.round(item.w)} px</span>
        </div>
        <input
          type="range" min="24" max="520" step="1"
          value={item.w} onChange={(e) => onChange({ w: +e.target.value })}
        />
        <div className="size-presets">
          {[60, 120, 200, 320].map((s) => (
            <button key={s} onClick={() => onChange({ w: s })} className="preset">{s}</button>
          ))}
        </div>
      </section>

      <section className="insp-section">
        <div className="insp-label-row">
          <span className="insp-label">Rotación</span>
          <span className="insp-value">{Math.round(item.rot)}°</span>
        </div>
        <input
          type="range" min="0" max="360" step="1"
          value={item.rot} onChange={(e) => onChange({ rot: +e.target.value })}
        />
        <div className="size-presets">
          {[0, 45, 90, 180, 270].map((d) => (
            <button key={d} onClick={() => onChange({ rot: d })} className="preset">{d}°</button>
          ))}
        </div>
      </section>

      <section className="insp-section">
        <div className="insp-label">Capa</div>
        <div className="row-2">
          <button className="btn-ghost" onClick={onBackward}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 17l-4-4 4-4M3 13h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Atrás
          </button>
          <button className="btn-ghost" onClick={onForward}>
            Adelante
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M17 7l4 4-4 4M21 11H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </section>

      <section className="insp-section">
        <div className="row-2">
          <button className="btn-ghost" onClick={onDuplicate}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M16 4H6a2 2 0 00-2 2v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Duplicar
          </button>
          <button className="btn-danger" onClick={onDelete}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Eliminar
          </button>
        </div>
      </section>
    </div>
  );
}

function MultiInspector({ count, items, onColor, onDelete, onDuplicate, onClear }) {
  const tally = {};
  for (const it of items) tally[it.kind] = (tally[it.kind] || 0) + 1;
  const kinds = Object.keys(tally);
  return (
    <div className="insp">
      <div className="insp-header">
        <div className="insp-preview insp-preview-multi">
          <div className="multi-stack">
            {items.slice(0, 3).map((it, idx) => (
              <div key={it.id} className="multi-stack-item" style={{ zIndex: 10 - idx }}>
                <ShapeSVG kind={it.kind} color={it.color} width={32} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="insp-kind">{count} seleccionadas</div>
          <div className="insp-id">
            {kinds.length === 1
              ? `${count} · ${SHAPES[kinds[0]].label}`
              : `${kinds.length} tipos de forma`}
          </div>
        </div>
      </div>

      <section className="insp-section">
        <div className="insp-label">Aplicar color a todas</div>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c }}
              onClick={() => onColor(c)}
              title={c}
            />
          ))}
        </div>
      </section>

      <section className="insp-section">
        <div className="insp-label">Acciones</div>
        <div className="row-2">
          <button className="btn-ghost" onClick={onDuplicate}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M16 4H6a2 2 0 00-2 2v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Duplicar
          </button>
          <button className="btn-danger" onClick={onDelete}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Eliminar
          </button>
        </div>
        <button className="btn-text" onClick={onClear}>Deseleccionar</button>
      </section>

      <div className="multi-tip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M5 9l4 4 10-10" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Arrastra cualquiera de las formas seleccionadas para mover todo el grupo a la vez.</span>
      </div>
    </div>
  );
}

export default App;
