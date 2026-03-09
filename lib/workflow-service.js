import pool, { query } from './db';
import { resolveTextAiModel } from './model-policy';
import { fetchWithTimeout } from './api-utils';
import {
  BudgetGuardrailExceededError,
  enforceProjectedBudgetGuardrail,
  estimateTextTransformCost,
  logUsage,
} from './usage';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1';

const BUILTIN_WORKFLOW_DEFINITIONS = [
  {
    id: 'meeting-to-actions',
    name: 'Meeting -> Aktionsplan',
    description: 'Erstellt zuerst eine kompakte Zusammenfassung und danach eine priorisierte To-do-Liste.',
    taskType: 'workflow',
    estimatedSteps: 2,
    steps: [
      {
        key: 'summary',
        title: 'Zusammenfassung',
        instruction: `Fasse den Text in maximal 8 präzisen Bulletpoints zusammen.\nFokus: Ziele, Entscheidungen, Risiken, offene Fragen.\nKein Fließtext.`,
      },
      {
        key: 'actions',
        title: 'Aktionsplan',
        instruction: `Erstelle aus der Zusammenfassung eine umsetzbare Aktionsliste im Markdown-Format.\nFormat je Eintrag: - [ ] Aufgabe | Verantwortlich | Priorität (H/M/L) | Termin\nWenn Informationen fehlen, "Offen" setzen.`,
      },
    ],
    composeResult(outputs) {
      return `## Zusammenfassung\n\n${outputs.summary}\n\n## Aktionsplan\n\n${outputs.actions}`;
    },
  },
  {
    id: 'notes-to-update',
    name: 'Notizen -> Status-Update',
    description: 'Verdichtet Notizen und erzeugt ein prägnantes Management-Update.',
    taskType: 'workflow',
    estimatedSteps: 2,
    steps: [
      {
        key: 'brief',
        title: 'Kernpunkte',
        instruction: `Verdichte die Notizen in eine klare Kurzfassung (max. 6 Bulletpoints).\nFokus auf Entscheidungen und nächste Schritte.`,
      },
      {
        key: 'update',
        title: 'Status-Update',
        instruction: `Erstelle daraus ein kurzes Status-Update in Deutsch für Entscheider.\nFormat in Markdown:\n## Status\n- ...\n## Entscheidungen\n- ...\n## Nächste Schritte\n- ...\nKeine zusätzliche Erklärung außerhalb des Updates.`,
      },
    ],
    composeResult(outputs) {
      return `## Kernpunkte\n\n${outputs.brief}\n\n## Status-Update\n\n${outputs.update}`;
    },
  },
  {
    id: 'rough-to-report',
    name: 'Rohnotiz -> Kurzbericht',
    description: 'Bereinigt Rohtext und erstellt einen strukturierten Kurzbericht.',
    taskType: 'workflow',
    estimatedSteps: 2,
    steps: [
      {
        key: 'cleaned',
        title: 'Bereinigter Text',
        instruction: `Bereinige den Text sprachlich, ohne Inhalt zu verlieren.\nKeine Erklärungen, nur bereinigter Text.`,
      },
      {
        key: 'report',
        title: 'Kurzbericht',
        instruction: `Erstelle einen Kurzbericht im Markdown-Format mit diesen Abschnitten:\n1. Kontext\n2. Kernaussagen\n3. Risiken\n4. Nächste Schritte\nNutze kurze Stichpunkte.`,
      },
    ],
    composeResult(outputs) {
      return `## Bereinigter Text\n\n${outputs.cleaned}\n\n## Kurzbericht\n\n${outputs.report}`;
    },
  },
];

const BUILTIN_BY_ID = new Map(BUILTIN_WORKFLOW_DEFINITIONS.map((entry) => [entry.id, entry]));

