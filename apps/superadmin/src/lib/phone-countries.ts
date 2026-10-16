import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export type PhoneCountry = {
  iso: CountryCode;
  name: string;
  flag: string;
  callingCode: string;
  dialCode: string;
  shortDialCode: string;
  searchText: string;
};

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'IN';
const COUNTRY_CODES = getCountries();
const COUNTRY_SET = new Set<string>(COUNTRY_CODES);

function nanpPrefixes(): Map<CountryCode, string[]> {
  const result = new Map<CountryCode, string[]>();
  for (let areaCode = 200; areaCode <= 999; areaCode += 1) {
    const parsed = parsePhoneNumberFromString(`+1${areaCode}5550123`);
    if (!parsed?.country || parsed.countryCallingCode !== '1' || parsed.country === 'US' || parsed.country === 'CA') continue;
    const values = result.get(parsed.country) ?? [];
    if (!values.includes(String(areaCode))) values.push(String(areaCode));
    result.set(parsed.country, values);
  }
  return result;
}
const NANP_PREFIXES = nanpPrefixes();
const displayNames = new Intl.DisplayNames(['en'], { type: 'region', style: 'long' });

export const PHONE_COUNTRIES: readonly PhoneCountry[] = COUNTRY_CODES.map(iso => {
  const name = displayNames.of(iso) || iso;
  const callingCode = getCountryCallingCode(iso);
  const prefixes = NANP_PREFIXES.get(iso) ?? [];
  const dialCode = callingCode === '1' && prefixes.length ? prefixes.map(prefix => `+1-${prefix}`).join(' / ') : `+${callingCode}`;
  return {
    iso,
    name,
    callingCode,
    dialCode,
    shortDialCode: callingCode === '1' && prefixes.length ? `+1-${prefixes[0]}` : `+${callingCode}`,
    flag: [...iso].map(letter => String.fromCodePoint(127397 + letter.charCodeAt(0))).join(''),
    searchText: `${name} ${iso} ${dialCode} ${dialCode.replace(/[^+\d]/g, '')}`.toLocaleLowerCase('en'),
  };
}).sort((a, b) => a.name.localeCompare(b.name, 'en'));

export function isSupportedPhoneCountry(value: string | undefined | null): value is CountryCode {
  return !!value && COUNTRY_SET.has(value.toUpperCase());
}
export function getPhoneCountry(iso: CountryCode): PhoneCountry {
  return PHONE_COUNTRIES.find(country => country.iso === iso) ?? PHONE_COUNTRIES.find(country => country.iso === 'IN')!;
}

export function searchPhoneCountries(query: string): readonly PhoneCountry[] {
  const normalized = query.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
  if (!normalized) return PHONE_COUNTRIES;
  const compact = normalized.replace(/[^+\d]/g, '');
  const score = (country: PhoneCountry) => {
    const name = country.name.toLocaleLowerCase('en');
    const iso = country.iso.toLocaleLowerCase('en');
    if (name === normalized || iso === normalized || country.dialCode.replace(/[^+\d]/g, '') === compact) return 0;
    if (name.startsWith(normalized)) return 1;
    if (iso.startsWith(normalized)) return 2;
    return 3;
  };
  return PHONE_COUNTRIES
    .filter(country => country.searchText.includes(normalized) || (!!compact && country.searchText.includes(compact)))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'en'));
}

export function detectPhoneCountry(headers: Pick<Headers, 'get'>): CountryCode {
  for (const candidate of [headers.get('cf-ipcountry'), headers.get('x-vercel-ip-country'), headers.get('cloudfront-viewer-country')]) {
    const normalized = candidate?.trim().toUpperCase();
    if (isSupportedPhoneCountry(normalized)) return normalized;
  }
  return DEFAULT_PHONE_COUNTRY;
}

export function parsePhoneInput(input: string, country: CountryCode) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  const normalized = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
  const parsed = parsePhoneNumberFromString(normalized, international ? undefined : country);
  if (!parsed) return null;
  return { e164: parsed.number, country: parsed.country, nationalInput: parsed.formatNational(), valid: parsed.isValid() };
}
