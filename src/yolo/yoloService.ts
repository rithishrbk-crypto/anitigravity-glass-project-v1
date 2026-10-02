import type { InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import type { Detection, DetectionResult, YoloBackend } from './detectionTypes';

export const CONFIDENCE_THRESHOLD = 0.5;
export const INFERENCE_INTERVAL_MS = 250;

const INPUT_SIZE = 192;
const NMS_IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 30;
const MODEL_URL = `${import.meta.env.BASE_URL}models/yolo11n.onnx`;

const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush',
];

interface LetterboxTransform {
  scale: number;
  left: number;
  top: number;
  sourceWidth: number;
  sourceHeight: number;
}

type Candidate = Detection;

export class YoloService {
  private session: InferenceSession | null = null;
  private backend: YoloBackend | null = null;
  private tensorConstructor: (new (type: 'float32', data: Float32Array, dims: number[]) => Tensor) | null = null;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private activeInference: Promise<DetectionResult> | null = null;
  private canvas: HTMLCanvasElement | null = null;

  public async load(): Promise<YoloBackend> {
    const operation = this.lifecycle.then(async () => {
      if (this.session && this.backend) return this.backend;

      let session: InferenceSession;
      let backend: YoloBackend;
      let tensorConstructor: (new (type: 'float32', data: Float32Array, dims: number[]) => Tensor);
      if ('gpu' in navigator) {
        const ort = await import('onnxruntime-web/webgpu');
        ort.env.wasm.numThreads = 1;
        try {
          session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['webgpu'] });
          backend = 'WebGPU';
          tensorConstructor = ort.Tensor;
        } catch {
          const wasm = await import('onnxruntime-web/wasm');
          wasm.env.wasm.numThreads = 1;
          session = await wasm.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
          backend = 'WASM';
          tensorConstructor = wasm.Tensor;
        }
      } else {
        const wasm = await import('onnxruntime-web/wasm');
        wasm.env.wasm.numThreads = 1;
        session = await wasm.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
        backend = 'WASM';
        tensorConstructor = wasm.Tensor;
      }

      try {
        this.validateModel(session);
      } catch (error) {
        await session.release();
        throw error;
      }
      this.session = session;
      this.backend = backend;
      this.tensorConstructor = tensorConstructor;
      return backend;
    });
    this.lifecycle = operation.then(() => undefined, () => undefined);
    return operation;
  }

  public async detect(video: HTMLVideoElement): Promise<DetectionResult> {
    if (!this.session) throw new Error('YOLO model is not ready.');
    if (this.activeInference) return this.activeInference;

    const inference = this.runInference(video, this.session);
    this.activeInference = inference;
    try {
      return await inference;
    } finally {
      if (this.activeInference === inference) this.activeInference = null;
    }
  }

  public async dispose(): Promise<void> {
    const operation = this.lifecycle.then(async () => {
      if (this.activeInference) await this.activeInference.catch(() => undefined);
      await this.session?.release();
      this.session = null;
      this.backend = null;
      this.tensorConstructor = null;
      this.canvas = null;
    });
    this.lifecycle = operation.then(() => undefined, () => undefined);
    await operation;
  }

  private validateModel(session: InferenceSession) {
    const input = session.inputMetadata[0];
    const output = session.outputMetadata[0];
    if (!input || !output) throw new Error('The YOLO model has no usable input or output.');
    if (input.isTensor !== true || output.isTensor !== true) throw new Error('The YOLO model has an unsupported input or output type.');
    const inputDimensions = input.shape;
    if (inputDimensions.length !== 4 || inputDimensions[1] !== 3) {
      throw new Error('The YOLO model input is not a supported four-dimensional RGB tensor.');
    }
  }

  private async runInference(video: HTMLVideoElement, session: InferenceSession): Promise<DetectionResult> {
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('The camera video is not ready for detection.');
    }

    const startedAt = performance.now();
    const { tensor, transform } = await this.prepareInput(video);
    let outputs: Awaited<ReturnType<InferenceSession['run']>> | null = null;
    try {
      outputs = await session.run({ [session.inputNames[0]]: tensor });
      const output = outputs[session.outputNames[0]];
      if (!output || !(output.data instanceof Float32Array)) {
        throw new Error('The YOLO model returned an unsupported output tensor.');
      }
      return {
        detections: this.decodeOutput(output.data, output.dims, transform),
        inferenceTimeMs: performance.now() - startedAt,
      };
    } finally {
      tensor.dispose();
      if (outputs) Object.values(outputs).forEach((output) => output.dispose());
    }
  }

  private async prepareInput(video: HTMLVideoElement): Promise<{ tensor: import('onnxruntime-web/webgpu').Tensor; transform: LetterboxTransform }> {
    const canvas = this.canvas ?? document.createElement('canvas');
    this.canvas = canvas;
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a canvas for YOLO preprocessing.');

    const scale = Math.min(INPUT_SIZE / video.videoWidth, INPUT_SIZE / video.videoHeight);
    const resizedWidth = Math.round(video.videoWidth * scale);
    const resizedHeight = Math.round(video.videoHeight * scale);
    const left = Math.floor((INPUT_SIZE - resizedWidth) / 2);
    const top = Math.floor((INPUT_SIZE - resizedHeight) / 2);
    context.fillStyle = 'rgb(114, 114, 114)';
    context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    context.drawImage(video, left, top, resizedWidth, resizedHeight);

    const pixels = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
    const channelSize = INPUT_SIZE * INPUT_SIZE;
    const input = new Float32Array(channelSize * 3);
    for (let pixel = 0; pixel < channelSize; pixel += 1) {
      const rgbaOffset = pixel * 4;
      input[pixel] = pixels[rgbaOffset] / 255;
      input[channelSize + pixel] = pixels[rgbaOffset + 1] / 255;
      input[channelSize * 2 + pixel] = pixels[rgbaOffset + 2] / 255;
    }

    if (!this.tensorConstructor) throw new Error('YOLO runtime is not ready.');
    const ortTensor = new this.tensorConstructor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    return {
      tensor: ortTensor,
      transform: { scale, left, top, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight },
    };
  }

  private decodeOutput(data: Float32Array, dimensions: readonly number[], transform: LetterboxTransform): Detection[] {
    if (dimensions.length !== 3 || dimensions[0] !== 1) {
      throw new Error('The YOLO model returned an unsupported output shape.');
    }
    const attributesFirst = dimensions[1] < dimensions[2];
    const attributeCount = attributesFirst ? dimensions[1] : dimensions[2];
    const boxCount = attributesFirst ? dimensions[2] : dimensions[1];
    if (attributeCount !== COCO_CLASSES.length + 4 || data.length !== attributeCount * boxCount) {
      throw new Error('The YOLO model output does not match the expected COCO detection format.');
    }

    const valueAt = (box: number, attribute: number) =>
      attributesFirst ? data[attribute * boxCount + box] : data[box * attributeCount + attribute];
    const candidates: Candidate[] = [];

    for (let box = 0; box < boxCount; box += 1) {
      let classId = -1;
      let confidence = CONFIDENCE_THRESHOLD;
      for (let classIndex = 0; classIndex < COCO_CLASSES.length; classIndex += 1) {
        const score = valueAt(box, classIndex + 4);
        if (score > confidence) {
          confidence = score;
          classId = classIndex;
        }
      }
      if (classId < 0) continue;

      const centerX = (valueAt(box, 0) - transform.left) / transform.scale;
      const centerY = (valueAt(box, 1) - transform.top) / transform.scale;
      const width = valueAt(box, 2) / transform.scale;
      const height = valueAt(box, 3) / transform.scale;
      const x1 = Math.max(0, centerX - width / 2);
      const y1 = Math.max(0, centerY - height / 2);
      const x2 = Math.min(transform.sourceWidth, centerX + width / 2);
      const y2 = Math.min(transform.sourceHeight, centerY + height / 2);
      if (x2 <= x1 || y2 <= y1) continue;

      candidates.push({
        className: COCO_CLASSES[classId],
        confidence,
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
      });
    }

    candidates.sort((first, second) => second.confidence - first.confidence);
    const selected: Candidate[] = [];
    for (const candidate of candidates) {
      if (selected.every((previous) => previous.className !== candidate.className || this.intersectionOverUnion(previous, candidate) <= NMS_IOU_THRESHOLD)) {
        selected.push(candidate);
        if (selected.length >= MAX_DETECTIONS) break;
      }
    }
    return selected;
  }

  private intersectionOverUnion(first: Detection, second: Detection) {
    const intersectionWidth = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
    const intersectionHeight = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
    const intersection = intersectionWidth * intersectionHeight;
    const union = first.width * first.height + second.width * second.height - intersection;
    return union > 0 ? intersection / union : 0;
  }
}
