// vulpine — required prefs.
// Goes in the profile folder. Firefox reads it at every startup: as long as
// this file is there these values are reapplied, and cannot be changed for good
// from about:config. To take back control, delete the file and restart Firefox.

// Loads chrome/userChrome.css from the profile. Without this, nothing applies.
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// Inspecting the interface in the Browser Toolbox (Ctrl+Shift+Alt+I).
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);

// Makes the "Compact" option visible in customize mode.
user_pref("browser.compactmode.show", true);

// Optional: native compact density. Left off, since heights are driven by
// _variables.css. Uncomment to stack the two.
// user_pref("browser.uidensity", 1);
