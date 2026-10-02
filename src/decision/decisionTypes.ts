import type { Detection } from '../yolo/detectionTypes';

export type DecisionPriority = 'HIGH' | 'MEDIUM' | 'LOW' | 'IGNORE';
export type DetectionDirection = 'LEFT' | 'CENTER' | 'RIGHT';
export type RelativeProximity = 'distant' | 'medium' | 'close' | 'very-close';

export interface NavigationContext {
  currentLocation: { latitude: number; longitude: number } | null;
  navigationActive: boolean;
  routeAvailable: boolean;
  distanceToDestination: number | null;
  offRoute: boolean;
  destinationReached: boolean;
  voiceEnabled: boolean;
}

export interface DetectionFrame {
  detections: Detection[];
  width: number;
  height: number;
}

export interface ObjectDecision {
  className: string;
  confidence: number;
  priority: DecisionPriority;
  direction: DetectionDirection;
  relativeProximity: RelativeProximity;
  normalizedCenterX: number;
  normalizedCenterY: number;
  message: string;
}
