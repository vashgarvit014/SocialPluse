'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { getPhoneCountry, isSupportedPhoneCountry, parsePhoneInput, searchPhoneCountries, type PhoneCountry } from '@/lib/phone-countries';

export default function CountryPhoneField({ id, value, onChange, country, onCountryChange, disabled, onFocus, onBlur }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const initialParsed = parsePhoneInput(value, country);
  const [nationalInput, setNationalInput] = useState(initialParsed?.nationalInput ?? '');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = getPhoneCountry(country);
  const countries = useMemo(() => searchPhoneCountries(query), [query]);

  const updatePosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 12;
    const gap = 8;
    const width = Math.min(rect.width, window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const below = window.innerHeight - rect.bottom - margin - gap;
    const above = rect.top - margin - gap;
    const openAbove = below < 260 && above > below;
    const maxHeight = Math.max(180, Math.min(410, openAbove ? above : below));
    setDropdownStyle({ left, top: openAbove ? Math.max(margin, rect.top - gap - maxHeight) : rect.bottom + gap, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const close = (restore = false) => {
    setOpen(false);
    setQuery('');
    if (restore) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const show = () => {
    updatePosition();
    setActiveIndex(Math.max(0, countries.findIndex(option => option.iso === country)));
    setOpen(true);
  };
  const emit = (input: string, iso: CountryCode) => onChange(input.trim() ? (parsePhoneInput(input, iso)?.e164 ?? input.trim()) : '');
  const select = (option: PhoneCountry) => {
    onCountryChange(option.iso);
    emit(nationalInput, option.iso);
    close();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };
  const change = (next: string) => {
    if (next.trimStart().startsWith('+') || next.trimStart().startsWith('00')) {
      const parsed = parsePhoneInput(next, country);
      if (parsed) {
        if (parsed.country && isSupportedPhoneCountry(parsed.country)) onCountryChange(parsed.country);
        setNationalInput(parsed.nationalInput);
        onChange(parsed.e164);
        return;
      }
    }
    setNationalInput(next);
    emit(next, country);
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text').trim();
    if (!(text.startsWith('+') || text.startsWith('00'))) return;
    const parsed = parsePhoneInput(text, country);
    if (!parsed) return;
    event.preventDefault();
    if (parsed.country && isSupportedPhoneCountry(parsed.country)) onCountryChange(parsed.country);
    setNationalInput(parsed.nationalInput);
    onChange(parsed.e164);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (!countries.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => (index + 1) % countries.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => (index - 1 + countries.length) % countries.length); }
    else if (event.key === 'Enter') { event.preventDefault(); select(countries[activeIndex]); }
  };

  return (
    <div className="sa-phone" ref={rootRef} data-phone-country={country}>
      <div className="sa-phone-control">
        <button ref={triggerRef} type="button" className="sa-country-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={`Choose country or territory. Selected ${selected.name}, ${selected.dialCode}`} onClick={() => open ? close() : show()}>
          <span aria-hidden="true">{selected.flag}</span><span>{selected.shortDialCode}</span><span aria-hidden="true">▾</span>
        </button>
        <input ref={inputRef} id={id} className="sa-phone-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="Mobile number" value={nationalInput} disabled={disabled} onChange={event => change(event.target.value)} onPaste={paste} onFocus={onFocus} onBlur={onBlur} />
      </div>
      {open && (
        <div className="sa-country-menu" style={dropdownStyle}>
          <div className="sa-country-search-wrap"><span aria-hidden="true">⌕</span><input ref={searchRef} type="search" role="combobox" aria-label="Search country or dialing code" aria-expanded="true" aria-controls={listId} placeholder="Search country or dialing code..." value={query} onChange={event => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={keyDown} /></div>
          <div ref={listRef} id={listId} className="sa-country-list" role="listbox" aria-label="Countries and territories" style={{ maxHeight: Math.max(110, Number(dropdownStyle.maxHeight || 410) - 63) }}>
            {countries.map((option, index) => (
              <button key={option.iso} type="button" role="option" aria-selected={option.iso === country} data-option-index={index} className={`sa-country-option${option.iso === country ? ' selected' : ''}${index === activeIndex ? ' active' : ''}`} onPointerMove={() => setActiveIndex(index)} onClick={() => select(option)}>
                <span aria-hidden="true">{option.flag}</span><span className="sa-country-name">{option.name} <small>{option.iso}</small></span><span className="sa-country-dial">{option.dialCode}</span>
              </button>
            ))}
            {!countries.length && <div className="sa-country-empty">No matching country or territory.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
