import { AtlasOrchestrator } from "./orchestrator";
import { AutonomousWorkforce } from "./autonomous-workforce";
import { MissionRunner } from "./mission-runner";
import { createDurablePipelineDeps, createPipelineDeps, DurableLedger, type PipelineDeps } from "./atlas-pipeline";
import { InMemoryBusinessRepository } from "../services/scout/business-repository";
import { DurableBusinessRepository } from "../services/scout/durable-business-repository";
import { submitManualBusiness, type ManualBusinessInput } from "../services/scout/manual-entry";
import { OperationalLedger } from "../services/finance/ledger";
import { ProviderRegistry } from "../workforce/provider-registry";
import { OpenRouterProvider } from "../workforce/openrouter-provider";
import { defaultWorkforceConfig } from "../workforce/workforce-config";
import { WebsiteEvidenceCollector, type RequestFn, type ResolveFn } from "../services/evidence/website-collector";
import { PeerBenchmarkCollector } from "../services/evidence/peer-collector";
import type { EvidenceCollector } from "../services/evidence/acquisition";
import type { AtlasPersistence } from "../services/persistence/atlas-persistence";

/** Test-only assembly of the REAL Atlas stack. Only outbound HTTP (website fetch, peer directory, AI provider) is stubbed. */
export const PAGE_HTML = `<html><head><title>Joe's Café</title><meta name="description" content="Joe's coffee"></head><body>hello</body></html>`;
export const publicResolve: ResolveFn = async () => [{ address: "93.184.216.34", family: 4 }];
export const siteRequest = (html = PAGE_HTML): RequestFn => (async () => ({ status: 200, headers: { "content-type": "text/html" }, body: html, truncated: false })) as RequestFn;
export const peerProvider = (n = 8, withSite = 7) => ({ discover: async () => Array.from({ length: n }, (_, i) => ({ externalId: `peer-${i}`, name: `Peer ${i}`, source: "geoapify", website: i < withSite ? `https://p${i}.example` : undefined })) });
export const stubCollectors = (): EvidenceCollector[] => [
  new WebsiteEvidenceCollector({ resolve: publicResolve, request: siteRequest(), nowIso: () => "2026-10-02T00:00:00.000Z" }),
  new PeerBenchmarkCollector({ provider: peerProvider() as never, sourceUrl: "https://api.geoapify.com/v2/places", nowIso: () => "2026-10-02T00:00:00.000Z" }),
];

export interface AtlasHarnessOptions {
  executionEnabled: boolean;
  persistence?: AtlasPersistence;
  collectors?: EvidenceCollector[];
  sources?: string[];
  /** Mutable so a test can fail the AI call and then recover. */
  ai?: { fail: boolean; calls: number; failFirst?: number };
}

export async function buildAtlas(options: AtlasHarnessOptions) {
  const ai = options.ai ?? { fail: false, calls: 0 };
  const fakeAiFetch: typeof fetch = async () => {
    ai.calls++;
    if (ai.fail || ai.calls <= (ai.failFirst ?? 0)) return new Response("upstream error", { status: 500 });
    return new Response(JSON.stringify({ model: "stub-model", choices: [{ message: { content: "Stub internal summary of the audit." } }], usage: { prompt_tokens: 400, completion_tokens: 200 } }), { status: 200 });
  };
  const pipelineOptions = { allowedSources: options.sources, collectors: options.collectors };
  let deps: PipelineDeps;
  let ledger: OperationalLedger;
  let repository: InMemoryBusinessRepository;
  let hydrated: Record<string, number> = {};
  if (options.persistence) {
    const durable = await createDurablePipelineDeps(options.persistence, pipelineOptions);
    deps = durable.deps; ledger = durable.ledger; hydrated = durable.hydrated;
    const repo = new DurableBusinessRepository(options.persistence);
    await repo.hydrate();
    repository = repo;
  } else {
    deps = createPipelineDeps(pipelineOptions); ledger = new OperationalLedger(); repository = new InMemoryBusinessRepository();
  }
  const orchestrator = new AtlasOrchestrator(undefined, true, deps);
  const registry = new ProviderRegistry();
  registry.registerProvider(new OpenRouterProvider({ defaultModel: defaultWorkforceConfig.modelDefaults.openrouter, apiKey: "test-not-real", fetchImpl: fakeAiFetch, costPerThousandTokensUsd: 0.01 }));
  const workforce = new AutonomousWorkforce({ missionQueue: deps.missionQueue, providerRegistry: registry, workforceConfig: defaultWorkforceConfig, ledger, orchestrator });
  const runner = new MissionRunner({ workforce, missionQueue: deps.missionQueue, ledger, dispatcher: orchestrator, store: deps.store, executionEnabled: options.executionEnabled });
  deps.onMissionCreated = (task) => runner.autoExecute(task);
  const submit = (name: string, extra: Partial<ManualBusinessInput> = {}) =>
    submitManualBusiness({ businessName: name, category: "catering.cafe", address: "Accra, Ghana", latitude: "5.6037", longitude: "-0.1870", website: "https://joescafe.example", ...extra }, { repository, dispatch: (t, p) => orchestrator.dispatch(t, p) });
  const events = () => orchestrator.log.all().map((e) => `${e.event}:${e.outcome}`);
  return { deps, orchestrator, repository, ledger: ledger as DurableLedger, runner, submit, events, ai, hydrated };
}
