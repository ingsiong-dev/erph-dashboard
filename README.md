# eRPH Summary Dashboard

Public web dashboard summarising teacher **eRPH** (daily lesson plan) submissions for
**SMK Meradong**, Sarawak.

- **Live link (no Google bar):** https://ingsiong-dev.github.io/erph-dashboard/
- **Direct Apps Script link:** https://script.google.com/macros/s/AKfycbxmx8KXaam55fnjnEMCVr-p_kl9m-5fI64a3YrFphgzF1pEeNF50Pjn6THIY3_XIKan/exec

Both open the **same app**. The root `index.html` is a wrapper that embeds the Apps Script
URL in an iframe â€?Google only draws its "This application was created by a Google Apps
Script user" bar in the top-level window, so framing removes it.

## This app has no admin and no login

Every visitor sees the same dashboard. There is no PIN, no role check and no access gate.
That is deliberate and is enforced in code:

- `apps-script/Code.js` â€?`doGet()` renders the dashboard unconditionally.
- There is **exactly one** `include()` definition. An earlier version had two, and the
  second one called `Session.getActiveUser()` to label the owner `-ADMIN`; because
  JavaScript keeps the *last* definition, it silently won and made the navbar label
  **empty for public visitors**. Do not add a second `include()` or `doGet()`.
- The dead `isUserAuthorized()` (DELIMA email allow-list) was removed from `DataService.js`.
- The unreachable "Access Denied" screen was removed from `Index.html`.

## Layout

```
index.html            GitHub Pages wrapper (this is what the live link serves)
apps-script/          the actual Apps Script project â€?open this folder to use clasp
  Code.js             doGet() + include()
  DataService.js      data layer: reads the Responses + DELIMA sheets, 5-min cache
  Index.html          page shell
  Navbar/Sidebar/Dashboard/TeacherList/TeacherDetail/Analytics/Reports.html
  Styles.html, Javascript.html
  appsscript.json, .clasp.json
```

`index.html` at the root and `apps-script/Index.html` are different files in different
folders â€?keep it that way (Windows filenames are case-insensitive, so they cannot live
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
above is the one in use; `@HEAD` is the dev URL and `@1 (erph)` is an old one â€?neither is
what people open.

Rollback is instant because versions are immutable: re-deploy the previous version number.

## Please note

- **The repo is public** (free GitHub Pages requires it) and the app is `ANYONE_ANONYMOUS`,
  so anyone with the link sees the dashboard â€?including teacher names and their
  submission/compliance status. This was already true before the repo existed; the repo
  just makes the URL easier to find.
- `apps-script/DataService.js` contains `SPREADSHEET_ID` (the eRPH data sheet). Publishing
  the ID does **not** grant access to the sheet, but it does advertise where the data lives.
  If that is a concern, move the ID into Script Properties and read it with
  `PropertiesService.getScriptProperties()`.
- The wrapper hides Google's "created by a Google Apps Script user" notice. That notice
  exists to protect users; this is the school's own app, but users should be told so.
