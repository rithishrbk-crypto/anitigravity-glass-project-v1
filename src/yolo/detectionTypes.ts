export interface Detection {
  className: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  detections: Detection[];
  inferenceTimeMs: number;
}

export type YoloBackend = 'WebGPU' | 'WASM';
