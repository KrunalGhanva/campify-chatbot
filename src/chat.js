import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { googleToolDefs, runTool } from './tools.js';

const ai = new GoogleGenAI({ apiKey: config.googleAiKey });

/**
 * Execute one conversation turn with a specified model.
 */
async function executeTurn(modelName, messages, pageContext) {
  let systemInstruction = SYSTEM_PROMPT;
  if (pageContext.campgroundId) {
    systemInstruction +=
      `\n\n## PAGE CONTEXT\n` +
      `The user is currently viewing campground id \`${pageContext.campgroundId}\`. ` +
      `When they refer to "this place", "here", or "this campground", call get_campground_details with that id.`;
  }

  // Build Gemini chat history from all messages except the final user turn
  // Gemini uses role "model" instead of "assistant"
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const chat = ai.chats.create({
    model: modelName,
    history,
    config: {
      systemInstruction,
      tools: googleToolDefs,
      maxOutputTokens: 700,
    },
  });

  // The last message is always from the user (validated upstream)
  let nextMessage = messages[messages.length - 1].content;

  for (let round = 0; round < config.maxToolRounds; round++) {
    const result = await chat.sendMessage({ message: nextMessage });
    const calls = result.functionCalls ?? [];

    if (!calls.length) {
      // No tool calls — return the text reply
      return (result.text || '').trim();
    }

    // Execute all tool calls in parallel
    const toolResponses = await Promise.all(
      calls.map(async (fc) => {
        const out = await runTool(fc.name, fc.args);
        return {
          functionResponse: {
            name: fc.name,
            response: { result: out },
          },
        };
      })
    );

    // Feed results back for the next round
    nextMessage = toolResponses;
  }

  return "I'm having a bit of trouble pulling that data right now. Could you try rephrasing?";
}

/**
 * Run one conversation turn with Gemini, looping through tool calls.
 *
 * @param {Array<{role:'user'|'assistant', content:string}>} messages  Validated messages.
 * @param {{ campgroundId?: string }} pageContext  Optional detail-page context.
 * @returns {Promise<string>}  The assistant's final text reply.
 */
export async function answer(messages, pageContext = {}) {
  try {
    return await executeTurn(config.model, messages, pageContext);
  } catch (err) {
    const isUnavailable =
      err?.status === 503 ||
      err?.message?.includes('503') ||
      err?.message?.includes('UNAVAILABLE') ||
      err?.message?.includes('high demand');

    if (isUnavailable && config.fallbackModel && config.fallbackModel !== config.model) {
      console.warn(
        `Primary model ${config.model} unavailable (503); trying fallback ${config.fallbackModel}`
      );
      return await executeTurn(config.fallbackModel, messages, pageContext);
    }
    throw err;
  }
}
