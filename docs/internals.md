# Internals

Everything below was worked out against Firefox Nightly 157. Selectors and theme
tokens move between major releases — when an update breaks the layout, start
here.

## Layout of the files

```
chrome/
  userChrome.css        entry point, nothing but @import
  userContent.css       content pages (about:newtab), the counterpart of userChrome
  modules/
    _variables.css      tokens, and the mapping onto Firefox's own variables
    layout.css          the single row (the heart of the hack)
    tabs.css            tab shape and colour
    urlbar.css          URL bar, fixed width
    toolbar.css         buttons, window controls, panels
    sidebar.css         sidebar
user.js                 the prefs the theme needs
bin/cli.js              the installer, the only non-CSS code in the project
package.json            what ships to npm: bin/, chrome/, user.js
```

## How the single row works

Firefox 157 stacks four toolbars as direct children of `#navigator-toolbox`:
`#toolbar-menubar`, `#TabsToolbar`, `#nav-bar`, `#PersonalToolbar`. There is no
`#titlebar` container any more — it existed up to roughly version 156, and a lot
of snippets online still reference it.

To merge them without touching the DOM, `layout.css` sets `#navigator-toolbox`
to `display: flex; flex-direction: row` and gives the intermediate containers
`display: contents`. Their children are then promoted to items of the same flex
row, and `order` can place them freely.

The container easiest to overlook is `hbox.toolbar-items`, sitting between
`#TabsToolbar` and `#TabsToolbar-customization-target`: until it is flattened,
`#tabbrowser-tabs` is not a row item and its `order` is silently ignored.

Every `order` carries `!important`, because Firefox itself sets `order: 1000` on
`.titlebar-buttonbox-container`. Without it the `─ ▢ ✕` buttons drift to the end
of the row and off the screen.

`!important` shows up anywhere Firefox already declares the property, for that
matter. `userChrome.css` is loaded as a *user* stylesheet: in the cascade a
normal user declaration loses against an author declaration, and Firefox's
internal sheets are author ones — sorted into `@layer`s as well, since the Nova
design system. Only `!important` on the user side wins.

## Finding the real selectors

The Browser Toolbox (`Ctrl+Shift+Alt+I`) shows the live DOM. To read the source
of the installed build without launching Firefox, the markup and stylesheets sit
in `browser/omni.ja` — a zip archive with a non-standard header that both
`unzip` and Python's `zipfile` refuse, so you have to scan for `PK` headers by
hand:

- `chrome/browser/content/browser/browser.xhtml` — the structure of the UI
- `chrome/browser/skin/classic/browser/tabbrowser/tabs.css` — tabs
- `chrome/browser/skin/classic/browser/urlbar.css` — URL bar
- `chrome/browser/skin/classic/browser/*/**.tokens.css` — theme tokens

## What changed in 157

Useful when picking up a snippet written for an earlier version:

| Before | Firefox 157 |
|---|---|
| `#titlebar` wraps the tabs | gone |
| `#urlbar-background` | `.urlbar-background` |
| `#urlbar-input-container` | `.urlbar-input-container` |
| megabar `#urlbar[breakout-extend]` | removed, the panel is a popover |
| `--tab-block-margin` | `--tab-margin-block` |
| `--tab-selected-bgcolor` | `--tab-background-color-selected` |
| `--toolbar-bgcolor` | `--toolbar-background-color` |
| `--toolbar-color` | `--toolbar-text-color` |
| `--toolbar-field-focus-border-color` | `--toolbar-field-border-color-focus` |

The main trap isn't a rename. Many tokens now go through
`light-dark(light, dark)`, resolved by the `color-scheme` property. Painting a
dark background is not enough, you have to **declare** it — otherwise Firefox
keeps computing text, icons and native window buttons for a light background,
and you get black on black. That is what `--vp-color-scheme` is for. Built-in
themes are lightweight themes, so they set `[lwt-toolbar-field]` on `:root` and
force a `color-scheme` onto the URL field: it has to be reasserted on `.urlbar`.

`browser.nova.enabled` defaults to `true`. Among other things the Nova design
system draws a purple-to-orange gradient border on the active tab, applied as
`background: ... border-box border-area`. A plain `background-color` will not
override it — the whole `background` property has to be set again, which is what
`tabs.css` does.

## The URL bar radius trap

With the results panel open, the bar's background stretches to cover the
results. Firefox paints it in two halves — `.urlbar-background` for the input,
`.urlbarView-background` for the view — which share
`--urlbar-background-border-radius` and meet as one surface.

Two consequences:

- forcing that radius to `999px` rounds the bottom corners of the panel hard
  enough to clip the last results. The pill is therefore applied under
  `.urlbar:not([popover-open])`, and the geometry of the open state is left to
  Firefox;
- repainting `.urlbar-background` directly only affects one half and leaves a
  visible seam at the junction. Colours go exclusively through
  `--urlbar-background-color` / `-focus`.

## When the row isn't the height you asked for

`--vp-row-height` is the target, but three things can add to it. All three are
handled — worth knowing if you touch `layout.css`:

- **`min-height` only constrains downwards.** The real height of a flex line is
  that of its tallest element. Hence the `max-height` on the row items: the
  constraint is imposed, not hoped for.
