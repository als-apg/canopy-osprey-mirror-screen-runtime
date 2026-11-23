---
icon: lucide/pencil-line
---

# Confirmed and staged writes

A screen can ask the operator to confirm a write, and it can collect several
typed values and write them together. Four things in a screen document do
this: the node props `confirmWrites` and `stage`, and the actions
`apply_staged` and `clear_staged`. Four more node props word the dialog:
`confirmTitle`, `confirmText`, `confirmVerb` and `confirmKind`.

None of them changes how a value reaches the control system. Every write is
still one write to one channel through the viewer's write gate, judged there
and by the backend as any other write is.

The channel names below are examples.

## Asking to confirm: `confirmWrites`

Set `confirmWrites` on the node that triggers the write: the writing widget
itself, or the node whose click carries the actions.

```json
{
  "id": "mode-a",
  "type": "regular-button",
  "geometry": { "x": 20, "y": 20, "width": 120, "height": 32 },
  "props": {
    "label": "Set mode A",
    "confirmWrites": true,
    "actions": [
      { "type": "write_pv", "pvName": "DEMO:PS1:SETPOINT", "value": 12.5 },
      { "type": "write_pv", "pvName": "DEMO:PS2:SETPOINT", "value": -3.0 }
    ]
  }
}
```

Before anything is written, one dialog lists every channel of the press with
its current value and the value about to be written. **Cancel** writes
nothing. The confirm button sends the writes in order.

- The prop only adds a dialog. A deployment that confirms every write, or a
  control session that asks for confirmation, opens the dialog with or
  without it. A screen cannot turn the dialog off.
- It asks for every value except an absent one, `false` and the string
  `"false"`. So `true`, `"true"`, `1` and a macro that resolves to anything
  but `false` all ask. When in doubt, the dialog opens.
- On a momentary button (press and release values) the press and the release
  are confirmed together and sent as one pulse.
- Without the prop, and where the deployment does not ask, a press writes
  directly, also when it writes several channels.

## What the dialog says

The dialog reads from top to bottom:

1. **What is written to.** The name of the control target, always the first
   line, with a marker. Where the viewer is told the kind of target, the
   marker takes its colour and the line says "the machine" or "not the
   machine"; where it is told only a name, the marker stays grey. A target
   served from the fallback says so.
2. **A title that is a question** saying what happens.
3. **One sentence** from the screen, when it gives one.
4. **The writes.**
   - One write is drawn as labelled rows: `channel`, `now`, `writes`. The
     value about to be written is in bold, with the channel's unit. For a
     value the operator chose (an entry, a slider, a staged value) the row
     also shows the step from the current value (`+0.0150`), and a `limits`
     row shows the channel's control limits. A row whose content is not known
     is left out.
   - Several writes are a table with a `now` and a `writes` column, both
     right-aligned.
   - `now` is read live while the dialog is open. A channel with no live value
     reads `not connected`.
   - A momentary button's press and release are one write on the `writes`
     row: `1 · then 0 (release)`.
5. **Cancel** and the **confirm button**, which says the action.

### Wording it from the screen

Set these on the same node as `confirmWrites`. All four are optional, and
macros are substituted in them.

| Prop           | What it sets                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `confirmTitle` | The title: a question, for example "Reboot controller RACK1?".                                  |
| `confirmText`  | One sentence under the title: what happens, or what is not known.                               |
| `confirmVerb`  | The word on the confirm button, for example "Reboot".                                           |
| `confirmKind`  | `"consequence"`: the sentence is drawn as a warning and the confirm button in the danger style. |

```json
{
  "id": "reboot",
  "type": "pv-button",
  "geometry": { "x": 20, "y": 20, "width": 120, "height": 32 },
  "props": {
    "pv": "RACK1:CTRL1:Reboot",
    "label": "Reboot",
    "pressValue": 0,
    "confirmWrites": true,
    "confirmTitle": "Reboot controller RACK1:CTRL1?",
    "confirmText": "It commands 2 power supplies. Their outputs are off until it is back.",
    "confirmVerb": "Reboot",
    "confirmKind": "consequence"
  }
}
```

