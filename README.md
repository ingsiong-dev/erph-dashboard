# Data SMK Meradong — Portal Guru Data

Public web dashboard summarising teacher **eRPH** (daily lesson plan) submissions for
**SMK Meradong**, Sarawak.

- **Live link (no Google bar):** https://ingsiong-dev.github.io/erph-dashboard/
- **Direct Apps Script link:** https://script.google.com/macros/s/AKfycbxmx8KXaam55fnjnEMCVr-p_kl9m-5fI64a3YrFphgzF1pEeNF50Pjn6THIY3_XIKan/exec

Both open the **same app**. The root `index.html` is a wrapper that embeds the Apps Script
URL in an iframe — Google only draws its "This application was created by a Google Apps
Script user" bar in the top-level window, so framing removes it.

Because the wrapper is only a frame, **pushing to GitHub cannot change what teachers see**.
A visible change always needs a `clasp` deploy (below).

## This app has no admin and no login

Every visitor sees the same dashboard. There is no PIN, no role check and no access gate.
That is deliberate and is enforced in code:

- `apps-script/Code.js` — `doGet()` renders the dashboard unconditionally.
- There is **exactly one** `include()` definition. An earlier version had two, and the
  second one called `Session.getActiveUser()` to label the owner `-ADMIN`; because
  JavaScript keeps the *last* definition, it silently won and made the navbar label
  **empty for public visitors**. Do not add a second `include()` or `doGet()`.
- The dead `isUserAuthorized()` (DELIMA email allow-list) was removed from `DataService.js`.
- The unreachable "Access Denied" screen was removed from `Index.html`.

## Layout

```
index.html            GitHub Pages wrapper (this is what the live link serves)
apps-script/          the actual Apps Script project — open this folder to use clasp
  Code.js             doGet() + include() + the Kehadiran and Enrolmen backends
  DataService.js      data layer: reads the Responses + DELIMA sheets, 5-min cache
  Index.html          page shell
  Navbar/Sidebar/Dashboard/TeacherList/TeacherDetail/Analytics/Reports.html
  Kehadiran.html      attendance analysis (compact charts)
  Enrolmen.html       Laporan Enrolmen PDF downloads
  Styles.html, Javascript.html
  appsscript.json, .clasp.json
```

`index.html` at the root and `apps-script/Index.html` are different files in different
folders — keep it that way (Windows filenames are case-insensitive, so they cannot live
side by side in one folder).

## Updating

### Wrapper (the live link)

```powershell
cd "C:\Users\KOH ING SIONG\Desktop\erph-dashboard"
# edit index.html
git add -A
git commit -m "Update wrapper"
git push
```
GitHub Pages rebuilds in about a minute.

### Apps Script app

```powershell
cd "C:\Users\KOH ING SIONG\Desktop\erph-dashboard\apps-script"
clasp push
clasp create-version "description of change"
clasp update-deployment AKfycbxmx8KXaam55fnjnEMCVr-p_kl9m-5fI64a3YrFphgzF1pEeNF50Pjn6THIY3_XIKan -V <newVersion>
```

**Never** create a new deployment (no "New deployment" in the UI, no `clasp deploy` without
`--deploymentId`). That mints a new URL and breaks every link already shared. The deployment
above is the one in use; `@HEAD` is the dev URL and `@1 (erph)` is an old one — neither is
what people open.

Rollback is instant because versions are immutable: re-deploy the previous version number.

## Please note

- **The repo is public** (free GitHub Pages requires it) and the app is `ANYONE_ANONYMOUS`,
  so anyone with the link sees the dashboard — including teacher names and their
  submission/compliance status. This was already true before the repo existed; the repo
  just makes the URL easier to find.
- `apps-script/DataService.js` contains `SPREADSHEET_ID` (the eRPH data sheet). Publishing
  the ID does **not** grant access to the sheet, but it does advertise where the data lives.
  If that is a concern, move the ID into Script Properties and read it with
  `PropertiesService.getScriptProperties()`.
- The wrapper hides Google's "created by a Google Apps Script user" notice. That notice
  exists to protect users; this is the school's own app, but users should be told so.

## Modules

The dashboard is branded **DATA SMK MERADONG** (subtitle *Portal Guru Data*) and is
organised as five modules, because it has grown well beyond eRPH:

