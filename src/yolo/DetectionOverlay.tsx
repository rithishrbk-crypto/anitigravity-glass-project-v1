import type { Detection } from './detectionTypes';

interface DetectionOverlayProps {
  detections: Detection[];
  videoWidth: number;
  videoHeight: number;
}

export function DetectionOverlay({ detections, videoWidth, videoHeight }: DetectionOverlayProps) {
  const lineWidth = Math.max(5, videoWidth / 240);
  const fontSize = Math.max(40, videoWidth / 18);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${videoWidth} ${videoHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {detections.map((detection, index) => {
        const label = `${detection.className} ${detection.confidence.toFixed(2)}`;
        const labelY = Math.max(fontSize + lineWidth, detection.y);
        const labelWidth = label.length * fontSize * 0.58 + lineWidth * 2;
        return (
          <g key={`${detection.className}-${detection.x}-${detection.y}-${index}`}>
            <rect
              x={detection.x}
              y={detection.y}
              width={detection.width}
              height={detection.height}
              fill="none"
              stroke="#22d3ee"
              strokeWidth={lineWidth}
            />
            <rect
              x={detection.x}
              y={labelY - fontSize - lineWidth}
              width={labelWidth}
              height={fontSize + lineWidth * 2}
              rx={lineWidth}
              fill="#0f172a"
              fillOpacity="0.9"
            />
            <text
              x={detection.x + lineWidth}
              y={labelY}
              fill="white"
              fontSize={fontSize}
              fontWeight="600"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
