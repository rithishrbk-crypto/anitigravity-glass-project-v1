import type { Detection } from '../yolo/detectionTypes';
import type {
  DecisionPriority,
  DetectionFrame,
  DetectionDirection,
  NavigationContext,
  ObjectDecision,
  RelativeProximity,
} from './decisionTypes';

export const MIN_OBJECT_CONFIDENCE = 0.55;

const SUPPORTED_CLASSES = new Set([
  'person',
  'car',
  'truck',
  'bus',
  'motorcycle',
  'bicycle',
  'dog',
  'chair',
  'bench',
  'traffic light',
  'stop sign',
]);

const PRIORITY_RANK: Record<DecisionPriority, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  IGNORE: 0,
};

export class DecisionEngine {
  public evaluate(frame: DetectionFrame, context: NavigationContext): ObjectDecision[] {
    if (frame.width <= 0 || frame.height <= 0) return [];
    return frame.detections
      .map((detection) => this.evaluateDetection(detection, frame.width, frame.height, context))
      .sort((first, second) =>
        PRIORITY_RANK[second.priority] - PRIORITY_RANK[first.priority] || second.confidence - first.confidence,
      );
  }

  private evaluateDetection(
    detection: Detection,
    frameWidth: number,
    frameHeight: number,
    context: NavigationContext,
  ): ObjectDecision {
    const className = detection.className.toLowerCase();
    const normalizedCenterX = (detection.x + detection.width / 2) / frameWidth;
    const normalizedCenterY = (detection.y + detection.height / 2) / frameHeight;
    const areaRatio = (detection.width * detection.height) / (frameWidth * frameHeight);
    const direction: DetectionDirection = normalizedCenterX < 1 / 3
      ? 'LEFT'
      : normalizedCenterX > 2 / 3 ? 'RIGHT' : 'CENTER';
    const relativeProximity: RelativeProximity = areaRatio >= 0.16
      ? 'very-close'
      : areaRatio >= 0.06 ? 'close' : areaRatio >= 0.02 ? 'medium' : 'distant';
    const validBox = detection.width > 0
      && detection.height > 0
      && normalizedCenterX >= 0.05
      && normalizedCenterX <= 0.95
      && normalizedCenterY >= 0
      && normalizedCenterY <= 1;
    const confidenceValid = Number.isFinite(detection.confidence)
      && detection.confidence >= MIN_OBJECT_CONFIDENCE
      && detection.confidence <= 1;

    let priority: DecisionPriority = 'IGNORE';
    if (SUPPORTED_CLASSES.has(className) && validBox && confidenceValid) {
      priority = this.getPriority(className, direction, areaRatio, context);
    }

    return {
      className,
      confidence: detection.confidence,
      priority,
      direction,
      relativeProximity,
      normalizedCenterX,
      normalizedCenterY,
      message: this.getMessage(className, direction),
    };
  }

  private getPriority(
    className: string,
    direction: DetectionDirection,
    areaRatio: number,
    context: NavigationContext,
  ): DecisionPriority {
    const center = direction === 'CENTER';
    const close = areaRatio >= 0.06;
    const largeAndCentered = areaRatio >= 0.08;

    if (className === 'car' || className === 'truck' || className === 'bus' || className === 'motorcycle') {
      if (center && largeAndCentered) return 'HIGH';
      if (close) return center ? 'MEDIUM' : 'MEDIUM';
      return center && areaRatio >= 0.02 ? 'LOW' : 'IGNORE';
    }

    if (className === 'person') {
      if (center && largeAndCentered) return 'HIGH';
      if (areaRatio >= 0.03) return 'MEDIUM';
      return areaRatio >= 0.012 ? 'LOW' : 'IGNORE';
    }

    if (className === 'bicycle' || className === 'dog') {
      if (areaRatio >= 0.04) return 'MEDIUM';
      return center && areaRatio >= 0.015 ? 'LOW' : 'IGNORE';
    }

    if (className === 'traffic light' || className === 'stop sign') {
      if (center && context.navigationActive && context.routeAvailable && areaRatio >= 0.015) return 'MEDIUM';
      return center && areaRatio >= 0.02 ? 'LOW' : 'IGNORE';
    }

    if ((className === 'chair' || className === 'bench') && center && areaRatio >= 0.1) return 'LOW';
    return 'IGNORE';
  }

  private getMessage(className: string, direction: DetectionDirection) {
    const side = direction === 'LEFT' ? 'on your left' : direction === 'RIGHT' ? 'on your right' : 'ahead';
    if (className === 'dog') return direction === 'CENTER' ? 'Dog nearby.' : `Dog ${side}.`;
    if (className === 'traffic light') return `Traffic light ${side}.`;
    if (className === 'stop sign') return `Stop sign ${side}.`;
    if (className === 'car' || className === 'truck' || className === 'bus' || className === 'motorcycle') {
      return `Vehicle ${side}.`;
    }
    const label = className === 'bicycle' ? 'Bicycle'
      : className === 'person' ? 'Person'
        : className === 'chair' ? 'Chair'
          : className === 'bench' ? 'Bench'
            : className;
    return `${label} ${side}.`;
  }
}
