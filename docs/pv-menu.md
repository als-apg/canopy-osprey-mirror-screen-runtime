---
icon: lucide/mouse-pointer-click
---

# The PV menu

A right click on any widget that shows a PV opens a menu about that PV. It
works the same on a text readout, an LED, a button, a bar and a plot. Hold
**Shift** while you right-click to get the browser's own menu instead (copy
and paste in a text field).

## What it shows

The top of the menu is the PV itself:

- its **name** (click it to copy);
- its **description**, where the source states one;
- its **value** with units, and the time of that value;
- its **alarm severity**, display range and alarm limits.

## What it does

| Entry                          | What happens                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------- |
| **Copy PV name**               | The name goes to the clipboard.                                              |
| **Copy value**                 | The value with its units goes to the clipboard.                              |
| **Plot history**               | The data browser opens with this PV alone, in the time range it last showed. |
| **Add to history plot**        | The PV joins what the data browser already plots (12 at most).               |
| **Correlation: use as X**      | Remembers the PV as the X of the next correlation plot.                      |
| **Correlation: plot against**  | Plots this PV as a Y against the remembered X. A second Y joins that plot.   |
| **PV details…**                | Opens the facility's page about the PV in a browser tab of its own.          |
| **Plot history of all N**      | On a widget with several PVs: all of them in the data browser.               |
| **Plot history of the device** | On a widget of a linked device: all the device's channels.                   |

An entry appears only where it can work: the plot entries need the data
browser, the correlation entries the correlation tool, and **PV details…** a
`pvDetails` URL in the viewer's `config.json`. Outside the workspace (a
screen opened alone under `/s/`) the menu keeps the name, the two copy
entries and **PV details…**.

The X picked for a correlation belongs to the workspace, so you can pick it on
one screen and the Y on another. It is forgotten when the page reloads.

## Widgets with several PVs

A button with a command and a readback, or a plot with several curves, has
one menu. A row of chips above the PV says what each channel is to the widget
(**Readback**, **Setpoint**, **Command**, **Status**, or a curve's name) and
picks the one the entries act on. With more than three channels the last chip
opens a list of the rest. ←/→ step through the channels; ↑/↓ move through
the entries.

The menu opens on the channel most likely meant: a readback where the widget
has one, else the first channel.

## For screen authors

- The menu reads every channel a node's props name, as the `data-pv`
  attribute does. A `loc://` or `formula://` channel is the screen's own and
  is left out; a node with only such channels has no PV menu.
- An entry field that stages its value in a `loc://` channel names the PV it
  will write in `targetPV`. The menu then opens for that PV.
- A plot curve's `name` is its chip.
- A node with a `device` and no channel of its own (a drawn frame) keeps the
  device's menu, with the single entry **Plot history**.
