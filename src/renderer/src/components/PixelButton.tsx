import { CSSProperties, ReactNode, useState } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

export interface PixelButtonProps {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: CSSProperties;
  title?: string;
}

const heightBySize: Record<Size, number> = { sm: 24, md: 32, lg: 40 };
const padBySize: Record<Size, string> = { sm: '0 8px', md: '0 12px', lg: '0 16px' };

export function PixelButton({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
  fullWidth = false,
  style,
  title
}: PixelButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState(false);

  // DISABLED TEXT IS ITS OWN COLOR, not the variant's.
  //
  // Every variant swaps its FILL to `--cth-cream-300` when disabled, but the
  // variants used to keep their enabled text token — an inverse foreground
  // picked to sit on a filled button. On the cream-300 disabled fill that
  // pairing collapses to ~1.4:1 in dark mode and barely better in light, which
  // is why a disabled Send or Dispatch read as an empty box.
  //
  // `--cth-ink-500` is the one foreground that works against cream-300 in BOTH
  // themes, because both tokens flip together — and a muted label is what a
  // disabled control should look like anyway.
  const disabledText = 'var(--cth-ink-500)';

  const palette = (() => {
    switch (variant) {
      case 'primary':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? 'var(--cth-accent-hover)' : 'var(--cth-accent)'),
          text:    disabled ? disabledText : 'var(--cth-paper-100)',
          border:  disabled ? 'var(--cth-ink-300)' : 'var(--cth-accent-hover)',
          shadow:  disabled ? 'var(--cth-ink-100)' : 'var(--cth-accent-hover)'
        };
      case 'secondary':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? 'var(--cth-cream-200)' : 'var(--cth-cream-100)'),
          text:    disabled ? disabledText : 'var(--cth-ink-900)',
          border:  'var(--cth-ink-300)',
          shadow:  'var(--cth-ink-100)'
        };
      case 'ghost':
        return {
          fill:    hover ? 'var(--cth-cream-200)' : 'transparent',
          text:    disabled ? disabledText : 'var(--cth-ink-700)',
          border:  'var(--cth-ink-300)',
          shadow:  'var(--cth-ink-100)'
        };
      case 'destructive':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? 'var(--cth-danger-hover)' : 'var(--cth-danger)'),
          text:    disabled ? disabledText : 'var(--cth-paper-100)',
          border:  disabled ? 'var(--cth-ink-300)' : 'var(--cth-danger-hover)',
          shadow:  disabled ? 'var(--cth-ink-100)' : 'var(--cth-danger-hover)'
        };
    }
  })();

  return (
    <button
      title={title}
      onClick={disabled ? undefined : onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => { setPressed(false); setHover(false); }}
      onMouseEnter={() => setHover(true)}
      disabled={disabled}
      style={{
        height: heightBySize[size],
        padding: padBySize[size],
        background: palette.fill,
        color: palette.text,
        border: 'none',
        // v0.3.4: 1px hairline + 1px lift — the 2px chrome read as heavy boxes
        boxShadow: pressed && !disabled
          ? `inset 0 0 0 1px ${palette.border}`
          : `inset 0 0 0 1px ${palette.border}, 0 1px 0 ${palette.shadow}`,
        transform: pressed && !disabled ? 'translateY(1px)' : 'none',
        fontFamily: 'var(--cth-font-ui)',
        fontSize: size === 'lg' ? 'var(--cth-text-body-md)' : 'var(--cth-text-body-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: fullWidth ? '100%' : 'auto',
        userSelect: 'none',
        // Height is fixed by the size variant above, so a label that wraps does
        // not make the button taller — the extra line simply prints through the
        // bottom border. Every label here is a short phrase ("Check for updates",
        // "reset & start over"), so wrapping is always a layout bug rather than a
        // wanted behaviour. Callers that genuinely want a multi-line button can
        // still override, since `style` spreads after this.
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {children}
    </button>
  );
}
