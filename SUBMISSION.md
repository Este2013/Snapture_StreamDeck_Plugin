# Submitting to the Elgato Maker Console

The packaged plugin is produced at `dist/com.este.snapture.streamDeckPlugin`.

## Build & package

```powershell
npm install            # first time
npm run build          # bundle src/ -> com.este.snapture.sdPlugin/bin/plugin.js
streamdeck validate com.este.snapture.sdPlugin
streamdeck pack com.este.snapture.sdPlugin --output dist --force
```

## Before you submit — confirm the UUID prefix ⚠️

Elgato ties every plugin UUID to **your registered maker prefix**. This plugin
uses **`com.este`** (`com.este.snapture`, `com.este.snapture.record`, …). If your
Maker account's registered prefix is different, everything must be renamed:
the `.sdPlugin` folder, `manifest.json` UUID + each action UUID, the rollup output
path, and the `@action` decorators in `src/plugin.ts`. Tell me your prefix and I
can do the rename in one pass.

## Manifest status (validated ✓)

| Field | Value |
| --- | --- |
| Name | Snapture |
| UUID | com.este.snapture |
| Version | 1.0.0.0 |
| Category | Snapture |
| SDKVersion | 2 · Software min 6.5 · Windows 10+ · Node 20 |
| Actions | Snapshot, Snapture, Open last snap (each with icon + property inspector) |

`Nodejs.Debug` has been removed for the shipping build.

## Listing assets to prepare (uploaded on the web console, not in the package)

- **Store icon** — `marketing/store-icon.png` (512×512) is provided; the console
  typically wants a 288×288+ PNG.
- **Screenshots** — capture the three actions and their Property Inspectors
  (and ideally the Snapture app overlay) for the gallery.
- **Description & category** — write the marketplace copy; note the dependency:
  *requires the free Snapture app (v1.1.0+) running* — link
  https://github.com/Este2013/Snapture.

## Steps

1. Sign in to the Elgato **Maker Console** (https://marketplace.elgato.com/maker).
2. Register/confirm your maker prefix (see the ⚠️ above).
3. Create a new **Stream Deck plugin** product.
4. Upload `dist/com.este.snapture.streamDeckPlugin`.
5. Fill in the listing (icon, screenshots, description, category, support URL).
6. Submit for review.

## Test locally first

```powershell
streamdeck link com.este.snapture.sdPlugin
streamdeck restart com.este.snapture
```
Confirm each action works with the Snapture app running.
