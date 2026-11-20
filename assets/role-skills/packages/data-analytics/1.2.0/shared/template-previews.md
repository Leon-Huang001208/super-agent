# Template thumbnails and format icons

Read this only when preparing a user-requested picker with real, relevant candidates shortlisted through [templates and prior work](templates-and-prior-work.md#templates-and-prior-work). A preview improves recognition; it does not establish relevance, source access, or permission to edit. Missing previews must not delay the picker. The form server does not discover, fetch, or authenticate images.

Use a distinct action heading and collection label, such as **Choose a report template** and **Recent reports from Sites and Pages**. Resource descriptions are hidden; put the format and distinguishing details in the concise title. The same title appears below the card and on thumbnail hover, with no separate hover-label parameter.

## Choose a preview

Reuse current-task discovery metadata, known IDs, images, and prepared icons first.

- **Provider images:** Use a returned reusable HTTPS image URL, not a document-view URL. An inline tool image without a reusable URI cannot be passed as `thumbnail.src`.
- **Sites:** Use the fresh `screenshot_url` from `get_site`, `list_sites`, or `search_sites`. On reopen, refresh an expired URL or one expiring within five minutes, within the read budget below; otherwise omit it. Browser caching is not proof the URL still works. Preserve returned image-delivery URLs and signatures; do not construct screenshot endpoints or persist expiring URLs as durable template metadata.
- **Retained previews:** Resolve `preview` relative to the actual `artifact-template.json` and encode a supported existing raster image in code. A source deck or document is not an image.
- **Pages without a usable image:** Read [local preview rendering](#local-rendering-fallback) only for this fallback. Render the real title and retrieved opening content or search excerpt using the existing helper/runtime. With no excerpt, retain the title and authentic icon.
- **Slides without a usable image:** Read [Slides thumbnails](#google-slides-thumbnails) only when a verified presentation needs a thumbnail and the remaining read budget permits it.

## Bound optional retrieval

Use at most **two lightweight provider reads total across the whole form**, through already available, authorized tools. Prioritize expiring images and the highest-ranked candidate missing a preview. A Page-content read also counts. Reuse known IDs and run independent reads in parallel. After a slow, failed, or unhelpful response, stop optional retrieval and use available metadata or icons.

Do not add retries, enumeration, new-provider searches, full-artifact rendering/exports, dependency installation, guessed endpoints, or unsupported timeout parameters. Local cached Page rendering and authentic-icon rasterization need no provider reads. Preserve the exact resource identity and known format when falling back; do not claim a screenshot loaded when it did not.

## Google Slides thumbnails

Use this fallback only for a verified, shortlisted presentation without a reusable image. All calls share the two-read budget across the whole form.

Reuse the actual presentation ID and known first-slide object ID. If the slide ID is missing, **one compact `get_presentation_outline` read plus one `get_slide_thumbnail` read consumes the entire budget**. Take the first real slide's `objectId` from the returned order; never guess an ID. Request **MEDIUM** through the thumbnail tool's live schema and use its returned reusable `contentUrl`. With known IDs, at most two independent thumbnail reads fit the same budget.

Normalized Drive metadata may omit `thumbnailLink` and `iconLink`; this does not prove Slides lacks a thumbnail. Use the path above if it fits the remaining budget, without an additional `get_file_metadata` call for thumbnail fields. Do not fetch a full deck or try another slide for a preview. Stop optional retrieval after a slow or unsuccessful response and retain the available preview or authentic icon.

## Supply authentic icons

Use provider-returned icons or verified assets from the currently installed authoring skill/plugin. Resolve directories from available skill metadata; do not hard-code cache versions.

| Format | Asset relative to the authoring skill |
| --- | --- |
| Document | `assets/file-document.png` in documents |
| Presentation | `assets/file-presentation.png` in presentations |
| Spreadsheet | `assets/file-spreadsheet.png` in spreadsheets |

For Pages, use the native blue Page resource icon: the preview helper includes it in `icons`, or rasterize the bundled Page glyph (optional unbundled reference: `../assets/page-resource-icon.svg`; load its workflow only if separately available) with `--icon` when only an icon is needed. For Sites, use the installed plugin manifest's `interface.composerIcon`/`logo` asset. Prefer a returned HTTPS icon or existing raster; read [local preview rendering](#local-rendering-fallback) only if an official SVG needs rasterization. Reuse the prepared image in `icons`, including when no thumbnail exists. Omit unavailable icons rather than inventing a logo.

## Image contract

Images use `{src, mimeType?}`: HTTPS or base64 PNG/JPEG/GIF/WebP/AVIF, not SVG data URIs or `file://` URLs. Respect the image URL contract (optional unbundled reference: `../mcp/forms/API.md#thumbnail-sources-and-image-validation`; load its workflow only if separately available). Relative or authenticated-only endpoints need an existing authorized image-read capability; do not invent URLs or copy credentials.

Each `src` is capped at **262,144 characters**, including its data-URI prefix; the whole serialized form is capped at **1 MiB** under the adapter's string-length check. Assemble local image bytes and tool arguments in code without printing image bytes into model context. Check the whole-form length and omit lowest-priority optional images if needed. A smaller supported provider thumbnail can be chosen initially; do not retry rejected images with guessed URLs or promise permanent thumbnails from expiring URLs.

## Local rendering fallback

Use only for a shortlisted Page without a usable provider/retained image or an authentic SVG icon needing rasterization. The form-wide two-read budget and image contract above still apply.

Use an existing Node/Playwright runtime and installed Chromium, resolved from the host's dependency metadata. Do not install dependencies or a browser for a picker. If this runtime is unavailable, retain provider images or supported icons.

### Page content

Use the preview helper (optional unbundled reference: `../scripts/prepare-resource-preview.mjs`; load its workflow only if separately available) with the real title and retrieved opening Markdown; otherwise use the search `preview` excerpt. Prefer content already available from discovery. A read for missing content counts against the form-wide budget; never read every candidate in full for previews. With no excerpt, keep the title and authentic icon without rendering a placeholder.

The helper produces a 16:9 white document preview with readable type, the actual Page title as a document heading, and retrieved paragraphs, headings, lists, or a compact table. There is no duplicate header bar or reserved hover/footer band: content fills the height and crops naturally beneath the host's hover label. Preserve content hierarchy; do not invent charts or decorative cover art. It escapes raw HTML and loads no remote images, fonts, or scripts. This is a rendered content preview, not a screenshot of the native Page.

Write inputs and the private cache in the approved task workspace, outside the plugin:

```sh
"<node>" "<data-plugin-root>/scripts/prepare-resource-preview.mjs" \
  --input "<page-metadata.json>" --cache-dir "<task-workspace>/resource-previews" \
  --browser-package-json "<existing-runtime>/package.json" \
  --browser-executable "<installed-chromium>"
```

Input is one object or an array of `{uri, title, markdown?, preview?, revision?, updated_at?}` from retrieved resources. The result names a JSON file containing each `uri`, `thumbnail`, `icons`, and preview provenance. Pass both image fields to the resource: the blue Page icon belongs in `icons` for the host's hover label, not inside the thumbnail. Read results in code without printing image bytes into model context. The helper enforces the per-image limit. Cached images are keyed by identity, revision/update time, content, and renderer version; reuse them only within the same authorized task/account and remove them with task artifacts.

### Official SVG icons

Use the same command with `--icon "<verified-asset.svg>"` instead of `--input`. It renders unchanged artwork to a transparent PNG and returns an `icon` in the result file. Read the result in code and reuse it across candidates in `icons`, not `thumbnail`.

Existing local raster icons need no rendering: encode their bytes as `icons: [{src: "data:image/png;base64,…", mimeType: "image/png"}]`, using the actual MIME type. Omit the icon if neither a supported image nor the existing renderer is available.