| Sidebar | Header | What it shows |
|---|---|---|
| eRPH | Rumusan eRPH | teacher eRPH submission compliance (the original dashboard) |
| Guru | Senarai Guru | per-teacher drill-down |
| Kehadiran | Analisis Kehadiran | attendance analysis from the *Graf kehadiran 2026* workbook |
| Enrolmen | Enrolmen Murid | downloads the monthly Laporan Enrolmen PDFs from Drive |
| Laporan | Laporan | CSV / Excel exports |

The navbar label is the **school code `YEE6301`** (previously the placeholder "Public Access").
The header title changes per module; before this it was hard-coded to one string and never
changed when you switched views.

## The Enrolmen module

Year + month dropdowns and a **Muat Turun Laporan** button. `getEnrolmenIndex()` lists the
Drive folder once (cached 5 min) to see which months exist, so a month appears automatically
as soon as its PDF is added — no code change each month. `getEnrolmenReport(year, month)`
returns the PDF as base64 so a visitor who is not signed into Google can still download it.

Only **2026** is offered; the 2014-2024 archive is ignored on purpose. Source of the files:
Drive folder `Enrolmen murid` (`1XNecX0c2PGhdnGCRFfFQQMc7LV9toSnK`), named
`Laporan Enrolmen <Bulan> <Tahun>.pdf`.

This module is **public** — anyone with the link can download any month's report (chosen
deliberately). It needs the `drive` OAuth scope, which the script did not use before.

## The Kehadiran module (attendance analysis)

Reads the workbook **Graf kehadiran 2026** (`1VcMqlsOGZbzHOza5Kf6svMtR-L12HHrJaRfYdZJECMI`).
Uses only `SpreadsheetApp`, so unlike the Enrolmen downloads it needs **no extra Google
permission**.

It reproduces the charts that exist in the workbook itself, rather than inventing new ones.
`Peratus Kehadiran Bulanan` is the headline and stays full size; everything else is drawn
small and compact in an auto-fitting grid:

| Chart | Source range |
|---|---|
| Peratus Kehadiran Bulanan (headline, full size) | `Keseluruhan!A1:B13` |
| Purata T1 – T5 | `Graf kehadiran!C17:D21` |
| Kehadiran Bulanan Tingkatan 5 | `Graf kehadiran!C55:D66` (yearly from `D68`) |
| Purata Tingkatan 1, 2, 3, 4, 5 (one chart each) | `Graf kehadiran!A23:D52`, grouped by form |

The workbook also has a `Kehadiran Keseluruhan` chart (`Graf kehadiran!C2:D14`), but it plots
the same monthly data as the headline chart, so it is deliberately not drawn twice.

### Layout it reads (verified against the live workbook)

| Sheet | Range | Unit |
|---|---|---|
| `Graf kehadiran` | `C3:D14` months + attendance | **fraction** (0.9725) |
| `Graf kehadiran` | `C17:D21` T1-T5 yearly averages | **percentage** (96.77) |
| `Graf kehadiran` | `A23:D52` per-class yearly averages | **percentage**, grouped by form |
| `Graf kehadiran` | `C55:D66` Tingkatan 5 monthly | **percentage** |
| `Keseluruhan` | `A17` label, `A18` value | **fraction** (0.96435) |

Three traps worth knowing:

1. **Mixed units.** The workbook stores the same measure as both fractions and percentages,
   so `asPct_()` normalises (`n <= 1.5 ? n * 100 : n`). Reading naively shows the yearly
   average as *0.96%*.
2. **The yearly value is in column A, directly below its label** (`A17` label, `A18` value) —
   not `B18`. `round2_()` also rounds half-up, because `0.96435` is stored as
   `96.43499999...` and plain `toFixed(2)` would print **96.43%** while the sheet shows
   **96.44%**.
3. **The class blocks are grouped by form.** The `A`/`B` pair holds Tingkatan 1 and 4; the
   `C`/`D` pair holds Tingkatan 2, 3 and 5. A `Tingkatan N` row opens a group and an
   unlabelled row is that block's total. Flattening them loses the form grouping the
   workbook's charts rely on.

In the per-class charts, a bar is **red when that class is below the school average**, which
is a real figure from the data rather than an invented threshold. The small charts start
their y-axis just below the lowest value instead of at 0 — attendance sits in a narrow
90–100% band, where a zero-based axis would flatten every bar into an identical block — so
the axis is labelled and each value is also shown on hover.

Exact figures are still available, in a collapsed **Jadual nilai penuh** table, so the
default view stays compact without losing any numbers.