function normalizeText(value, maxLength = 10_000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeKey(value, fallback = 'step') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function toWorkflowPublicId(workflowKey) {
  return `custom:${workflowKey}`;
}

function parseCustomWorkflowId(workflowId) {
  if (typeof workflowId !== 'string') return null;
  if (!workflowId.startsWith('custom:')) return null;
  const key = workflowId.slice('custom:'.length).trim();
  return key || null;
}

function composeCustomResult(definition, outputs) {
  const sections = [];
  for (const step of definition.steps) {
    const stepKey = normalizeKey(step.key, 'step');
    const title = normalizeText(step.title || step.label || stepKey, 120);
    sections.push(`## ${title}\n\n${outputs[stepKey] || ''}`);
  }
  return sections.join('\n\n');
}

export function validateWorkflowDraft(input) {
  const errors = [];
  const name = normalizeText(input?.name, 160);
  const description = normalizeText(input?.description, 1500);
  const rawSteps = Array.isArray(input?.steps) ? input.steps : [];

  if (!name) errors.push('Workflow-Name ist erforderlich');
  if (rawSteps.length < 1) errors.push('Mindestens ein Schritt ist erforderlich');
  if (rawSteps.length > 8) errors.push('Maximal 8 Schritte erlaubt');

  const seen = new Set();
  const steps = rawSteps.map((step, index) => {
    const stepKey = normalizeKey(step?.key, `step_${index + 1}`).slice(0, 48);
    const title = normalizeText(step?.title || step?.label || `Schritt ${index + 1}`, 120);
    const instruction = normalizeText(step?.instruction, 4000);
    if (!instruction) {
      errors.push(`Schritt ${index + 1}: Anweisung fehlt`);
    }
    if (seen.has(stepKey)) {
      errors.push(`Schritt ${index + 1}: Key "${stepKey}" ist doppelt`);
    }
    seen.add(stepKey);

    return {
      key: stepKey,
      title,
      instruction,
    };
  });

  return {
    isValid: errors.length === 0,
    errors,
    workflow: {
      name,
      description,
      steps,
      taskType: 'workflow',
      estimatedSteps: steps.length,
    },
  };
}

function toCustomWorkflowListEntry(row) {
  const definition = row.definition && typeof row.definition === 'object' ? row.definition : {};
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  return {
    id: toWorkflowPublicId(row.workflow_key),
    workflowKey: row.workflow_key,
    dbId: row.id,
    name: row.name,
    description: row.description || '',
    taskType: 'workflow',
    estimatedSteps: steps.length || row.active_version || 1,
    source: 'custom',
    isCustom: true,
    version: Number(row.active_version || 1),
    updatedAt: row.updated_at,
    steps: steps.map((step, index) => ({
      key: normalizeKey(step?.key, `step_${index + 1}`),
      title: normalizeText(step?.title || step?.label || `Schritt ${index + 1}`, 120),
      instruction: normalizeText(step?.instruction, 4000),
    })),
  };
}

async function listCustomWorkflows(userId) {
  try {
    const result = await query(
      `SELECT w.id, w.workflow_key, w.name, w.description, w.active_version, w.updated_at, v.definition
       FROM user_workflows w
       LEFT JOIN user_workflow_versions v
         ON v.workflow_id = w.id
        AND v.version = w.active_version
       WHERE w.user_id = $1
         AND w.is_active = true
       ORDER BY w.updated_at DESC`,
      [userId]
    );
    return result.rows.map(toCustomWorkflowListEntry);
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return [];
    }
    throw error;
  }
}

async function getCustomWorkflowDefinition({ userId, workflowId }) {
  const workflowKey = parseCustomWorkflowId(workflowId);
  if (!workflowKey) return null;

  try {
    const result = await query(
      `SELECT w.id, w.workflow_key, w.name, w.description, w.active_version, v.definition
       FROM user_workflows w
       LEFT JOIN user_workflow_versions v
         ON v.workflow_id = w.id
        AND v.version = w.active_version
       WHERE w.user_id = $1
         AND w.workflow_key = $2
         AND w.is_active = true`,
      [userId, workflowKey]
    );
    if (result.rowCount === 0) return null;
    return toCustomWorkflowListEntry(result.rows[0]);
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return null;
    }
    throw error;
  }
}

function toBuiltinListEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    taskType: entry.taskType,
    estimatedSteps: entry.estimatedSteps,
    source: 'builtin',
    isCustom: false,
    version: 1,
  };
}

function createWorkflowKey(name) {
  const base = normalizeKey(name, 'workflow').slice(0, 90);
  if (!base) return `workflow_${Date.now()}`;
  return base;
}

async function ensureUniqueWorkflowKey(userId, requestedKey, fallbackName) {
  const base = normalizeKey(requestedKey || fallbackName, 'workflow').slice(0, 90) || createWorkflowKey(fallbackName);
  let candidate = base;
  let suffix = 2;

  while (true) {
    const exists = await query(
      `SELECT 1 FROM user_workflows WHERE user_id = $1 AND workflow_key = $2`,
      [userId, candidate]
    );
    if (exists.rowCount === 0) return candidate;
    candidate = `${base}_${suffix}`.slice(0, 110);
    suffix += 1;
  }
}

