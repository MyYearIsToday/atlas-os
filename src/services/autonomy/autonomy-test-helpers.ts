import { createInMemoryMissionQueue } from "../mission-queue";
import { DurableLedger } from "../../orchestrator/atlas-pipeline";
import type { AtlasPersistence } from "../persistence/atlas-persistence";
import { LifecycleStore } from "./lifecycle-store";
import { ProspectService, type OutreachSender, type ScopeItem } from "./prospects";
import { DeliveryService } from "./delivery";
import { RevenueService } from "./revenue";
import { ApprovalService, type ApprovalDeps } from "./approvals";

/** Test-only assembly of the REAL autonomy services (no mocks of Atlas's own logic). */
export const T0 = "2026-10-10T00:00:00.000Z";
export const scope: ScopeItem[] = [{ scopeItemId: "s1", title: "Google profile cleanup", description: "Fix listing details" }, { scopeItemId: "s2", title: "Website fixes", description: "Add meta tags" }];
export const draft = { subject: "Improving your Google listing", body: "Hello, we noticed...", generatedBy: "ai:test-model" };
export const okSender = (): OutreachSender & { calls: string[] } => { const calls: string[] = []; return Object.assign({ send: async (m: { idempotencyKey: string }) => { calls.push(m.idempotencyKey); return { status: "SENT" as const, providerMessageId: "m1" }; } }, { calls }); };

export function makeClock(startIso = T0) {
  let ms = Date.parse(startIso), ticks = 0;
  const clock = { now: () => new Date(ms + ++ticks).toISOString(), set: (iso: string) => { ms = Date.parse(iso); ticks = 0; }, advance: (delta: number) => { ms += delta; } };
  return clock;
}

export async function makeWorld(options: { persistence?: AtlasPersistence; resolveContact?: (id: string) => any } = {}) {
  const clock = makeClock();
  const store = new LifecycleStore(options.persistence);
  const queue = createInMemoryMissionQueue();
  const ledger = new DurableLedger(options.persistence);
  const prospects = new ProspectService(store, clock.now, options.resolveContact ?? (() => null));
  const delivery = new DeliveryService(store, prospects, queue, clock.now);
  const revenue = new RevenueService(store, prospects, ledger, clock.now);
  const missionOutputs = new Map<string, { generatedBy: string; text: string; isEvidence: false }>();
  const runs: string[] = [];
  const approvalDeps: ApprovalDeps = {
    lifecycle: store, prospects, delivery, revenue, missionQueue: queue, missionOutputs, now: clock.now, sender: undefined,
    runMission: async (taskId) => { runs.push(taskId); await queue.update(taskId, { status: "Completed", completedAt: clock.now() }); return { executed: true, outcome: "COMPLETED" }; },
  };
  return { clock, store, queue, ledger, prospects, delivery, revenue, missionOutputs, runs, approvalDeps, approvals: new ApprovalService(approvalDeps) };
}
export type World = Awaited<ReturnType<typeof makeWorld>>;

/** Drives one prospect through acquisition and delivery to a COMPLETE engagement (every human gate recorded). */
export async function completeEngagement(w: World, businessId: string, priceUsd: number | null) {
  const pid = w.prospects.create(businessId, "system:atlas", "qualified").prospectId;
  w.prospects.prepareOutreach(pid, draft, "system:atlas");
  w.prospects.approveOutreach(pid, "human:ama", { channel: "email", address: "owner@example.com" });
  await w.prospects.sendApproved(pid, okSender());
  w.prospects.recordResponse(pid, "ENGAGED", "human:ama", "replied");
  w.prospects.prepareProposal(pid, { scope, scopeSource: "customer_requirements", summary: "two fixes", priceUsd }, "human:ama");
  w.prospects.submitProposalForApproval(pid, "human:ama");
  w.prospects.recordProposalDecision(pid, "human:ama", true, "signed proposal");
  const eid = w.delivery.startEngagement(pid, "system:atlas").engagementId;
  w.delivery.beginOnboarding(eid, "system:atlas");
  w.delivery.recordRequirements(eid, "human:ama", ["fix hours"]);
  await w.delivery.createDeliveryMissions(eid);
  const tasks = w.queue.getSnapshot();
  await w.queue.update(tasks[0].taskId, { status: "In Progress" });
  w.delivery.markWorkStarted(eid, "human:ama");
  for (const t of tasks) await w.queue.update(t.taskId, { status: "Completed" });
  for (const s of scope) w.delivery.addArtifact(eid, { scopeItemId: s.scopeItemId, title: `Artifact ${s.scopeItemId}`, producedBy: "ai", contentRef: `doc:${s.scopeItemId}` }, "ai:model");
  w.delivery.submitForInternalReview(eid, "human:ama");
  for (const a of w.delivery.get(eid).artifacts) w.delivery.approveArtifactInternally(eid, a.artifactId, "human:ama");
  for (const a of w.delivery.get(eid).artifacts) w.delivery.recordDelivery(eid, a.artifactId, "human:ama", "emailed");
  for (const a of w.delivery.get(eid).artifacts) w.delivery.recordCustomerDecision(eid, a.artifactId, "human:ama", true, "customer email: approved");
  return { pid, eid };
}