- **The `gap` shorthand sets both axes.** On a `flex-wrap` container it also
  applies *between lines*. Since `#toolbar-menubar` and `#notifications-toolbar`
  form empty lines, every inter-line gap was adding to the height for nothing.
  Hence `gap: 0 var(--vp-gap)`.
- **A border adds to the height.** The hairline under the bar is painted with
  `box-shadow: inset`, which draws inside the box.

To diagnose, in the Browser Toolbox console:

```js
(()=>{const t=document.getElementById('navigator-toolbox');return{toolbox:t.getBoundingClientRect().height,children:[...t.children].map(e=>`${e.id} → ${e.getBoundingClientRect().height}px (${getComputedStyle(e).display})`)}})()
```

If the toolbox is taller than the sum of its lines, it's the `row-gap`.

## A single horizontal gap

The row's `gap` is the only source of horizontal spacing, and `--vp-gap` its
only value. Firefox adds several others, each on a different kind of element —
without which every pair of elements would have its own. They are neutralised in
`layout.css`, under "Horizontal spacing":

| What Firefox adds | Where |
|---|---|
| `--toolbarbutton-padding-outer` (2px) | on either side of every toolbar button |
| `--toolbar-padding-inline` (8px) | before the first button, and after `#PanelUI-menu-button` |
| `--urlbar-margin-inline` (2px) | on either side of `#urlbar-container` |
| `margin-inline` (2px) | on `#stop-reload-button`, a grouped `toolbaritem` |

Tabs are the exception: the strip is an `arrowscrollbox`, its children are
distributed into a shadow DOM and a `gap` would not reach them. Spacing there is
done with half-margins on `.tabbrowser-tab` and `#tabs-newtab-button`, which the
strip cancels with a negative margin so that both of its ends stay aligned on
the row's gap.

To check, in the Browser Toolbox console:

```js
(()=>{const t=document.getElementById('navigator-toolbox'),i=[];(function w(n){for(const c of n.children){const s=getComputedStyle(c);if(s.display==='contents')w(c);else if(s.display!=='none'&&c.getBoundingClientRect().width)i.push(c)}})(t);const r=i.filter(e=>e.getBoundingClientRect().top<40).sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);return r.slice(1).map((e,n)=>`${r[n].id||r[n].className} → ${e.id||e.className} : ${(e.getBoundingClientRect().left-r[n].getBoundingClientRect().right).toFixed(1)}px`)})()
```

Every value should equal `--vp-gap`.

## Chrome and content

`userChrome.css` can only style the interface. `about:` pages — new tab,
preferences — are content documents: they belong to `chrome/userContent.css`,
loaded by the same pref from the same folder.

Two practical consequences:

- `--vp-*` tokens do not cross the boundary, each sheet has its own;
- a change to `userContent.css` needs a Firefox restart. The Browser Toolbox's
  `Ctrl+Shift+R` only reloads the chrome.

## Dragging the window

With no system title bar, the area that lets you drag the window is defined
entirely in CSS (`-moz-window-dragging`). Two rules in `layout.css` must not be
broken, on pain of an immovable window:

- `#tabbrowser-tabs` must **not** be `no-drag`. It has `flex: 1` and covers all
  the free space in the row; only the tabs themselves (`.tabbrowser-tab`) are
  excluded, so the empty space around them stays grabbable.
- `.titlebar-spacer[type="post-tabs"]` is kept as a guaranteed handle, for when
  tabs fill the whole strip. Firefox reserves two 40px ones for the same reason;
  here there is a single one, narrowed to `--vp-drag-handle-width`.

If you ever get stuck, Windows can still move a window from the keyboard:
`Alt + Space` → *Move* → arrow keys.

## Bookmarks toolbar

Two traps, both because it lives in the same flex container as the top row:

- **Don't hide it when it's empty.** Firefox builds the Places view lazily, when
  the toolbar becomes visible. A `display: none` conditioned on the absence of
  bookmarks creates a deadlock: empty so hidden, hidden so never rendered, never
  populated. The bookmarks then never appear at all. Firefox already collapses
  it on its own according to `browser.toolbars.bookmarks.visibility`.
- **Beware of rules aimed at the whole `#navigator-toolbox`.** Since the
  flattening with `display: contents`, the top row and this toolbar are children
  of the same container: there is no CSS boundary left between the two. Hiding
  `.toolbarbutton-text` across the toolbox, for instance, wipes out bookmark
  labels. The row's rules are therefore scoped to `#nav-bar` and `#TabsToolbar`,
  never to the toolbox.

## When it breaks

`display: contents` on `#nav-bar-customization-target` is the fragile point:
that is the element Firefox measures to decide which buttons to move into the
overflow menu. On a very narrow window, or with many buttons, the behaviour can
get shaky.

## Out of scope

No JS in the chrome. If a behaviour is ever needed — shortcuts, UI elements that
don't exist natively — go through
[fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig).

Mozilla regularly floats the idea of restricting `userChrome.css`. Don't make it
a critical dependency.

## References

- [r/FirefoxCSS](https://www.reddit.com/r/FirefoxCSS/) — up-to-date selectors
- [Firefox-UI-Fix](https://github.com/black7375/Firefox-UI-Fix) — modularisation
