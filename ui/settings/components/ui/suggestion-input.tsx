/* [INPUT]: Editable text, suggestions, optional dropdown loading/status and the caller's draft callback.
 * [OUTPUT]: Accessible free-text combobox with a themed suggestion list.
 * [POS]: Settings UI only; selection updates the same draft without submitting a form.
 * [PROTOCOL]: Keep components/ui/AGENTS.md in sync. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { Input } from './input';
import { Button } from './button';
import { ActionIcon } from './action-feedback';

type Props = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'list' | 'ref'> & {
  value: string;
  options: readonly string[];
  onValueChange: (value: string) => void;
  dropdown?: {
    label: string;
    onOpen: () => void;
    loading?: boolean;
    success?: boolean;
    message?: string;
  };
};

export function SuggestionInput({
  value,
  options,
  onValueChange,
  dropdown,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [active, setActive] = useState(-1);
  const [showAll, setShowAll] = useState(false);
  const matches = [...new Set(options)].filter(
    (option) => showAll || option.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()),
  );
  const expanded = open && !props.disabled && (!!dropdown || matches.length > 0);
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
    input.current?.focus();
  }
  function openDropdown() {
    setShowAll(true);
    setActive(-1);
    show();
    dropdown?.onOpen();
  }
  useLayoutEffect(() => {
    if (expanded && index >= 0) list.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [expanded, index]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [expanded]);

  return (
    <div ref={root} className="settings-suggestion-input" data-dropdown={!!dropdown}>
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
          if (!dropdown) show();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setOpen(false);
          setActive(-1);
          onBlur?.(event);
        }}
        onChange={(event) => {
          onValueChange(event.target.value);
          setShowAll(false);
          setActive(-1);
          show();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && dropdown && !expanded) {
            event.preventDefault();
            openDropdown();
          } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
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
      {dropdown && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="settings-suggestion-trigger"
          tabIndex={-1}
          aria-label={dropdown.label}
          aria-busy={!!dropdown.loading}
          aria-expanded={expanded}
          aria-controls={expanded ? id : undefined}
          disabled={props.disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (expanded) setOpen(false);
            else openDropdown();
          }}
        >
          <ActionIcon
            name="chevron-down"
            state={dropdown.loading ? 'pending' : dropdown.success ? 'success' : 'idle'}
          />
        </Button>
      )}
      {expanded && (
        <ul
          ref={list}
          id={id}
          role="listbox"
          aria-label={dropdown?.label || '可选建议'}
          aria-busy={dropdown?.loading || undefined}
          className="settings-suggestion-list"
          data-above={above}
        >
          {dropdown && !matches.length && (
            <li role="presentation" className="settings-suggestion-status">
              <span role="status">
                {dropdown.loading
                  ? '正在读取模型…'
                  : dropdown.message || '没有匹配的模型，可直接输入模型 ID。'}
              </span>
            </li>
          )}
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
