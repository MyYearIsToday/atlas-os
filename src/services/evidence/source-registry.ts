export interface SourceDefinition {
  id: string; name: string; sourceType: string; baseUrl?: string; licenseTermsNote: string;
  reliability: "high" | "medium" | "low"; permittedUse: string; rateLimit?: string;
  attributionRequirement?: string; enabled: boolean; lastChecked?: string;
}
export const defaultSources: SourceDefinition[] = [
  { id:"osm", name:"OpenStreetMap", sourceType:"osm", baseUrl:"https://www.openstreetmap.org", licenseTermsNote:"ODbL", reliability:"medium", permittedUse:"Open-data discovery with attribution and license compliance", attributionRequirement:"© OpenStreetMap contributors", enabled:true },
  { id:"nominatim", name:"Nominatim", sourceType:"geocoder", baseUrl:"https://nominatim.openstreetmap.org", licenseTermsNote:"OSMF usage policy", reliability:"medium", permittedUse:"Low-volume cached geocoding", rateLimit:"Maximum 1 request/second on public service", enabled:true },
  { id:"overpass", name:"Overpass", sourceType:"osm_query", baseUrl:"https://overpass-api.de", licenseTermsNote:"Public instance usage policy", reliability:"medium", permittedUse:"Cached, low-volume OSM querying", rateLimit:"Respect instance limits; avoid parallel requests", enabled:true },
  { id:"official_website", name:"Official business websites", sourceType:"official_website", licenseTermsNote:"Site terms and robots policy", reliability:"high", permittedUse:"Conservative observation of public pages", enabled:true },
  { id:"directory", name:"Legitimate public directories", sourceType:"directory", licenseTermsNote:"Each directory's own terms of use", reliability:"medium", permittedUse:"Public business listing cross-reference", enabled:true },
  { id:"manual_observation", name:"Human observation", sourceType:"manual_observation", licenseTermsNote:"Internal process and applicable law", reliability:"high", permittedUse:"Human-recorded public or owner-provided evidence", enabled:true }
];
