'use client';

import {
  useEffect,
  useId,
  useMemo,
  useCallback,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type { CountryCode } from 'libphonenumber-js';
import {
  getPhoneCountry,
  isSupportedPhoneCountry,
  parsePhoneInput,
  searchPhoneCountries,
  type PhoneCountry,
} from '@/lib/phone-countries';
import styles from './country-phone-field.module.css';

type CountryPhoneFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (e164Value: string) => void;
  country: CountryCode;
  onCountryChange: (country: CountryCode) => void;
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
  onFocus?: () => void;
  theme?: 'light' | 'dark';
  autoComplete?: string;
  placeholder?: string;
};

function emitPhoneValue(input: string, country: CountryCode, onChange: (value: string) => void): void {
  if (!input.trim()) {
    onChange('');
    return;
  }
  const parsed = parsePhoneInput(input, country);
  onChange(parsed?.e164 ?? input.trim());
}
export default function CountryPhoneField({
  id,
  label,
  value,
  onChange,
  country,
  onCountryChange,
  onBlur,
  error,
  disabled = false,
  onFocus,
  theme = 'light',
  autoComplete = 'tel',
  placeholder = 'Enter mobile number',
}: CountryPhoneFieldProps) {
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
  const errorId = `${id}-error`;
  const selected = getPhoneCountry(country);
  const countries = useMemo(() => searchPhoneCountries(query), [query]);
  const updateDropdownPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 12;
    const gap = 8;
    const width = Math.min(rect.width, viewportWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), viewportWidth - width - margin);
    const below = viewportHeight - rect.bottom - margin - gap;
    const above = rect.top - margin - gap;
    const openAbove = below < 260 && above > below;
    const maxHeight = Math.max(180, Math.min(410, openAbove ? above : below));
    setDropdownStyle({
      left,
      top: openAbove ? Math.max(margin, rect.top - gap - maxHeight) : rect.bottom + gap,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [open, updateDropdownPosition]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const close = (restoreTrigger = false) => {
    setOpen(false);
    setQuery('');
    if (restoreTrigger) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openDropdown = () => {
    updateDropdownPosition();
    setActiveIndex(Math.max(0, countries.findIndex(option => option.iso === country)));
    setOpen(true);
  };

  const selectCountry = (country: PhoneCountry) => {
    onCountryChange(country.iso);
    emitPhoneValue(nationalInput, country.iso, onChange);
    close();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const moveActive = (offset: number) => {
    if (!countries.length) return;
    setActiveIndex(index => (index + offset + countries.length) % countries.length);
  };

  const handleListKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); }
    else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); }
    else if (event.key === 'End') { event.preventDefault(); setActiveIndex(Math.max(0, countries.length - 1)); }
    else if (event.key === 'Enter' && countries[activeIndex]) { event.preventDefault(); selectCountry(countries[activeIndex]); }
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
  };

  const handlePhoneChange = (next: string) => {
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
    emitPhoneValue(next, country, onChange);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').trim();
    if (!(pasted.startsWith('+') || pasted.startsWith('00'))) return;
    const parsed = parsePhoneInput(pasted, country);
    if (!parsed) return;
    event.preventDefault();
    if (parsed.country && isSupportedPhoneCountry(parsed.country)) onCountryChange(parsed.country);
    setNationalInput(parsed.nationalInput);
    onChange(parsed.e164);
  };

  return (
    <div className={`${styles.field} ${theme === 'dark' ? styles.dark : ''}`} ref={rootRef} data-phone-country={country}>
      {label && <label className={styles.label} htmlFor={id}>{label}</label>}
      <div className={`${styles.control} ${error ? styles.controlError : ''}`}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.countryButton}
          aria-label={`Choose country or territory. Selected ${selected.name}, ${selected.dialCode}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          onClick={() => open ? close() : openDropdown()}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openDropdown();
            } else if (event.key === 'Escape') close(true);
          }}
        >
          <span className={styles.buttonFlag} aria-hidden="true">{selected.flag}</span>
          <span>{selected.shortDialCode}</span>
          <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">▼</span>
        </button>
        <input
          ref={inputRef}
          id={id}
          className={styles.phoneInput}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          disabled={disabled}
          value={nationalInput}
          placeholder={placeholder}
          onChange={event => handlePhoneChange(event.target.value)}
          onPaste={handlePaste}
          onFocus={onFocus}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>

      {open && (
        <div className={styles.dropdown} style={dropdownStyle}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              className={styles.search}
              type="search"
              role="combobox"
              aria-label="Search country or dialing code"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={countries[activeIndex] ? `${listId}-${countries[activeIndex].iso}` : undefined}
              placeholder="Search country or dialing code..."
              value={query}
              onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={handleListKeyboard}
            />
          </div>
          <div ref={listRef} id={listId} className={styles.list} role="listbox" aria-label="Countries and territories" style={{ maxHeight: Math.max(110, Number(dropdownStyle.maxHeight || 410) - 63) }}>
            {countries.map((country, index) => (
              <button
                id={`${listId}-${country.iso}`}
                data-option-index={index}
                key={country.iso}
                type="button"
                role="option"
                aria-selected={country.iso === selected.iso}
                className={`${styles.option} ${country.iso === selected.iso ? styles.optionSelected : ''} ${index === activeIndex ? styles.optionActive : ''}`}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => selectCountry(country)}
              >
                <span className={styles.optionFlag} aria-hidden="true">{country.flag}</span>
                <span className={styles.optionName}>{country.name} <span className={styles.optionIso}>{country.iso}</span></span>
                <span className={styles.optionDial}>{country.dialCode}</span>
              </button>
            ))}
            {!countries.length && <div className={styles.empty}>No countries or territories match your search.</div>}
          </div>
        </div>
      )}
      {error && <p id={errorId} className={styles.error}>{error}</p>}
    </div>
  );
}
