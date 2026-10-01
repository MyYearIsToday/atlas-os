import type { BusinessDiscoveryProvider } from "../evidence/provider-interfaces";
import { OverpassDiscoveryProvider } from "./overpass-discovery-provider";
import { TestBusinessDiscoveryProvider } from "./test-discovery-provider";

/** The live provider is selected only by explicit environment opt-in. */
export function createScoutDiscoveryProvider(): BusinessDiscoveryProvider {
  return process.env.SCOUT_DISCOVERY_SOURCE === "overpass"
    ? new OverpassDiscoveryProvider()
    : new TestBusinessDiscoveryProvider();
}