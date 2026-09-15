# Data SMK Meradong - Portal Guru Data

Public web dashboard summarising teacher **eRPH** (daily lesson plan) submissions for
**SMK Meradong**, Sarawak.

- **Live link (no Google bar):** https://ingsiong-dev.github.io/erph-dashboard/
- **Direct Apps Script link:** https://script.google.com/macros/s/AKfycbxmx8KXaam55fnjnEMCVr-p_kl9m-5fI64a3YrFphgzF1pEeNF50Pjn6THIY3_XIKan/exec

Both open the **same app**. The root `index.html` is a wrapper that embeds the Apps Script
URL in an iframe �?Google only draws its "This application was created by a Google Apps
Script user" bar in the top-level window, so framing removes it.

## This app has no admin and no login

Every visitor sees the same dashboard. There is no PIN, no role check and no access gate.
That is deliberate and is enforced in code:

- `apps-script/Code.js` �?`doGet()` renders the dashboard unconditionally.
- There is **exactly one** `include()` definition. An earlier version had two, and the
  second one called `Session.getActiveUser()` to label the owner `-ADMIN`; because
  JavaScript keeps the *last* definition, it silently won and made the navbar label
  **empty for public visitors**. Do not add a second `include()` or `doGet()`.
- The dead `isUserAuthorized()` (DELIMA email allow-list) was removed from `DataService.js`.
- The unreachable "Access Denied" screen was removed from `Index.html`.

## Layout

```
index.html            GitHub Pages wrapper (this is what the live link serves)
apps-script/          the actual Apps Script project �?open this folder to use clasp
  Code.js             doGet() + include()
  DataService.js      data layer: reads the Responses + DELIMA sheets, 5-min cache
  Index.html          page shell
  Navbar/Sidebar/Dashboard/TeacherList/TeacherDetail/Analytics/Reports.html
  Styles.html, Javascript.html
  appsscript.json, .clasp.json
```

`index.html` at the root and `apps-script/Index.html` are different files in different
folders �?keep it that way (Windows filenames are case-insensitive, so they cannot live
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
above is the one in use; `@HEAD` is the dev URL and `@1 (erph)` is an old one �?neither is
what people open.

Rollback is instant because versions are immutable: re-deploy the previous version number.

## Please note

- **The repo is public** (free GitHub Pages requires it) and the app is `ANYONE_ANONYMOUS`,
  so anyone with the link sees the dashboard �?including teacher names and their
  submission/compliance status. This was already true before the repo existed; the repo
  just makes the URL easier to find.
- `apps-script/DataService.js` contains `SPREADSHEET_ID` (the eRPH data sheet). Publishing
  the ID does **not** grant access to the sheet, but it does advertise where the data lives.
  If that is a concern, move the ID into Script Properties and read it with
  `PropertiesService.getScriptProperties()`.
- The wrapper hides Google's "created by a Google Apps Script user" notice. That notice
  exists to protect users; this is the school's own app, but users should be told so.

## Update 15 Sep 2026 - rename + new Kehadiran module

The dashboard is now branded **DATA SMK MERADONG** (subtitle *Portal Guru Data*) and is
organised as three modules, because it is growing beyond eRPH:

| Sidebar | Header | What it shows |
|---|---|---|
| eRPH | Rumusan eRPH | teacher eRPH submission compliance (the original dashboard) |
| Guru | Senarai Guru | per-teacher drill-down |
| Kehadiran | Analisis Kehadiran | **new** - attendance analysis from the *Graf kehadiran 2026* workbook |
| Enrolmen | Enrolmen Murid | downloads the monthly Laporan Enrolmen PDFs from Drive |
| Laporan | Laporan | CSV / Excel exports |

The navbar label is the **school code `YEE6301`** (previously the placeholder "Public Access").
The header title now changes per module; before this it was hard-coded to one string and
never changed when you switched views.

### The Kehadiran module

Year + month dropdowns and a **Muat Turun Laporan** button. `getEnrolmenIndex()` lists the
Drive folder once (cached 5 min) to see which months exist, so a month appears automatically
as soon as its PDF is added - no code change each month. `getEnrolmenReport(year, month)`
returns the PDF as base64 so a visitor who is not signed into Google can still download it.

Only **2026** is offered; the 2014-2024 archive is ignored on purpose. Source of the files:
Drive folder `Enrolmen murid` (`1XNecX0c2PGhdnGCRFfFQQMc7LV9toSnK`), named
`Laporan Enrolmen <Bulan> <Tahun>.pdf`.

This module is **public** - anyone with the link can download any month's report (chosen
deliberately). It needs the `drive` OAuth scope, which the script did not use before.
### The Kehadiran module (attendance analysis)

Reads the workbook **Graf kehadiran 2026** (`1VcMqlsOGZbzHOza5Kf6svMtR-L12HHrJaRfYdZJECMI`) and
shows: yearly average, latest month + month-on-month change, months reported, a monthly bar
chart, per-form averages (T1-T5) and per-class averages. Uses only `SpreadsheetApp`, so unlike
the Enrolmen downloads it needs **no extra Google permission**.

Layout it reads (verified against the live workbook):

| Sheet | Range | Unit |
|---|---|---|
| `Graf kehadiran` | `C3:D14` months + attendance | **fraction** (0.9725) |
| `Graf kehadiran` | `C17:D21` T1-T5 yearly averages | **percentage** (96.77) |
| `Graf kehadiran` | `A23:D52` per-class yearly averages | **percentage**, two side-by-side blocks with header and total rows mixed in |
| `Keseluruhan` | `A17` label / `B18` value | **fraction** (0.96435) |

The workbook stores the same measure as both fractions and percentages, so `asPct_()`
normalises (`n <= 1.5 ? n * 100 : n`). The month-on-month change is computed from the values
displayed rather than read from the BEZA column, so the two can never disagree.