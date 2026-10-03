import { createHash } from "node:crypto";
import type { MissionQueueRepository, Task } from "../mission-queue";
import { LifecycleError, type ProspectService, type ScopeItem } from "./prospects";
import type { LifecycleStore } from "./lifecycle-store";

/**
 * Delivery lifecycle (Objective 6).
 *
 *  CUSTOMER_WON -> ONBOARDING -> DELIVERY_PLAN -> MISSIONS -> WORK_IN_PROGRESS -> INTERNAL_REVIEW
 *    -> CUSTOMER_DELIVERY -> RESULT_VERIFICATION -> COMPLETE
 *
 * Scope is copied from the ACCEPTED proposal and never changes or grows (no AI-invented scope). Delivery
 * missions are ordinary missions with missionType "delivery_work": not on the autonomous allowlist, so they
 * always need explicit human approval to run. Artifacts have their own lifecycle and every gate that moves
 * work toward the customer is a recorded human action. Atlas has no external delivery integration yet;
 * delivery and acceptance are recorded by humans.
 */
export type EngagementState = "CUSTOMER_WON" | "ONBOARDING" | "DELIVERY_PLAN" | "MISSIONS" | "WORK_IN_PROGRESS" | "INTERNAL_REVIEW" | "CUSTOMER_DELIVERY" | "RESULT_VERIFICATION" | "COMPLETE";
export type ArtifactState = "draft" | "internally_approved" | "customer_delivered" | "accepted" | "rejected";

export const ENGAGEMENT_TRANSITIONS: Record<EngagementState, EngagementState[]> = {
  CUSTOMER_WON: ["ONBOARDING"], ONBOARDING: ["DELIVERY_PLAN"], DELIVERY_PLAN: ["MISSIONS"], MISSIONS: ["WORK_IN_PROGRESS"],
  WORK_IN_PROGRESS: ["INTERNAL_REVIEW"], INTERNAL_REVIEW: ["CUSTOMER_DELIVERY", "WORK_IN_PROGRESS"],
  CUSTOMER_DELIVERY: ["RESULT_VERIFICATION", "WORK_IN_PROGRESS"], RESULT_VERIFICATION: ["COMPLETE", "WORK_IN_PROGRESS"], COMPLETE: [],
};
export const ARTIFACT_TRANSITIONS: Record<ArtifactState, ArtifactState[]> = {
  draft: ["internally_approved", "rejected"], internally_approved: ["customer_delivered"], customer_delivered: ["accepted", "rejected"], accepted: [], rejected: ["draft"],
};
export const DELIVERY_MISSION_TYPE = "delivery_work";

export interface PlanItem { planItemId: string; scopeItemId: string; title: string; missionId: string | null }
export interface ArtifactEvent { from: ArtifactState | null; to: ArtifactState; at: string; actor: string; reason: string }
export interface Artifact { artifactId: string; scopeItemId: string; title: string; producedBy: "ai" | "human"; contentRef: string; isEvidence: false; state: ArtifactState; history: ArtifactEvent[] }
export interface EngagementEvent { from: EngagementState | null; to: EngagementState; at: string; actor: string; reason: string }
export interface Engagement {
  engagementId: string; prospectId: string; businessId: string; state: EngagementState;
  scope: ScopeItem[]; scopeSource: string; proposalId: string; requirements: string[]; plan: PlanItem[]; artifacts: Artifact[];
  history: EngagementEvent[]; createdAt: string; updatedAt: string; completedAt: string | null;
}

const sha = (...p: unknown[]) => createHash("sha256").update(JSON.stringify(p)).digest("hex");
const isHuman = (actor: string) => /^human:.+/.test(actor);
const needHuman = (actor: string, what: string) => { if (!isHuman(actor)) throw new LifecycleError("human_required", `${what} must be recorded by a human actor (human:<id>)`); };

export class DeliveryService {
  constructor(private store: LifecycleStore, private prospects: ProspectService, private queue: MissionQueueRepository, private now: () => string = () => new Date().toISOString()) {}

