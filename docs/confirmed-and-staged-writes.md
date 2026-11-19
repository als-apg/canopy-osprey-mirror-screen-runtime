---
icon: lucide/pencil-line
---

# Confirmed and staged writes

A screen can ask the operator to confirm a write, and it can collect several
typed values and write them together. Four things in a screen document do
this: the node props `confirmWrites` and `stage`, and the actions
`apply_staged` and `clear_staged`.

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
nothing. **Write** sends the writes in order.

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
  left edge, in place of the live value.
- **Escape** drops the text being typed; pressed again, it drops the staged
  value and the field shows the live value.
- Only a value the entry accepts is staged. A numeric entry stages nothing
  for text that is not a number.
- An entry that stages never writes on its own. Where staging is not
  available (a host that renders the widget without a screen), the entry is
  inert and says so; it does not fall back to writing.
- An entry on a local channel (`loc://`, `formula://`) ignores `stage`: it
  is not a machine write.

### A staged value lives with its entry

A staged value exists only while its entry is on screen and bound to the same
channel. It is dropped, unwritten, when

- the entry is hidden by a rule or removed,
- a rule or a macro binds the entry to another channel,
- the screen is reloaded or replaced, or opened with other macro values,
- the embedded screen holding the entry is re-targeted or fetched again.

So an Apply never writes a value the operator cannot see.

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
  Values can still be staged meanwhile; they are not part of the running run.

It is also disabled, like every writing node, while writes are not accepted.

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
