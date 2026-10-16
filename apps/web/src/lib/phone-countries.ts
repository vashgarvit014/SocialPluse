import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';

export type PhoneCountry = {
  iso: CountryCode;
  name: string;
  flag: string;
  callingCode: string;
  dialCode: string;
  shortDialCode: string;
  searchText: string;
};

export type ParsedPhoneInput = {
  e164: string;
  country?: CountryCode;
  nationalInput: string;
  valid: boolean;
};

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'IN';

const SUPPORTED_COUNTRY_CODES = getCountries();
const SUPPORTED_COUNTRY_SET = new Set<string>(SUPPORTED_COUNTRY_CODES);

// libphonenumber identifies NANP territories from their area-code prefixes.
// Enumerating the three-digit prefix space keeps this derived from the same
// installed metadata rather than maintaining a second country-code table.
function buildNanpTerritoryPrefixes(): Map<CountryCode, string[]> {
  const result = new Map<CountryCode, string[]>();
  for (let areaCode = 200; areaCode <= 999; areaCode += 1) {
    const parsed = parsePhoneNumberFromString(`+1${areaCode}5550123`);
    if (!parsed?.country || parsed.countryCallingCode !== '1') continue;
    if (parsed.country === 'US' || parsed.country === 'CA') continue;
    const existing = result.get(parsed.country) ?? [];
    if (!existing.includes(String(areaCode))) existing.push(String(areaCode));
    result.set(parsed.country, existing);
  }
  return result;
}
const NANP_TERRITORY_PREFIXES = buildNanpTerritoryPrefixes();

function countryFlag(iso: CountryCode): string {
  return [...iso].map(letter => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
}
function countryName(iso: CountryCode): string {
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region', style: 'long' });
  return displayNames.of(iso) || iso;
}

function dialingLabels(iso: CountryCode): Pick<PhoneCountry, 'callingCode' | 'dialCode' | 'shortDialCode'> {
  const callingCode = getCountryCallingCode(iso);
  const prefixes = NANP_TERRITORY_PREFIXES.get(iso) ?? [];
  if (callingCode === '1' && prefixes.length > 0) {
    return {
      callingCode,
      dialCode: prefixes.map(prefix => `+1-${prefix}`).join(' / '),
      shortDialCode: `+1-${prefixes[0]}`,
    };
  }
  return { callingCode, dialCode: `+${callingCode}`, shortDialCode: `+${callingCode}` };
}

export const PHONE_COUNTRIES: readonly PhoneCountry[] = SUPPORTED_COUNTRY_CODES
  .map(iso => {
    const name = countryName(iso);
    const dialing = dialingLabels(iso);
    const compactDial = dialing.dialCode.replace(/[^+\d]/g, '');
    return {
      iso,
      name,
      flag: countryFlag(iso),
      ...dialing,
      searchText: `${name} ${iso} ${dialing.dialCode} ${compactDial}`.toLocaleLowerCase('en'),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

export const SUPPORTED_PHONE_COUNTRY_COUNT = PHONE_COUNTRIES.length;

export function isSupportedPhoneCountry(value: string | null | undefined): value is CountryCode {
  return !!value && SUPPORTED_COUNTRY_SET.has(value.toUpperCase());
}

export function getPhoneCountry(iso: CountryCode): PhoneCountry {
  return PHONE_COUNTRIES.find(country => country.iso === iso)
    ?? PHONE_COUNTRIES.find(country => country.iso === DEFAULT_PHONE_COUNTRY)!;
}

export function searchPhoneCountries(query: string): readonly PhoneCountry[] {
  const normalized = query.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
  if (!normalized) return PHONE_COUNTRIES;
  const compact = normalized.replace(/[^+\d]/g, '');
  const score = (country: PhoneCountry): number => {
    const name = country.name.toLocaleLowerCase('en');
    const iso = country.iso.toLocaleLowerCase('en');
    const compactDial = country.dialCode.replace(/[^+\d]/g, '');
    if (name === normalized || iso === normalized || compactDial === compact) return 0;
    if (name.startsWith(normalized)) return 1;
    if (iso.startsWith(normalized)) return 2;
    return 3;
  };
  return PHONE_COUNTRIES
    .filter(country => country.searchText.includes(normalized) || (!!compact && country.searchText.includes(compact)))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'en'));
}

export function detectPhoneCountry(headers: Pick<Headers, 'get'>): CountryCode {
  const candidates = [
    headers.get('cf-ipcountry'),
    headers.get('x-vercel-ip-country'),
    headers.get('cloudfront-viewer-country'),
  ];
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toUpperCase();
    if (isSupportedPhoneCountry(normalized)) return normalized;
  }
  return DEFAULT_PHONE_COUNTRY;
}

function normalizeInternationalPrefix(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
}

export function parsePhoneInput(input: string, country: CountryCode): ParsedPhoneInput | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  const parsed = parsePhoneNumberFromString(normalizeInternationalPrefix(trimmed), international ? undefined : country);
  if (!parsed) return null;
  return {
    e164: parsed.number,
    country: parsed.country,
    nationalInput: parsed.formatNational(),
    valid: parsed.isValid(),
  };
}

export function toE164Phone(input: string, country: CountryCode): string {
  return parsePhoneInput(input, country)?.e164 ?? '';
}

export function isValidPhoneForCountry(input: string, country: CountryCode): boolean {
  const parsed = parsePhoneInput(input, country);
  return !!parsed?.valid && (!parsed.country || parsed.country === country || input.trim().startsWith('+') || input.trim().startsWith('00'));
}
