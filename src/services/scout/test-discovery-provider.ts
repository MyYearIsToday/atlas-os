import type { BusinessDiscoveryProvider, DiscoveryCandidate, DiscoveryQuery } from "../evidence/provider-interfaces";

/** Deterministic, in-memory provider for tests; it is not an external source. */
export class TestBusinessDiscoveryProvider implements BusinessDiscoveryProvider {
  constructor(private candidates: DiscoveryCandidate[] = [], private shouldFail = false) {}

  setCandidates(candidates: DiscoveryCandidate[]): void {
    this.candidates = candidates;
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  async discover(_query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    if (this.shouldFail) throw new Error("test discovery source unavailable");
    return this.candidates;
  }
}