  get(engagementId: string) {
    const e = this.store.engagements.get(engagementId);
    if (!e) throw new LifecycleError("not_found", `unknown engagement ${engagementId}`);
    return e;
  }
  private save(e: Engagement, patch: Partial<Engagement> = {}) { const next = { ...e, ...patch, updatedAt: this.now() }; this.store.engagements.set(e.engagementId, next); return next; }
  private setState(e: Engagement, to: EngagementState, actor: string, reason: string): Engagement {
    if (!ENGAGEMENT_TRANSITIONS[e.state].includes(to)) throw new LifecycleError("invalid_transition", `${e.state} -> ${to} is not allowed`);
    return this.save(e, { state: to, history: [...e.history, { from: e.state, to, at: this.now(), actor, reason }], ...(to === "COMPLETE" ? { completedAt: this.now() } : {}) });
  }
  private tasksFor(e: Engagement): Task[] {
    const ids = new Set(e.plan.map((p) => p.missionId).filter(Boolean));
    return this.queue.getSnapshot().filter((t) => ids.has(t.taskId));
  }
  private artifact(e: Engagement, artifactId: string) {
    const a = e.artifacts.find((x) => x.artifactId === artifactId);
    if (!a) throw new LifecycleError("not_found", `unknown artifact ${artifactId}`);
    return a;
  }
  private moveArtifact(e: Engagement, a: Artifact, to: ArtifactState, actor: string, reason: string): Engagement {
    if (!ARTIFACT_TRANSITIONS[a.state].includes(to)) throw new LifecycleError("invalid_artifact_transition", `artifact ${a.state} -> ${to} is not allowed`);
    const moved: Artifact = { ...a, state: to, history: [...a.history, { from: a.state, to, at: this.now(), actor, reason }] };
    return this.save(e, { artifacts: e.artifacts.map((x) => (x.artifactId === a.artifactId ? moved : x)) });
  }

  /** A won prospect with an accepted proposal becomes an engagement. The scope is copied verbatim and is then fixed. */
  startEngagement(prospectId: string, actor: string): Engagement {
    const engagementId = `engagement:${prospectId}`;
    const existing = this.store.engagements.get(engagementId);
    if (existing) return existing;
    const p = this.prospects.get(prospectId);
    if (p.state !== "WON" || !p.proposal?.acceptedBy) throw new LifecycleError("not_won", "an engagement requires a WON prospect with an accepted proposal");
    const at = this.now();
    const e: Engagement = {
      engagementId, prospectId, businessId: p.businessId, state: "CUSTOMER_WON", scope: p.proposal.scope.map((s) => ({ ...s })), scopeSource: p.proposal.scopeSource, proposalId: p.proposal.proposalId,
      requirements: [], plan: [], artifacts: [], history: [{ from: null, to: "CUSTOMER_WON", at, actor, reason: "proposal accepted" }], createdAt: at, updatedAt: at, completedAt: null,
    };
    this.store.engagements.set(engagementId, e);
    return e;
  }

  beginOnboarding(engagementId: string, actor: string) { const e = this.get(engagementId); return e.state === "ONBOARDING" ? e : this.setState(e, "ONBOARDING", actor, "onboarding started"); }

  /** Requirements come from the customer via a human. The plan is derived mechanically from the fixed scope: one item per scope item. */
  recordRequirements(engagementId: string, actor: string, requirements: string[]): Engagement {
    needHuman(actor, "customer requirements");
    const e = this.get(engagementId);
    if (e.state !== "ONBOARDING") { if (e.requirements.length) return e; throw new LifecycleError("invalid_transition", `requirements are recorded during ONBOARDING (state is ${e.state})`); }
    const cleaned = requirements.map((r) => r.trim()).filter(Boolean);
    if (!cleaned.length) throw new LifecycleError("requirements_required", "at least one customer requirement is needed before planning");
    const plan: PlanItem[] = e.scope.map((s) => ({ planItemId: `plan:${e.engagementId}:${s.scopeItemId}`, scopeItemId: s.scopeItemId, title: s.title, missionId: null }));
    return this.setState(this.save(e, { requirements: cleaned, plan }), "DELIVERY_PLAN", actor, "requirements recorded; plan derived from accepted scope");
  }

