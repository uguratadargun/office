import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';
import { Row, SaveHint } from './Row';

/**
 * The four row types the panel is built from. They compose the shadcn
 * primitives — they do not replace them (DESIGN-MODERN.md: never hand-roll a
 * control) — and they own the one piece of behaviour every Settings screen gets
 * wrong: WHEN a value is written.
 *
 * Text and number rows save on BLUR and on Enter, never on keystroke. Toggles
 * and selects save on change, because their change IS the commit.
 *
 * The re-seed effect is the other half, and it is the bug MD-64 fixed in the
 * pixel modal: local field state initialised from a prop goes stale the moment
 * anything else writes the config, and the field then reads back the OLD value
 * while the user watches. Here the effect re-seeds from `value` whenever the
 * saved value changes AND the box is not focused — so a save elsewhere is
 * reflected, and your own typing is never yanked out from under you.
 */
function useFieldState(value: string) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return { draft, setDraft, focused };
}

export function TextRow({
  id,
  label,
  help,
  value,
  onCommit,
  placeholder,
  type = 'text',
  monospace = false,
  disabled = false
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  value: string;
  onCommit: (next: string) => void | Promise<unknown>;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  monospace?: boolean;
  disabled?: boolean;
}) {
  const inputId = useId();
  const { draft, setDraft, focused } = useFieldState(value);
  const [saved, setSaved] = useState(false);

  const commit = async () => {
    focused.current = false;
    if (draft === value) return;
    await onCommit(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  return (
    <Row id={id} label={label} help={help} htmlFor={inputId}>
      <div className="flex items-center gap-2">
        <SaveHint show={saved} />
        <Input
          id={inputId}
          type={type}
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          className={monospace ? 'w-64 font-mono text-[12px]' : 'w-64'}
          onFocus={() => { focused.current = true; }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      </div>
    </Row>
  );
}

export function ToggleRow({
  id,
  label,
  help,
  checked,
  onChange,
  disabled = false
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void | Promise<unknown>;
  disabled?: boolean;
}) {
  const switchId = useId();
  return (
    <Row id={id} label={label} help={help} htmlFor={switchId}>
      <Switch
        id={switchId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next: boolean) => void onChange(next)}
      />
    </Row>
  );
}

export interface Choice {
  value: string;
  label: string;
}

export function SelectRow({
  id,
  label,
  help,
  value,
  choices,
  onChange,
  width = 'w-64',
  disabled = false
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  value: string;
  choices: Choice[];
  onChange: (next: string) => void | Promise<unknown>;
  width?: string;
  disabled?: boolean;
}) {
  return (
    <Row id={id} label={label} help={help}>
      <Select value={value} disabled={disabled} onValueChange={(v) => void onChange(v)}>
        <SelectTrigger className={width} aria-label={typeof label === 'string' ? label : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

/** A row whose control is anything else — a button, a list, a picker. */
export function ActionRow({
  id,
  label,
  help,
  children,
  stacked = false
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
}) {
  return <Row id={id} label={label} help={help} stacked={stacked}>{children}</Row>;
}
