import pool from './db.js';
import { calculateUsageCost, PricingConfigurationError, PRICING_UNITS } from './pricing-core.js';

const MAX_RATE_MICROS = 9_000_000_000_000_000;

function text(value, field, max = 120) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized.length > max || !/^[a-z0-9._:/~-]+$/.test(normalized)) {
    const error = new TypeError(`${field} is invalid.`);
    error.code = 'INVALID_PRICE';
    throw error;
  }
  return normalized;
}

function rate(value, field, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_RATE_MICROS) {
    const error = new TypeError(`${field} must be a non-negative integer.`);
    error.code = 'INVALID_PRICE';
    throw error;
  }
  return parsed;
}

function timestamp(value, field, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    const error = new TypeError(`${field} is invalid.`);
    error.code = 'INVALID_PRICE';
    throw error;
  }
  return parsed.toISOString();
}

function unit(value, field) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!PRICING_UNITS.includes(normalized)) {
    const error = new TypeError(`${field} is invalid.`);
    error.code = 'INVALID_PRICE';
    throw error;
  }
  return normalized;
}

export function validatePriceVersion(input = {}) {
  const effectiveFrom = timestamp(input.effectiveFrom, 'effectiveFrom');
  const effectiveUntil = timestamp(input.effectiveUntil, 'effectiveUntil', { nullable: true });
  if (effectiveUntil && effectiveUntil <= effectiveFrom) throw Object.assign(new TypeError('effectiveUntil must follow effectiveFrom.'), { code: 'INVALID_PRICE' });
  if (input.currency && String(input.currency).toUpperCase() !== 'USD') {
    throw Object.assign(new TypeError('Only USD pricing is supported.'), { code: 'INVALID_PRICE' });
  }
  return {
    provider: text(input.provider, 'provider', 80),
    model: text(input.model, 'model', 255),
    operation: text(input.operation, 'operation', 80),
    currency: 'USD',
    inputUnit: unit(input.inputUnit, 'inputUnit'),
    outputUnit: unit(input.outputUnit, 'outputUnit'),
    inputRate: rate(input.inputPricePerMillionMicros, 'inputPricePerMillionMicros'),
    cachedInputRate: rate(input.cachedInputPricePerMillionMicros, 'cachedInputPricePerMillionMicros', { nullable: true }),
    cacheWriteRate: rate(input.cacheWritePricePerMillionMicros, 'cacheWritePricePerMillionMicros', { nullable: true }),
    outputRate: rate(input.outputPricePerMillionMicros, 'outputPricePerMillionMicros'),
    effectiveFrom,
    effectiveUntil,
  };
}

