import { useEffect, useRef, useState } from "react";
import { FigmaNode, toStyleMap } from "../utils/figmaToCode";

interface FigmaNodePreviewProps {
  node: FigmaNode;
  parent?: FigmaNode;
}

export function FigmaNodePreview({ node, parent }: FigmaNodePreviewProps) {
  const style = toStyleMap(node, parent) as React.CSSProperties;

  if (node.type === "TEXT") {
    return (
      <p style={style} title={node.name}>
        {node.characters ?? node.name}
      </p>
    );
  }

  return (
    <div style={style} title={node.name}>
      {(node.children ?? [])
        .filter((child) => child.absoluteBoundingBox && child.absoluteBoundingBox.width > 0 && child.absoluteBoundingBox.height > 0)
        .map((child) => (
          <FigmaNodePreview key={child.id} node={child} parent={node} />
        ))}
    </div>
  );
}

interface FigmaPreviewProps {
  activeFrame: FigmaNode | null;
}

export function FigmaPreview({ activeFrame }: FigmaPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!activeFrame || !containerRef.current) return;

    const updateScale = () => {
      const container = containerRef.current;
      if (!container) return;

      const containerWidth = container.clientWidth - 32; // padding
      const containerHeight = container.clientHeight - 32; // padding
      const frameWidth = activeFrame.absoluteBoundingBox?.width || 360;
      const frameHeight = activeFrame.absoluteBoundingBox?.height || 640;

      const scaleX = containerWidth / frameWidth;
      const scaleY = containerHeight / frameHeight;
      const newScale = Math.min(scaleX, scaleY, 1); // don't scale up past 100%

      setScale(newScale > 0.1 ? newScale : 1);
    };

    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [activeFrame]);

  if (!activeFrame) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-[#e9c4d0] bg-[#fdfafb] p-6 text-center text-shield-plum/50">
        <svg
          className="mb-2 h-10 w-10 text-shield-pink"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span className="text-sm font-semibold">No Frame Selected</span>
        <span className="mt-1 text-xs text-shield-plum/40">
          Load Figma JSON and select a frame from the sidebar to preview.
        </span>
      </div>
    );
  }

  const width = activeFrame.absoluteBoundingBox?.width || 360;
  const height = activeFrame.absoluteBoundingBox?.height || 640;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full min-h-[500px] flex-col items-center justify-center rounded-lg border border-[#e9c4d0] bg-[#f7edf1]/30 p-4"
    >
      <div
        className="relative shadow-phone transition-all border border-[#e9c4d0] bg-white rounded"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          transition: "transform 0.2s ease-out",
        }}
      >
        <FigmaNodePreview node={activeFrame} />
      </div>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-shield-plum/85 px-3 py-1 text-[10px] font-semibold tracking-wider text-white backdrop-blur">
        {activeFrame.name} • {Math.round(width)}x{Math.round(height)} px • {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
