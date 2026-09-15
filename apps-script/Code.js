/**
 * eRPH Summary Dashboard — Apps Script backend
 *
 * PUBLIC MODE: no admin, no login check, no access gate. Every visitor sees the
 * same dashboard. Nothing in this project depends on who is signed in.
 *
 * IMPORTANT — keep exactly ONE definition of include() and doGet() in this file.
 * A second definition of the same function name silently overrides the first
 * (JavaScript hoisting keeps the last one). That is what previously caused the
 * navbar to show an empty label for public visitors and "KOH ING SIONG-ADMIN"
 * for the owner: a duplicate include() was calling Session.getActiveUser().
 */

/** Neutral label shown in the navbar. This app has no signed-in user. */
const PUBLIC_LABEL = 'Public Access';

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('eRPH Summary Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Renders a sub-component (Sidebar, Navbar, Dashboard, TeacherList, ...) to HTML.
 * Only Navbar.html uses a template tag (<?= userEmail ?>), satisfied here so no
 * sub-file can fail to evaluate and blank the whole page.
 */
function include(filename) {
  try {
    const template = HtmlService.createTemplateFromFile(filename);
    template.userEmail = PUBLIC_LABEL;
    return template.evaluate().getContent();
  } catch (err) {
    Logger.log('Sub-component [' + filename + '] failed to render: ' + err.toString());
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }
}