  /** One approval-required mission per plan item. Re-running never creates a second mission for an item. */
  async createDeliveryMissions(engagementId: string): Promise<Engagement> {
    let e = this.get(engagementId);
    if (e.state !== "DELIVERY_PLAN") { if (e.state !== "ONBOARDING" && e.state !== "CUSTOMER_WON") return e; throw new LifecycleError("invalid_transition", `missions are created from DELIVERY_PLAN (state is ${e.state})`); }
    const plan: PlanItem[] = [];
    for (const item of e.plan) {
      const scope = e.scope.find((s) => s.scopeItemId === item.scopeItemId)!;
      const existing = item.missionId && this.queue.getSnapshot().find((t) => t.taskId === item.missionId);
      if (existing) { plan.push(item); continue; }
      const task = await this.queue.create({
        title: `Deliver: ${item.title}`, description: `${scope.description}\nCustomer requirements: ${e.requirements.join("; ")}`, assignedAI: "builder", clientId: e.businessId, priority: "Medium",
        approvalRequired: "Approval Required", dueDate: this.now().slice(0, 10), estimatedCost: 0, estimatedTime: "unspecified", missionType: DELIVERY_MISSION_TYPE,
      });
      plan.push({ ...item, missionId: task.taskId });
    }
    return this.setState(this.save(e, { plan }), "MISSIONS", "system:atlas", "delivery missions created (each requires human approval to run)");
  }

  markWorkStarted(engagementId: string, actor: string): Engagement {
    const e = this.get(engagementId);
    if (e.state === "WORK_IN_PROGRESS") return e;
    const tasks = this.tasksFor(e);
    if (e.state !== "MISSIONS") throw new LifecycleError("invalid_transition", `work starts from MISSIONS (state is ${e.state})`);
    if (tasks.length !== e.plan.length || !tasks.some((t) => t.status !== "Pending")) throw new LifecycleError("work_not_started", "no delivery mission has started yet");
    return this.setState(e, "WORK_IN_PROGRESS", actor, "delivery work has started");
  }

  addArtifact(engagementId: string, input: { scopeItemId: string; title: string; producedBy: "ai" | "human"; contentRef: string }, actor: string): Engagement {
    const e = this.get(engagementId);
    if (e.state !== "WORK_IN_PROGRESS") throw new LifecycleError("invalid_state", `artifacts are added during WORK_IN_PROGRESS (state is ${e.state})`);
    if (!e.scope.some((s) => s.scopeItemId === input.scopeItemId)) throw new LifecycleError("out_of_scope", `scope item ${input.scopeItemId} is not part of the accepted proposal`);
    if (!input.title.trim() || !input.contentRef.trim()) throw new LifecycleError("invalid_artifact", "title and contentRef are required");
    const artifactId = `artifact:${sha(e.engagementId, input.scopeItemId, input.title, input.contentRef)}`;
    if (e.artifacts.some((a) => a.artifactId === artifactId)) return e;
    const artifact: Artifact = { artifactId, scopeItemId: input.scopeItemId, title: input.title, producedBy: input.producedBy, contentRef: input.contentRef, isEvidence: false, state: "draft", history: [{ from: null, to: "draft", at: this.now(), actor, reason: "artifact created" }] };
    return this.save(e, { artifacts: [...e.artifacts, artifact] });
  }

  reworkArtifact(engagementId: string, artifactId: string, actor: string): Engagement {
    const e = this.get(engagementId);
    if (e.state !== "WORK_IN_PROGRESS") throw new LifecycleError("invalid_state", `rework happens during WORK_IN_PROGRESS (state is ${e.state})`);
    return this.moveArtifact(e, this.artifact(e, artifactId), "draft", actor, "reworked after rejection");
  }

