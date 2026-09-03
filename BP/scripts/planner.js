import { system } from "@minecraft/server";
import { locationKey } from "./utils.js";

let serial = 0;

function normalizedStep(step, index) {
  const source = step && typeof step === "object" ? step : {};
  return {
    id: `${index}:${source.type ?? "wait"}`,
    type: typeof source.type === "string" ? source.type : "wait",
    location: source.location ? { ...source.location } : undefined,
    target: source.target ? { ...source.target } : undefined,
    item: typeof source.item === "string" ? source.item : undefined,
    reason: typeof source.reason === "string" ? source.reason : "planned action",
    maxTicks: Number.isFinite(source.maxTicks) ? Math.max(1, Math.trunc(source.maxTicks)) : 80,
    startedTick: 0,
    retryAfterTick: 0,
    attempts: 0,
    completed: false,
    expectedY: Number.isFinite(source.expectedY) ? source.expectedY : undefined,
    expectedDistance: Number.isFinite(source.expectedDistance) ? source.expectedDistance : undefined,
    metadata: source.metadata && typeof source.metadata === "object" ? { ...source.metadata } : {}
  };
}

export function createActionPlan(brain, type, reason, steps, metadata = {}, ttl = 20 * 30) {
  if (!brain || !Array.isArray(steps) || steps.length === 0) return undefined;
  const plan = {
    id: `plan_${system.currentTick}_${serial++}`,
    type: String(type || "route"),
    reason: String(reason || "planned action"),
    createdTick: system.currentTick,
    expiresTick: system.currentTick + Math.max(20, Math.trunc(ttl)),
    cursor: 0,
    steps: steps.map(normalizedStep),
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
    ownerGoal: typeof metadata?.ownerGoal === "string" ? metadata.ownerGoal : String(brain.currentGoal ?? "idle"),
    successes: 0,
    failures: 0,
    status: "active",
    lastResult: "none"
  };
  brain.actionPlan = plan;
  brain.lastPlannedAction = `${plan.type}: ${plan.reason}`;
  return plan;
}

export function getActionPlan(brain) {
  const plan = brain?.actionPlan;
  if (!plan || plan.status !== "active") return undefined;
  if (system.currentTick >= plan.expiresTick) {
    plan.status = "expired";
    brain.lastFailedAction = `${plan.type} expired`;
    brain.failedPlanOutcome = {
      type: plan.type,
      reason: "plan expired",
      metadata: { ...plan.metadata },
      tick: system.currentTick
    };
    brain.mineTask = undefined;
    brain.pendingCombatStep = undefined;
    brain.actionPlan = undefined;
    return undefined;
  }
  return plan;
}

export function getCurrentStep(brain) {
  const plan = getActionPlan(brain);
  if (!plan) return undefined;
  const step = plan.steps[plan.cursor];
  if (!step) {
    plan.status = "completed";
    brain.lastSuccessfulAction = plan.type;
    brain.actionPlan = undefined;
    return undefined;
  }
  if (!step.startedTick) step.startedTick = system.currentTick;
  if (system.currentTick < (step.retryAfterTick ?? 0)) return step;
  if (system.currentTick - step.startedTick > step.maxTicks) {
    failActionStep(brain, `step ${step.type} timed out`);
    return undefined;
  }
  return step;
}

export function stepMatches(brain, type, location = undefined) {
  const step = getCurrentStep(brain);
  if (!step || step.type !== type) return false;
  if (!location || !step.location) return true;
  return locationKey(step.location) === locationKey(location);
}

export function advanceActionStep(brain, result = "completed") {
  const plan = getActionPlan(brain);
  if (!plan) return false;
  const step = plan.steps[plan.cursor];
  if (step) step.completed = true;
  plan.cursor++;
  plan.successes++;
  plan.lastResult = result;
  if (plan.cursor >= plan.steps.length) {
    plan.status = "completed";
    brain.lastSuccessfulAction = `${plan.type}: ${result}`;
    brain.lastPlanCompletedTick = system.currentTick;
    brain.completedPlanOutcome = {
      type: plan.type,
      result,
      metadata: { ...plan.metadata },
      tick: system.currentTick
    };
    brain.actionPlan = undefined;
  }
  return true;
}

export function retryActionStep(brain, reason = "retry", delayTicks = 0) {
  const plan = getActionPlan(brain);
  if (!plan) return false;
  const step = plan.steps[plan.cursor];
  if (!step) return false;
  step.attempts++;
  step.retryAfterTick = system.currentTick + Math.max(0, Math.trunc(Number(delayTicks) || 0));
  // Timeout starts again after the intentional retry delay, rather than
  // expiring while the engine is being given time to recover.
  step.startedTick = step.retryAfterTick;
  plan.lastResult = reason;
  if (step.attempts >= 2) return failActionStep(brain, `${reason}; repeated twice`);
  return true;
}

export function failActionStep(brain, reason = "failed") {
  const plan = getActionPlan(brain);
  if (!plan) return false;
  const step = plan.steps[plan.cursor];
  plan.failures++;
  plan.status = "failed";
  plan.lastResult = reason;
  brain.lastFailedAction = `${plan.type}/${step?.type ?? "unknown"}: ${reason}`;
  brain.lastPlanFailedTick = system.currentTick;
  brain.failedPlanOutcome = {
    type: plan.type,
    stepType: step?.type ?? "unknown",
    reason,
    metadata: { ...plan.metadata },
    tick: system.currentTick
  };
  brain.actionPlan = undefined;
  return true;
}

export function clearActionPlan(brain, reason = "cleared") {
  if (!brain?.actionPlan) return;
  brain.lastPlanClearedReason = reason;
  brain.actionPlan.status = "cleared";
  brain.actionPlan = undefined;
}

export function authorizeAction(brain, type, location = undefined) {
  const step = getCurrentStep(brain);
  if (!step || step.type !== type || system.currentTick < (step.retryAfterTick ?? 0)) return false;
  if (!location) return true;
  const expected = step.location ?? step.target;
  if (!expected) return false;
  return locationKey(expected) === locationKey(location);
}

export function authorizePlacement(brain, location, purpose) {
  const step = getCurrentStep(brain);
  if (!step || step.type !== "place" || !step.location || system.currentTick < (step.retryAfterTick ?? 0)) return false;
  if (locationKey(step.location) !== locationKey(location)) return false;
  if (purpose && step.metadata?.purpose && purpose !== step.metadata.purpose) return false;
  return true;
}

export function authorizeBreak(brain, location) {
  const step = getCurrentStep(brain);
  if (!step || step.type !== "break" || !step.location || system.currentTick < (step.retryAfterTick ?? 0)) return false;
  return locationKey(step.location) === locationKey(location);
}

export function planSummary(brain) {
  const plan = getActionPlan(brain);
  if (!plan) return "none";
  const step = plan.steps[plan.cursor];
  return `${plan.type} ${plan.cursor + 1}/${plan.steps.length}: ${step?.type ?? "done"}`;
}
