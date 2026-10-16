/* [INPUT]: Editable text, optional suggestions and the caller's existing draft callback.
 * [OUTPUT]: Accessible free-text combobox with a themed suggestion list.
 * [POS]: Settings UI only; selection updates the same draft without submitting a form.
 * [PROTOCOL]: Keep components/ui/AGENTS.md in sync. */
import { useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { Input } from './input';

type Props = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'list' | 'ref'> & {
  value: string;
  options: readonly string[];
  onValueChange: (value: string) => void;
};

export function SuggestionInput({
  value,
  options,
  onValueChange,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = [...new Set(options)].filter((option) =>
    option.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()),
  );
  const expanded = open && !props.disabled && matches.length > 0;
  const index = active >= 0 ? Math.min(active, matches.length - 1) : -1;

  function show() {
    const box = input.current?.getBoundingClientRect();
    setAbove(!!box && innerHeight - box.bottom < 260 && box.top > innerHeight - box.bottom);
    setOpen(true);
  }
  function choose(option: string) {
    onValueChange(option);
    setOpen(false);
    setActive(-1);
  }
  useLayoutEffect(() => {
    if (expanded && index >= 0) list.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [expanded, index]);

  return (
    <div className="settings-suggestion-input">
      <Input
        {...props}
        ref={input}
        value={value}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        aria-activedescendant={expanded && index >= 0 ? `${id}-${index}` : undefined}
        onFocus={(event) => {
          show();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setOpen(false);
          setActive(-1);
          onBlur?.(event);
        }}
        onChange={(event) => {
          onValueChange(event.target.value);
          setActive(-1);
          show();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
            event.preventDefault();
            show();
            setActive(
              event.key === 'ArrowDown'
                ? Math.min(index + 1, matches.length - 1)
                : index < 0
                  ? matches.length - 1
                  : Math.max(0, index - 1),
            );
          } else if (event.key === 'Enter' && expanded && index >= 0) {
            event.preventDefault();
            choose(matches[index]);
          } else if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      {expanded && (
        <ul
          ref={list}
          id={id}
          role="listbox"
          aria-label="可选建议"
          className="settings-suggestion-list"
          data-above={above}
        >
          {matches.map((option, position) => (
            <li
              key={option}
              id={`${id}-${position}`}
              role="option"
              aria-selected={position === index}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
