import test from 'node:test';
import assert from 'node:assert/strict';
import { getCountries, getCountryCallingCode } from '../apps/web/node_modules/libphonenumber-js/max/index.js';
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  SUPPORTED_PHONE_COUNTRY_COUNT,
  detectPhoneCountry,
  getPhoneCountry,
  isValidPhoneForCountry,
  parsePhoneInput,
  searchPhoneCountries,
  toE164Phone,
} from '../apps/web/src/lib/phone-countries.ts';
import { emailSchema, loginIdentifierSchema, mobileSchema } from '../apps/web/src/lib/auth/schemas.ts';

test('exports every country and territory in the installed libphonenumber dataset', () => {
  const datasetCountries = getCountries();
  assert.equal(SUPPORTED_PHONE_COUNTRY_COUNT, datasetCountries.length);
  assert.equal(PHONE_COUNTRIES.length, datasetCountries.length);
  assert.deepEqual(new Set(PHONE_COUNTRIES.map(country => country.iso)), new Set(datasetCountries));

  for (const country of PHONE_COUNTRIES) {
    assert.match(country.iso, /^[A-Z]{2}$/);
    assert.ok(country.name && country.name !== country.iso, `${country.iso} must have a display name`);
    assert.match(country.flag, /^.{2}$/u);
    assert.equal(country.callingCode, getCountryCallingCode(country.iso));
    assert.match(country.dialCode, /^\+\d/);
  }
});
test('searches by full or partial name, ISO code, and dialing code', () => {
  assert.equal(searchPhoneCountries('India')[0]?.iso, 'IN');
  assert.equal(searchPhoneCountries('indi')[0]?.iso, 'IN');
  assert.deepEqual(searchPhoneCountries('IN').map(country => country.iso).includes('IN'), true);
  assert.deepEqual(searchPhoneCountries('+91').map(country => country.iso), ['IN']);
  assert.ok(searchPhoneCountries('United').some(country => country.iso === 'US'));
  assert.ok(searchPhoneCountries('United').some(country => country.iso === 'GB'));
  assert.ok(searchPhoneCountries('+1').length > 10);
});
test('derives territory-specific NANP prefixes without changing the true country calling code', () => {
  assert.equal(getPhoneCountry('US').dialCode, '+1');
  assert.equal(getPhoneCountry('CA').dialCode, '+1');
  assert.equal(getPhoneCountry('AG').callingCode, '1');
  assert.equal(getPhoneCountry('AG').dialCode, '+1-268');
  assert.match(getPhoneCountry('DO').dialCode, /\+1-809/);
  assert.match(getPhoneCountry('DO').dialCode, /\+1-829/);
  assert.match(getPhoneCountry('DO').dialCode, /\+1-849/);
  assert.match(getPhoneCountry('PR').dialCode, /\+1-787/);
  assert.match(getPhoneCountry('PR').dialCode, /\+1-939/);
});

test('detects trusted country headers in priority order and falls back to India', () => {
  assert.equal(DEFAULT_PHONE_COUNTRY, 'IN');
  assert.equal(detectPhoneCountry(new Headers()), 'IN');
  assert.equal(detectPhoneCountry(new Headers({ 'x-vercel-ip-country': 'US' })), 'US');
  assert.equal(detectPhoneCountry(new Headers({ 'cf-ipcountry': 'AE', 'x-vercel-ip-country': 'US' })), 'AE');
  assert.equal(detectPhoneCountry(new Headers({ 'cf-ipcountry': 'XX' })), 'IN');
});

test('normalizes valid national and international numbers to E.164', () => {
  assert.equal(toE164Phone('9876543210', 'IN'), '+919876543210');
  assert.equal(toE164Phone('(415) 555-2671', 'US'), '+14155552671');
  assert.equal(toE164Phone('464-1234', 'AG'), '+12684641234');
  assert.equal(parsePhoneInput('00 44 20 7946 0018', 'IN')?.e164, '+442079460018');
  assert.equal(parsePhoneInput('+971 50 123 4567', 'IN')?.country, 'AE');
  assert.equal(isValidPhoneForCountry('9876543210', 'IN'), true);
  assert.equal(isValidPhoneForCountry('123', 'IN'), false);
});

test('signup uses country-aware validation while login stays E.164-compatible for existing accounts', () => {
  assert.equal(mobileSchema.safeParse('+919876543210').success, true);
  assert.equal(mobileSchema.safeParse('+919999').success, false);
  assert.equal(loginIdentifierSchema.safeParse('+919876543210').success, true);
  assert.equal(loginIdentifierSchema.safeParse('+12345678').success, true);
});

test('email authentication validation remains unchanged and separate from phone parsing', () => {
  assert.equal(emailSchema.safeParse('person@example.com').success, true);
  assert.equal(loginIdentifierSchema.safeParse('person@example.com').success, true);
  assert.equal(loginIdentifierSchema.safeParse('person@').success, false);
  assert.equal(loginIdentifierSchema.safeParse('9876543210').success, false);
});
