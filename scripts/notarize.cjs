const path = require("node:path");

exports.default = async function notarizeMacApp(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  if (process.env.COVIEW_SKIP_NOTARIZE === "1") {
    console.log("[notarize] Skipping notarization due to COVIEW_SKIP_NOTARIZE=1");
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      "[notarize] Skipping notarization. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID to enable it.",
    );
    return;
  }

  const { notarize } = require("@electron/notarize");
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[notarize] Submitting ${appPath} with Apple notarytool`);
  await notarize({
    tool: "notarytool",
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log(`[notarize] Completed ${appName}.app`);
};
