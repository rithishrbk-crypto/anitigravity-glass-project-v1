import type { DecisionPriority, ObjectDecision } from './decisionTypes';

export const OBJECT_ANNOUNCEMENT_COOLDOWN_MS = 5_000;
const NAVIGATION_ANNOUNCEMENT_PRIORITY_MS = 3_500;
const OBJECT_ANNOUNCEMENT_SPACING_MS = 1_500;
const DISAPPEARED_FRAME_COUNT = 2;
const SIGNIFICANT_MOVEMENT_RATIO = 0.18;

interface PreviousAnnouncement {
  announcedAt: number;
  priority: DecisionPriority;
  direction: ObjectDecision['direction'];
  centerX: number;
  centerY: number;
}

interface ObjectPresence {
  missingFrames: number;
}

const priorityRank: Record<DecisionPriority, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  IGNORE: 0,
};

export class AnnouncementManager {
  private readonly previousByAnnouncement = new Map<string, PreviousAnnouncement>();
  private readonly presenceByClass = new Map<string, ObjectPresence>();
  private readonly reappearedClasses = new Set<string>();
  private navigationPriorityUntil = 0;
  private lastObjectAnnouncementAt: number | null = null;

  public noteNavigationAnnouncement(now = Date.now(), priorityMs = NAVIGATION_ANNOUNCEMENT_PRIORITY_MS) {
    this.navigationPriorityUntil = Math.max(this.navigationPriorityUntil, now + priorityMs);
  }

  public clear() {
    this.previousByAnnouncement.clear();
    this.presenceByClass.clear();
    this.reappearedClasses.clear();
    this.navigationPriorityUntil = 0;
    this.lastObjectAnnouncementAt = null;
  }

  public select(
    decisions: ObjectDecision[],
    now: number,
    options: { voiceEnabled: boolean; destinationReached: boolean; offRoute: boolean },
  ): ObjectDecision | null {
    const visibleClasses = new Set(
      decisions.filter((decision) => decision.priority !== 'IGNORE').map((decision) => decision.className),
    );

    for (const className of visibleClasses) {
      this.presenceByClass.set(className, { missingFrames: 0 });
    }
    for (const [className, presence] of this.presenceByClass) {
      if (visibleClasses.has(className)) continue;
      presence.missingFrames += 1;
      if (presence.missingFrames >= DISAPPEARED_FRAME_COUNT) {
        this.presenceByClass.delete(className);
        for (const key of this.previousByAnnouncement.keys()) {
          if (key.startsWith(`${className}:`)) this.previousByAnnouncement.delete(key);
        }
        this.reappearedClasses.add(className);
      }
    }

    if (!options.voiceEnabled || options.destinationReached || options.offRoute || now < this.navigationPriorityUntil) return null;

    const evaluatedClasses = new Set<string>();
    for (const decision of decisions) {
      if (decision.priority === 'IGNORE') continue;
      if (evaluatedClasses.has(decision.className)) continue;
      evaluatedClasses.add(decision.className);
      const previous = this.previousByAnnouncement.get(this.getAnnouncementKey(decision));
      const reappeared = this.reappearedClasses.has(decision.className);
      const spacingElapsed = this.lastObjectAnnouncementAt === null
        || now - this.lastObjectAnnouncementAt >= OBJECT_ANNOUNCEMENT_SPACING_MS;
      if (!previous) {
        if (spacingElapsed || reappeared) return decision;
        continue;
      }

      const priorityIncreased = priorityRank[decision.priority] > priorityRank[previous.priority];
      const directionChanged = decision.direction !== previous.direction;
      const movedSignificantly = Math.hypot(
        decision.normalizedCenterX - previous.centerX,
        decision.normalizedCenterY - previous.centerY,
      ) >= SIGNIFICANT_MOVEMENT_RATIO;
      const cooldownElapsed = now - previous.announcedAt >= OBJECT_ANNOUNCEMENT_COOLDOWN_MS;
      if (reappeared || priorityIncreased || directionChanged || cooldownElapsed) return decision;
      if (movedSignificantly && spacingElapsed) return decision;
    }
    return null;
  }

  public markAnnounced(decision: ObjectDecision, now: number) {
    this.previousByAnnouncement.set(this.getAnnouncementKey(decision), {
      announcedAt: now,
      priority: decision.priority,
      direction: decision.direction,
      centerX: decision.normalizedCenterX,
      centerY: decision.normalizedCenterY,
    });
    this.presenceByClass.set(decision.className, { missingFrames: 0 });
    this.reappearedClasses.delete(decision.className);
    this.lastObjectAnnouncementAt = now;
  }

  private getAnnouncementKey(decision: ObjectDecision) {
    return `${decision.className}:${decision.direction}`;
  }
}
