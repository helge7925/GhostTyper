import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, fetchWithTimeout, logApiError, serverError } from '../../../lib/api-utils';
import { resolveCortecsConfig } from '../../../lib/settings-service';
import { hasPermission } from '../../../lib/permissions';
import { CostLimitCheckUnavailableError, CostLimitExceededError, checkCostLimit, estimateCost, logUsage, withUserCostLock } from '../../../lib/usage';
import { CHAT_TIMEOUT_MS, buildConversationMessages, buildCortecsBody, deleteMessage, findPreviousUserMessage, getMessageForUser, storeMessage, trimConversation, updateConversationMeta } from '../../../lib/chat-service';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'chat.write')) return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  const orgId = req.org.id;
  const userId = req.userId;
  const messageId = Number(req.body?.messageId);
  if (!Number.isFinite(messageId)) return res.status(400).json({ message: 'Nachricht-ID ist erforderlich.' });
  const allowed = await enforceRateLimit(req, res, { keyPrefix: 'chat-regenerate', identifier: `org:${orgId}:user:${userId}`, limit: 30, windowMs: 60_000 });
  if (!allowed) return;
  try {
    const row = await getMessageForUser(messageId, orgId, userId);
    if (!row || row.role !== 'assistant') return res.status(404).json({ message: 'Antwort nicht gefunden' });
    const previousUser = await findPreviousUserMessage(row.conversation_id, messageId);
    if (!previousUser) return res.status(400).json({ message: 'Keine vorherige Nutzernachricht gefunden.' });
    const cortecs = await resolveCortecsConfig({ userId, organizationId: orgId });
    if (!cortecs.apiKey) return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    await deleteMessage(messageId, row.conversation_id);
    const stored = await withUserCostLock(userId, async () => {
      const costCheck = await checkCostLimit(userId, orgId);
      if (!costCheck.allowed) throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      const { apiMessages, retrieval } = await buildConversationMessages({ conversation: row, convId: row.conversation_id, userMessage: previousUser.content, orgId, userId, cortecs });
      const response = await fetchWithTimeout(`${cortecs.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cortecs.apiKey}` },
        body: JSON.stringify(buildCortecsBody(cortecs, apiMessages)),
      }, CHAT_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Cortecs API error: ${response.status} - ${(await response.text()).slice(0, 300)}`);
      const result = await response.json();
      const usage = result.usage || {};
      const usedModel = result.model || cortecs.chatModel;
      const reply = await storeMessage(row.conversation_id, 'assistant', result.choices?.[0]?.message?.content || '', {
        model: usedModel,
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        cost: estimateCost(usedModel, usage.prompt_tokens || 0, usage.completion_tokens || 0),
        metadata: { retrieval_results: retrieval.sources, regenerated_from_message_id: messageId },
      });
      if (usage.prompt_tokens || usage.completion_tokens) await logUsage(userId, usedModel, 'chat_message', usage, orgId);
      return reply;
    });
    await trimConversation(row.conversation_id);
    await updateConversationMeta(row.conversation_id);
    return res.status(200).json({ message: stored });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') return res.status(429).json({ message: error.message });
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') return res.status(503).json({ message: error.message });
    logApiError('Chat regenerate failed', error);
    return serverError(res, 'Antwort konnte nicht neu erzeugt werden.');
  }
}

export default withOrgScope({ permission: 'chat.read' }, handler);
