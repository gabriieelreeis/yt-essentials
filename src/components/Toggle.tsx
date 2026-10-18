interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Extra class on the wrapper label (e.g. "sub" for a nested option). */
  className?: string;
}

/** Switch styled by `.switch` / `.track` in theme.css. */
export function Toggle({ checked, onChange, label, disabled = false, className }: ToggleProps) {
  const classes = ['switch', className].filter(Boolean).join(' ');
  return (
    <label className={classes}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