- These props only word a dialog that opens. None of them opens one: that is
  `confirmWrites`, the deployment's setting, or the control session.
- They are read on a writing widget (a button, a text entry, a slider, a
  toggle, a dropdown, a checkbox, a radio group) and on a node whose click
  carries `write_pv` or `apply_staged` actions.
- `confirmMessage`, an older prop of the text entry, is read as `confirmText`
  where `confirmText` is not set. The older `confirmOnWrite` is not read; use
  `confirmWrites`.

### Without wording from the screen

The dialog builds the title and the button word from the widget's label and
the write.

| The run                                  | Title                                       | Button    |
| ---------------------------------------- | ------------------------------------------- | --------- |
| A press of a labelled button or node     | `<label>?`                                  | `<label>` |
| One value set (entry, slider, toggle...) | `Set <label or channel> to <value> <unit>?` | `Set`     |
| One staged value applied                 | `Set <channel> to <value> <unit>?`          | `Set`     |
| Several values, no labelled press        | `Apply N changes?`                          | `Apply N` |
| One write with no label                  | `Write <value> to <channel>?`               | `Write`   |

A label names the press as the screen shows it. Where a label is not an
action (a button that carries a device name), give the node a `confirmTitle`
and a `confirmVerb`. A label longer than 24 characters is not used as the
button word. An Apply node's own `confirmTitle` and `confirmVerb` are used as
they are written; they cannot carry the count.

### Keys

- Focus starts on **Cancel**. Enter never confirms unless the operator has
  moved the focus to the confirm button.
- The Enter that opened the dialog (in a text entry, or on a focused button)
  does not answer it, held down or not.
- **Escape** and the close mark cancel.

## Staging a value: `stage`

A text entry with a `stage` prop does not write. The prop names a **scope**.

```json
{
  "id": "sp-1",
  "type": "pv-text-input",
  "geometry": { "x": 20, "y": 20, "width": 120, "height": 32 },
  "props": { "pv": "DEMO:PS1:SETPOINT", "stage": "set" }
}
```

- **Enter** (or leaving the field with typed text) stages the value. The
  field then shows the value that will be sent, in italics with a bar on its
  left edge, in place of the live value. What it shows is always exactly
  the value that will be sent, never a rounded one. A number keeps the
  decimals as typed (`2.50`) and is written out in plain decimals (`1e-7`
  shows as `0.0000001`); only a number that would need more than 24
  characters that way is shown with an exponent (`1e-101`).
- **Arrow up / down** step a staged number by one unit of its last shown
  digit, as in any numeric entry. A number shown with an exponent steps by
  the precision of the widget or the channel.
- **Escape** drops the text being typed; pressed again, it drops the staged
  value of this entry and the field shows the live value.
- Only a value the entry accepts is staged. A numeric entry stages nothing
  for text that is not a number.
- An entry that stages never writes on its own. Where staging is not
  available (a host that renders the widget without a screen), or where
  `stage` names no scope (empty after macro substitution, not a string), the
  entry is inert and says so; it does not fall back to writing.
- An entry on a local channel (`loc://`, `formula://`) ignores `stage`: it
  is not a machine write.

### A staged value lives with its entry

A staged value exists only while its entry is on screen and bound to the same
channel. It is dropped, unwritten, when

- the entry is hidden by a rule or removed,
- a rule or a macro binds the entry to another channel,
- the screen is reloaded or replaced, or opened with other macro values,
- the embedded screen holding the entry is re-targeted or fetched again.

An Apply checks this again before each single write, and when its dialog is
confirmed: a value whose entry has left the screen since the press, or that
is no longer the value that was staged, is not sent, and the run stops there
with `<channel>: not sent; no longer on screen`. While a run writes a scope,
the entries holding its values are locked (no typing, no Escape), so a field
cannot go back to the live value while its write is on the way.

