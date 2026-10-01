import type { BusinessDiscoveryProvider } from "../evidence/provider-interfaces";
import { GeoapifyDiscoveryProvider } from "./geoapify-discovery-provider";
import { OverpassDiscoveryProvider } from "./overpass-discovery-provider";
import { TestBusinessDiscoveryProvider } from "./test-discovery-provider";

/** A live provider is selected only by explicit environment opt-in. */
export function createScoutDiscoveryProvider(): BusinessDiscoveryProvider {
  switch (process.env.SCOUT_DISCOVERY_SOURCE) {
    case "overpass":
      return new OverpassDiscoveryProvider();
    case "geoapify":
      return new GeoapifyDiscoveryProvider();
    default:
      return new TestBusinessDiscoveryProvider();
  }
}