async function inTransaction(providedClient, callback) {
  if (providedClient) return callback(providedClient);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function withPricingTransaction(callback) {
  return inTransaction(null, callback);
}

export async function createPriceVersion(input, actorUserId, { client = null } = {}) {
  const price = validatePriceVersion(input);
  return inTransaction(client, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      `${price.provider}:${price.model}`,
      price.operation,
    ]);
    const overlap = await tx.query(
      `SELECT id, effective_from, effective_until FROM provider_price_versions
        WHERE provider = $1 AND model = $2 AND operation = $3
          AND effective_from < COALESCE($5::timestamptz, 'infinity'::timestamptz)
          AND COALESCE(effective_until, 'infinity'::timestamptz) > $4::timestamptz
        ORDER BY effective_from`,
      [price.provider, price.model, price.operation, price.effectiveFrom, price.effectiveUntil],
    );
    if (overlap.rowCount > 0) {
      const predecessor = overlap.rowCount === 1 && overlap.rows[0].effective_until === null
        && new Date(overlap.rows[0].effective_from) < new Date(price.effectiveFrom)
        ? overlap.rows[0]
        : null;
      if (!predecessor) {
        const error = new Error('The price version overlaps an existing version.');
        error.code = 'PRICE_VERSION_OVERLAP';
        throw error;
      }
      // Rates and usage snapshots remain immutable; only close the predecessor
      // interval so a scheduled successor can become effective without overlap.
      await tx.query(
        `UPDATE provider_price_versions SET effective_until = $2 WHERE id = $1 AND effective_until IS NULL`,
        [predecessor.id, price.effectiveFrom],
      );
    }
    const result = await tx.query(
      `INSERT INTO provider_price_versions
         (provider, model, operation, currency, input_unit, output_unit,
          input_price_per_million_micros, cached_input_price_per_million_micros,
          cache_write_price_per_million_micros, output_price_per_million_micros,
          effective_from, effective_until, created_by_platform_admin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [price.provider, price.model, price.operation, price.currency, price.inputUnit, price.outputUnit,
        price.inputRate, price.cachedInputRate, price.cacheWriteRate, price.outputRate,
        price.effectiveFrom, price.effectiveUntil, actorUserId],
    );
    return result.rows[0];
  });
}

export async function resolveProviderPrice({ provider, model, operation, organizationId = null, at = new Date(), client = null }) {
  const executor = client || pool;
  const effectiveAt = timestamp(at, 'at');
  const versions = await executor.query(
    `SELECT * FROM provider_price_versions
      WHERE provider = $1 AND model = $2 AND operation = $3
        AND effective_from <= $4::timestamptz
        AND (effective_until IS NULL OR effective_until > $4::timestamptz)
      ORDER BY effective_from DESC
      LIMIT 2`,
    [text(provider, 'provider', 80), text(model, 'model', 255), text(operation, 'operation', 80), effectiveAt],
  );
  if (versions.rowCount !== 1) {
    throw new PricingConfigurationError(versions.rowCount > 1
      ? 'Overlapping effective provider prices are configured.'
      : `No effective price for ${provider}/${model}/${operation}.`);
  }
  const version = versions.rows[0];
  let override = null;
  if (organizationId) {
    const overrides = await executor.query(
      `SELECT * FROM organization_price_overrides
        WHERE organization_id = $1 AND provider_price_version_id = $2
          AND effective_from <= $3::timestamptz
          AND (effective_until IS NULL OR effective_until > $3::timestamptz)
        ORDER BY effective_from DESC
        LIMIT 2`,
      [organizationId, version.id, effectiveAt],
    );
    if (overrides.rowCount > 1) throw new PricingConfigurationError('Overlapping organization price overrides are configured.');
    override = overrides.rows[0] || null;
  }
  return {
    ...version,
    priceVersionId: version.id,
    priceOverrideId: override?.id || null,
    input_price_per_million_micros: override?.input_price_per_million_micros ?? version.input_price_per_million_micros,
    cached_input_price_per_million_micros: override?.cached_input_price_per_million_micros ?? version.cached_input_price_per_million_micros,
    cache_write_price_per_million_micros: override?.cache_write_price_per_million_micros ?? version.cache_write_price_per_million_micros,
    output_price_per_million_micros: override?.output_price_per_million_micros ?? version.output_price_per_million_micros,
  };
}

export async function createOrganizationPriceOverride(input, actorUserId, organizationId, { client = null } = {}) {
  const versionId = Number(input.providerPriceVersionId);
  const reason = String(input.reason || '').trim();
  if (!Number.isSafeInteger(versionId) || versionId <= 0 || !reason || reason.length > 500) {
    throw Object.assign(new TypeError('A valid price version and reason are required.'), { code: 'INVALID_PRICE_OVERRIDE' });
  }
  const effectiveFrom = timestamp(input.effectiveFrom, 'effectiveFrom');
  const effectiveUntil = timestamp(input.effectiveUntil, 'effectiveUntil', { nullable: true });
  if (effectiveUntil && effectiveUntil <= effectiveFrom) throw Object.assign(new TypeError('effectiveUntil must follow effectiveFrom.'), { code: 'INVALID_PRICE_OVERRIDE' });
  const rates = {
    input: rate(input.inputPricePerMillionMicros, 'inputPricePerMillionMicros', { nullable: true }),
    cached: rate(input.cachedInputPricePerMillionMicros, 'cachedInputPricePerMillionMicros', { nullable: true }),
    write: rate(input.cacheWritePricePerMillionMicros, 'cacheWritePricePerMillionMicros', { nullable: true }),
    output: rate(input.outputPricePerMillionMicros, 'outputPricePerMillionMicros', { nullable: true }),
  };
  if (Object.values(rates).every((value) => value === null)) {
    throw Object.assign(new TypeError('At least one overridden rate is required.'), { code: 'INVALID_PRICE_OVERRIDE' });
  }
  return inTransaction(client, async (tx) => {
    const parent = await tx.query(
      'SELECT id, effective_from, effective_until FROM provider_price_versions WHERE id = $1 FOR SHARE',
      [versionId],
    );
    if (!parent.rowCount) throw Object.assign(new Error('Provider price version not found.'), { code: 'PRICE_VERSION_NOT_FOUND' });
    const parentVersion = parent.rows[0];
    if (new Date(effectiveFrom) < new Date(parentVersion.effective_from)
        || (parentVersion.effective_until && (!effectiveUntil
          || new Date(effectiveUntil) > new Date(parentVersion.effective_until)))) {
      throw Object.assign(new TypeError('Override dates must stay within the provider price version interval.'), {
        code: 'INVALID_PRICE_OVERRIDE',
      });
    }
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      `organization:${organizationId}`,
      `price-version:${versionId}`,
    ]);
    const overlap = await tx.query(
      `SELECT id, effective_from, effective_until FROM organization_price_overrides
        WHERE organization_id = $1 AND provider_price_version_id = $2
          AND effective_from < COALESCE($4::timestamptz, 'infinity'::timestamptz)
          AND COALESCE(effective_until, 'infinity'::timestamptz) > $3::timestamptz
        ORDER BY effective_from`,
      [organizationId, versionId, effectiveFrom, effectiveUntil],
    );
    if (overlap.rowCount) {
      const predecessor = overlap.rowCount === 1 && overlap.rows[0].effective_until === null
        && new Date(overlap.rows[0].effective_from) < new Date(effectiveFrom)
        ? overlap.rows[0]
        : null;
      if (!predecessor) throw Object.assign(new Error('The override overlaps an existing override.'), { code: 'PRICE_OVERRIDE_OVERLAP' });
      await tx.query(
        `UPDATE organization_price_overrides SET effective_until = $2 WHERE id = $1 AND effective_until IS NULL`,
        [predecessor.id, effectiveFrom],
      );
    }
    const result = await tx.query(
      `INSERT INTO organization_price_overrides
         (organization_id, provider_price_version_id, input_price_per_million_micros,
          cached_input_price_per_million_micros, cache_write_price_per_million_micros,
          output_price_per_million_micros, effective_from, effective_until, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [organizationId, versionId, rates.input, rates.cached, rates.write, rates.output,
        effectiveFrom, effectiveUntil, reason, actorUserId],
    );
    return result.rows[0];
  });
}

export async function priceUsage(args) {
  const price = await resolveProviderPrice(args);
  return { price, calculation: calculateUsageCost(price, args.usage || {}) };
}