## Writing a scope: `apply_staged`

```json
{
  "id": "apply-set",
  "type": "regular-button",
  "geometry": { "x": 20, "y": 200, "width": 120, "height": 32 },
  "props": {
    "label": "Apply",
    "confirmWrites": true,
    "actions": [{ "type": "apply_staged", "scope": "set" }]
  }
}
```

The action takes a `scope` and an optional `description` (the text a node
shows when it offers its actions as a menu). It names no channel: it writes
the values staged in the scope, in the order they were staged, each as one
single-channel write.

**The run stops at the first write that is not confirmed.** That includes a
write that was sent but read back differently, and one whose readback did not
arrive. Then:

- values written before it stay written;
- the value it stopped at stays staged and marked;
- values after it are not sent and stay staged;
- a message names the channel and says whether its value was sent, for
  example `DEMO:PS2:SETPOINT: not sent; above the limit (1 of 3 written)` or
  `DEMO:PS2:SETPOINT: sent, readback differs; ... (2 of 3 written)`.

If the same channel is staged more than once under one Apply (in two
embedded screens, say), it is written once when the values agree. When they
differ, nothing is written at all: the entries that disagree are marked in
red where they sit, and a message names the channel and the values
(`DEMO:PS1:SETPOINT: staged with different values (2 and 2.5); nothing
written`). In the viewer the message appears where the results of writes do.
Make the entries agree, or drop one with Escape, and apply again.

A value leaves staging only when its write was confirmed. **Cancel** in the
dialog keeps every value staged.

The dialog opens only when asked: set `confirmWrites` on the Apply node to
have every Apply confirmed.

### The Apply node shows its state

A node whose actions are all `apply_staged` or `clear_staged`

- is disabled, with the hover "nothing staged", while its scope holds no
  value;
- shows the number of staged values in its top right corner otherwise;
- is disabled while a run is writing its scope. A second press does nothing.
  Entries with nothing staged can still take a value meanwhile; it is not
  part of the running run.

It is also disabled, like every writing node, while writes are not accepted.

### Order in an action list

A list runs in the order it is written. `write_pv` actions before an
`apply_staged` are sent first, as one run; then the staged values; then the
`write_pv` actions after it, as another run. A staged run that stops, or a
declined dialog, holds back everything after it.

```json
[
  { "type": "write_pv", "pvName": "DEMO:MODE:ARM", "value": 1 },
  { "type": "apply_staged", "scope": "set" },
  { "type": "write_pv", "pvName": "DEMO:MODE:GO", "value": 1 }
]
```

A list with no `apply_staged` is unchanged: all its `write_pv` actions are
one run.

## Dropping a scope: `clear_staged`

```json
{ "type": "clear_staged", "scope": "set" }
```

Drops every value staged in the scope. Nothing is written.

## Where a scope reaches

A scope belongs to one screen instance and the screens embedded below it.

- An Apply (or Clear) on a screen acts on the values staged on that screen
  and in every screen it embeds, at any depth.
- An Apply inside an embedded screen acts on that instance only: not on the
  screen embedding it, and not on another instance beside it, even when they
  use the same scope name.

So one Apply on a view writes all its embedded rows, and an Apply inside one
embedded card writes only that card. The count on the node follows the same
rule. A scope does not reach another tile or window.

Macros are substituted in a scope name, as in any string of a screen.

## Two changes for every screen

Two things changed for writes that use none of the above.

- **A fault in the write path is shown.** When the write backend fails
  outright on a single write (not a refusal, a fault), the viewer now shows a
  message for it. Before, the write ended as unknown with no message.
- **Several writes, fault in the middle.** The writes answered before the
  fault keep their outcomes, and the message counts them
  ("(k of n written)"). Before, the whole run was reported as one unknown
  write.

Unchanged: after such a fault nothing more of the run is sent, the release of
a momentary button included.
