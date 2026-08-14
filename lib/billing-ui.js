export function microsToEuros(value) {
  if (value === null || value === undefined || value === '') return null;
  const micros = Number(value);
  return Number.isFinite(micros) ? micros / 1_000_000 : null;
}

export function eurosToMicros(value, { nullable = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw Object.assign(new TypeError('A price is required.'), { code: 'INVALID_BILLING_INPUT' });
  }
  const euros = Number(value);
  const micros = Math.round(euros * 1_000_000);
  if (!Number.isFinite(euros) || euros < 0 || !Number.isSafeInteger(micros)) {
    throw Object.assign(new TypeError('The price must be a non-negative amount.'), { code: 'INVALID_BILLING_INPUT' });
  }
  return micros;
}

export function budgetEurosToMicros(value) {
  if (value === null || value === undefined || value === '') return null;
  const euros = Number(value);
  const cents = Math.round(euros * 100);
  const micros = cents * 10_000;
  if (!Number.isFinite(euros) || euros <= 0 || cents <= 0
      || !Number.isSafeInteger(cents) || !Number.isSafeInteger(micros)) {
    throw Object.assign(new TypeError('The budget must be a positive amount.'), { code: 'INVALID_BILLING_INPUT' });
  }
  return micros;
}

export function toDateTimeLocal(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function toIsoDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf())) {
    throw Object.assign(new TypeError('A valid effective date is required.'), { code: 'INVALID_BILLING_INPUT' });
  }
  return date.toISOString();
}