  submitForInternalReview(engagementId: string, actor: string): Engagement {
    const e = this.get(engagementId);
    if (e.state === "INTERNAL_REVIEW") return e;
    const tasks = this.tasksFor(e);
    if (tasks.length !== e.plan.length || tasks.some((t) => t.status !== "Completed")) throw new LifecycleError("missions_incomplete", "every delivery mission must be Completed before internal review");
    if (e.artifacts.some((a) => a.state === "rejected")) throw new LifecycleError("rejected_artifacts", "rework or replace rejected artifacts first");
    for (const s of e.scope) if (!e.artifacts.some((a) => a.scopeItemId === s.scopeItemId)) throw new LifecycleError("scope_uncovered", `scope item "${s.title}" has no artifact`);
    return this.setState(e, "INTERNAL_REVIEW", actor, "submitted for internal review");
  }

  approveArtifactInternally(engagementId: string, artifactId: string, actor: string): Engagement {
    needHuman(actor, "internal approval");
    let e = this.get(engagementId);
    if (e.state !== "INTERNAL_REVIEW") throw new LifecycleError("invalid_state", `internal approval happens in INTERNAL_REVIEW (state is ${e.state})`);
    e = this.moveArtifact(e, this.artifact(e, artifactId), "internally_approved", actor, "approved internally");
    return e.artifacts.some((a) => a.state === "draft") ? e : this.setState(e, "CUSTOMER_DELIVERY", actor, "all artifacts internally approved");
  }

  rejectArtifactInternally(engagementId: string, artifactId: string, actor: string, reason: string): Engagement {
    needHuman(actor, "internal rejection");
    let e = this.get(engagementId);
    if (e.state !== "INTERNAL_REVIEW") throw new LifecycleError("invalid_state", `internal review happens in INTERNAL_REVIEW (state is ${e.state})`);
    e = this.moveArtifact(e, this.artifact(e, artifactId), "rejected", actor, reason);
    return this.setState(e, "WORK_IN_PROGRESS", actor, "returned to work after internal rejection");
  }

  /** Delivery to the customer is an external action. No integration exists, so a human records that it happened. */
  recordDelivery(engagementId: string, artifactId: string, actor: string, note: string): Engagement {
    needHuman(actor, "customer delivery");
    let e = this.get(engagementId);
    if (e.state !== "CUSTOMER_DELIVERY") throw new LifecycleError("invalid_state", `delivery is recorded in CUSTOMER_DELIVERY (state is ${e.state})`);
    if (!note.trim()) throw new LifecycleError("note_required", "describe how the artifact was delivered");
    e = this.moveArtifact(e, this.artifact(e, artifactId), "customer_delivered", actor, note);
    return e.artifacts.some((a) => a.state === "internally_approved") ? e : this.setState(e, "RESULT_VERIFICATION", actor, "all artifacts delivered to the customer");
  }

  recordCustomerDecision(engagementId: string, artifactId: string, actor: string, accepted: boolean, reference: string): Engagement {
    needHuman(actor, "the customer's decision");
    let e = this.get(engagementId);
    if (e.state !== "RESULT_VERIFICATION") throw new LifecycleError("invalid_state", `decisions are recorded in RESULT_VERIFICATION (state is ${e.state})`);
    if (!reference.trim()) throw new LifecycleError("reference_required", "cite the customer's acceptance or rejection");
    e = this.moveArtifact(e, this.artifact(e, artifactId), accepted ? "accepted" : "rejected", actor, reference);
    if (!accepted) return this.setState(e, "WORK_IN_PROGRESS", actor, "customer rejected an artifact; rework required");
    return e.artifacts.every((a) => a.state === "accepted") ? this.setState(e, "COMPLETE", actor, "customer accepted every artifact") : e;
  }
}
