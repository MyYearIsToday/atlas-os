# Atlas multimodal intelligence

## Current scope

`ATLAS_MULTIMODAL_ENABLED=true` opts the existing Atlas website collector into fetching at most three relevant images referenced by a business's public HTML page. It accepts JPEG, PNG, and WebP only, with a 128 KiB per-image limit. Image URLs go through the same HTTP(S)-only, public-DNS, pinned-address, redirect, timeout, and response-size checks as the page fetch. Unsupported, blocked, oversized, or unavailable media is skipped.

The image bytes are transient. They are sent to the existing `workforce` AIProvider as an image message, so existing workforce media routing, model capability checks, provider executor, and server-side credentials remain in control. No second provider, model registry, or executor is introduced. The feature flag does not enable mission execution or the autonomy scheduler.

## Observation and evidence boundary

Structured model output is stored in the separate `multimodal_observations` collection and exposed as Visual Intelligence in the audit and Command Center. Each result has a source reference, confidence, timestamp, and explicit `UNVERIFIED` status. It is not an `EvidenceRecord`, does not change evidence coverage, and is not passed to the opportunity scorer. The audit labels these as model observations; verification still requires the existing evidence and review rules.

## Not available in this Atlas path

The Atlas acquisition-to-analysis path currently handles selected website images only. It does not collect public social-media creatives, crawl image directories, inspect PDFs/documents, or ingest video. Although the workforce router and model declarations contain audio/video modality labels, this repository's provider-boundary tests do not establish end-to-end video or audio/transcript support. Atlas therefore rejects those media types rather than claiming they were analyzed.

Enable the feature only in a deployment that already runs the Atlas pipeline and has the existing workforce configured. Its current startup wiring is under the existing Scout scheduler; this change does not alter Scout, its discovery source or interval, Geoapify, or the autonomy scheduler.