export async function listWorkflows(userId) {
  const builtin = BUILTIN_WORKFLOW_DEFINITIONS.map(toBuiltinListEntry);
  if (!userId) return builtin;
  const custom = await listCustomWorkflows(userId);
  return [...custom, ...builtin];
}

export async function upsertCustomWorkflow({
  userId,
  workflowId = null,
  workflowKey = null,
  name,
  description,
  steps,
  note = null,
}) {
  const validation = validateWorkflowDraft({ name, description, steps });
  if (!validation.isValid) {
    const err = new Error('INVALID_WORKFLOW_DRAFT');
    err.details = validation.errors;
    throw err;
  }

  const normalizedWorkflowId = parseCustomWorkflowId(workflowId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let workflowRow = null;
    if (normalizedWorkflowId) {
      const existing = await client.query(
        `SELECT id, workflow_key, active_version
         FROM user_workflows
         WHERE user_id = $1
           AND workflow_key = $2
           AND is_active = true
         FOR UPDATE`,
        [userId, normalizedWorkflowId]
      );
      workflowRow = existing.rows[0] || null;
      if (!workflowRow) {
        throw new Error('WORKFLOW_NOT_FOUND');
      }
    }

    if (!workflowRow) {
      const requestedKey = workflowKey || validation.workflow.name;
      const uniqueKey = await ensureUniqueWorkflowKey(userId, requestedKey, validation.workflow.name);
      const inserted = await client.query(
        `INSERT INTO user_workflows (user_id, workflow_key, name, description, active_version, is_active, updated_at)
         VALUES ($1, $2, $3, $4, 1, true, NOW())
         RETURNING id, workflow_key, active_version`,
        [userId, uniqueKey, validation.workflow.name, validation.workflow.description || null]
      );
      workflowRow = inserted.rows[0];
    }

    const nextVersionResult = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM user_workflow_versions
       WHERE workflow_id = $1`,
      [workflowRow.id]
    );
    const nextVersion = Number(nextVersionResult.rows[0]?.next_version || 1);

    await client.query(
      `INSERT INTO user_workflow_versions (workflow_id, version, definition, note, created_by_user_id)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [
        workflowRow.id,
        nextVersion,
        JSON.stringify(validation.workflow),
        normalizeText(note, 255) || null,
        userId,
      ]
    );

    await client.query(
      `UPDATE user_workflows
       SET name = $1,
           description = $2,
           active_version = $3,
           is_active = true,
           updated_at = NOW()
       WHERE id = $4`,
      [
        validation.workflow.name,
        validation.workflow.description || null,
        nextVersion,
        workflowRow.id,
      ]
    );

    await client.query('COMMIT');
    return getCustomWorkflowDefinition({
      userId,
      workflowId: toWorkflowPublicId(workflowRow.workflow_key),
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listCustomWorkflowVersions({ userId, workflowId }) {
  const workflowKey = parseCustomWorkflowId(workflowId);
  if (!workflowKey) {
    throw new Error('INVALID_WORKFLOW_ID');
  }

  const result = await query(
    `SELECT v.version, v.note, v.created_at, v.created_by_user_id,
            w.active_version
     FROM user_workflows w
     INNER JOIN user_workflow_versions v ON v.workflow_id = w.id
     WHERE w.user_id = $1
       AND w.workflow_key = $2
     ORDER BY v.version DESC`,
    [userId, workflowKey]
  );

  return result.rows.map((row) => ({
    version: Number(row.version),
    note: row.note || '',
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    isActive: Number(row.version) === Number(row.active_version),
  }));
}

export async function rollbackCustomWorkflowVersion({ userId, workflowId, version }) {
  const workflowKey = parseCustomWorkflowId(workflowId);
  const targetVersion = Number.parseInt(version, 10);
  if (!workflowKey || !Number.isFinite(targetVersion)) {
    throw new Error('INVALID_WORKFLOW_ROLLBACK');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const workflowResult = await client.query(
      `SELECT id
       FROM user_workflows
       WHERE user_id = $1
         AND workflow_key = $2
         AND is_active = true
       FOR UPDATE`,
      [userId, workflowKey]
    );
    if (workflowResult.rowCount === 0) {
      throw new Error('WORKFLOW_NOT_FOUND');
    }
    const workflowDbId = workflowResult.rows[0].id;

    const versionExists = await client.query(
      `SELECT 1
       FROM user_workflow_versions
       WHERE workflow_id = $1
         AND version = $2`,
      [workflowDbId, targetVersion]
    );
    if (versionExists.rowCount === 0) {
      throw new Error('WORKFLOW_VERSION_NOT_FOUND');
    }

    await client.query(
      `UPDATE user_workflows
       SET active_version = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [targetVersion, workflowDbId]
    );

    await client.query('COMMIT');
    return getCustomWorkflowDefinition({
      userId,
      workflowId: toWorkflowPublicId(workflowKey),
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function deactivateCustomWorkflow({ userId, workflowId }) {
  const workflowKey = parseCustomWorkflowId(workflowId);
  if (!workflowKey) {
    throw new Error('INVALID_WORKFLOW_ID');
  }
  const result = await query(
    `UPDATE user_workflows
     SET is_active = false, updated_at = NOW()
     WHERE user_id = $1
       AND workflow_key = $2
       AND is_active = true`,
    [userId, workflowKey]
  );
  return result.rowCount > 0;
}

async function runChatCompletion({ apiKey, model, prompt }) {
  const response = await fetchWithTimeout(`${MISTRAL_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'Du bist ein präziser Assistent. Liefere nur den angeforderten Ergebnistext, ohne Einleitung oder Meta-Kommentar.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `Mistral API error: ${response.status}`);
  }

  const payload = await response.json();
  return {
    text: payload.choices?.[0]?.message?.content || '',
    usage: payload.usage || {},
  };
}

async function resolveWorkflowForExecution({ workflowId, userId }) {
  const builtin = BUILTIN_BY_ID.get(workflowId);
  if (builtin) {
    return {
      ...builtin,
      source: 'builtin',
      isCustom: false,
      version: 1,
    };
  }

  const custom = await getCustomWorkflowDefinition({ userId, workflowId });
  if (!custom) return null;
  return {
    id: custom.id,
    name: custom.name,
    description: custom.description,
    taskType: custom.taskType,
    steps: custom.steps,
    estimatedSteps: custom.steps.length,
    source: 'custom',
    isCustom: true,
    version: custom.version,
    composeResult(outputs) {
      return composeCustomResult({ steps: custom.steps }, outputs);
    },
  };
}

export async function executeWorkflow({
  workflowId,
  inputText,
  apiKey,
  model,
  userId,
}) {
  const workflow = await resolveWorkflowForExecution({ workflowId, userId });
  if (!workflow) {
    throw new Error('WORKFLOW_NOT_FOUND');
  }

  const selectedModel = resolveTextAiModel(model) || 'mistral-medium-latest';
  const outputs = {};
  const usageTotals = {
    prompt_tokens: 0,
    completion_tokens: 0,
  };
  let currentInput = inputText;

  for (const step of workflow.steps) {
    const estimatedNextCost = estimateTextTransformCost(selectedModel, currentInput, {
      inputBufferTokens: 100,
      outputMultiplier: 0.8,
      outputBufferTokens: 180,
    });

    await enforceProjectedBudgetGuardrail(userId, estimatedNextCost);

    const prompt = `${step.instruction}\n\nText:\n${currentInput}`;
    const result = await runChatCompletion({
      apiKey,
      model: selectedModel,
      prompt,
    });

    const stepKey = normalizeKey(step.key, 'step');
    outputs[stepKey] = result.text;
    currentInput = result.text;

    usageTotals.prompt_tokens += Number(result.usage.prompt_tokens || result.usage.input_tokens || 0);
    usageTotals.completion_tokens += Number(result.usage.completion_tokens || result.usage.output_tokens || 0);
    await logUsage(userId, selectedModel, 'workflow', result.usage);
  }

  const resultText = workflow.composeResult(outputs);

  return {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      steps: workflow.steps.length,
      source: workflow.source,
      isCustom: workflow.isCustom,
      version: workflow.version || 1,
    },
    model: selectedModel,
    usage: usageTotals,
    resultText,
    stepOutputs: outputs,
  };
}

export { BudgetGuardrailExceededError };
