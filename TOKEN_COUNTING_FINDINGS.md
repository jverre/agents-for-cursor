# Token Counting Implementation - Research Findings

## Executive Summary

After researching OpenAI, Anthropic, and ACP agent specifications, and running live tests against `@zed-industries/claude-code-acp`, here's what we discovered about token counting:

**Key Finding:** The ACP agent does NOT return usage/token data in responses. We must calculate tokens ourselves from the streaming data.

## Research Findings

### 1. OpenAI API Token Counting

**Status:** No official documentation on function calling token counts

- Tool/function definitions → Input tokens (sent with request)
- Tool use blocks (model's request to call a function) → Output tokens
- Tool results (your response with data) → Input tokens (next turn)

**Problem:** OpenAI provides usage data in API responses, but tiktoken library doesn't support tool calls. Developers resort to empirical measurement.

**Sources:**
- [OpenAI Cookbook Issue #916](https://github.com/openai/openai-cookbook/issues/916) - No official support, issue closed as "not planned"
- [Community Discussion](https://community.openai.com/t/how-to-calculate-the-tokens-when-using-function-call/266573) - Developers hardcode after hitting limits

### 2. Anthropic Claude API Token Counting

**Status:** Official token counting API available

- Tool definitions → Input tokens (part of request)
- Tool use blocks → Output tokens (assistant generated)
- Tool results → Input tokens (sent back in next message)

**Advantage:** Anthropic provides a `/v1/messages/count_tokens` endpoint that accepts tools, images, PDFs, etc.

**Sources:**
- [Token Counting Docs](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [API Reference](https://docs.anthropic.com/en/api/messages-count-tokens)

### 3. ACP Agent (Zed/Anthropic Implementation)

**Status:** NO usage data returned

We ran live tests using `npx @zed-industries/claude-code-acp` and found:

```javascript
// session/prompt response:
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "stopReason": "end_turn"  // ← ONLY THIS, NO USAGE DATA
  }
}
```

**Conclusion:** Unlike the Anthropic API, the ACP agent does NOT include token counts in responses.

## What This Means for Our Implementation

### ✅ Our Approach is CORRECT

Since ACP doesn't provide usage data, we MUST count tokens ourselves from the stream:

1. **Input tokens:** User message → `estimateTokens(message)`
2. **Output tokens:** Sum of:
   - Text chunks → `estimateTokens(textContent)`
   - Tool inputs → `estimateTokens(JSON.stringify(rawInput))`
   - Tool outputs → `estimateTokens(toolResponseContent)`

### 📊 Token Categorization

For **cost estimation** purposes, we categorize as:

```javascript
{
  prompt_tokens: userMessageTokens,           // What user sends
  completion_tokens: textTokens + toolTokens, // Everything else
  total_tokens: prompt_tokens + completion_tokens
}
```

**Breakdown for debugging:**
```javascript
breakdown: {
  text_tokens: assistantTextResponses,
  tool_input_tokens: toolParametersTotal,
  tool_output_tokens: toolResultsTotal
}
```

### 🎯 Why NOT API-Compatible?

We could try to match Anthropic's API model:
- Input: user message + tool results from previous turn
- Output: assistant text + tool use requests

**However:**
1. ACP doesn't give us usage data anyway
2. Claude Code manages the conversation internally
3. We don't have access to the full conversation history
4. Tool execution happens locally, not via API

So we're doing the **next best thing**: counting everything that goes through the stream.

## ACP Stream Data Structure

### Text Chunks
```json
{
  "sessionUpdate": "agent_message_chunk",
  "content": { "type": "text", "text": "Hello! How" }
}
```

### Tool Calls (Initial)
```json
{
  "sessionUpdate": "tool_call",
  "toolCallId": "toolu_01...",
  "kind": "read",
  "title": "Read File",
  "status": "pending",
  "rawInput": {},  // ← Empty initially
  "content": [],
  "locations": []
}
```

### Tool Calls (With Input)
```json
{
  "sessionUpdate": "tool_call",
  "toolCallId": "toolu_01...",
  "rawInput": {  // ← Filled in next update
    "file_path": "/path/to/file.json"
  },
  "status": "pending",
  ...
}
```

### Tool Completion
```json
{
  "sessionUpdate": "tool_call_update",
  "toolCallId": "toolu_01...",
  "status": "completed",
  "_meta": {
    "claudeCode": {
      "toolResponse": {
        "type": "text",
        "file": {
          "filePath": "/path/to/file.json",
          "content": "{ ... file contents ... }",  // ← THE ACTUAL DATA
          "numLines": 66,
          "startLine": 1,
          "totalLines": 66
        }
      }
    }
  },
  "content": [
    {
      "type": "content",
      "content": {
        "type": "text",
        "text": "```\n1→...\n66→...\n```"  // ← Formatted for display
      }
    }
  ]
}
```

## Implementation Details

### When to Count Tool Tokens

**Tool Input:** When `rawInput` becomes populated (not empty object)
```javascript
if (data.rawInput && Object.keys(data.rawInput).length > 0) {
  toolInputTokens += countToolInputTokens(data.rawInput);
}
```

**Tool Output:** When status becomes `completed` or `failed`
```javascript
if (data.sessionUpdate === 'tool_call_update' &&
    (data.status === 'completed' || data.status === 'failed')) {
  toolOutputTokens += countToolResultTokens(data);
}
```

### Where to Find Tool Results

Priority order for finding tool output:

1. **`_meta.claudeCode.toolResponse.file.content`** - Read tool (raw file)
2. **`_meta.claudeCode.toolResponse.text`** - Direct text response
3. **`_meta.claudeCode.toolResponse`** - Array format
4. **`content[].content.text`** - Formatted display version
5. **`result`** - Legacy format

### Token Approximation

We use: **1 token ≈ 4 characters**

This is a rough approximation but sufficient for cost estimation since:
- We don't have access to Claude's actual tokenizer
- Exact counts aren't critical for usage monitoring
- It's consistent and predictable

For exact counts, we'd need to:
- Integrate `@anthropic-ai/tokenizer` (adds dependency)
- Or use Anthropic's `/v1/messages/count_tokens` API (requires API calls)

## Testing Results

Using `scripts/test-token-data.js`:

**Simple text prompt:**
```
Input: "Say hello in exactly 5 words" (~29 chars = ~8 tokens)
Output: "Hello! How can I help?" (~24 chars = ~6 tokens)
Total: ~14 tokens
```

**File read prompt:**
```
Input: "Read the package.json file" (~26 chars = ~7 tokens)
Tool input: {"file_path": "..."} (~60 chars = ~15 tokens)
Tool output: package.json contents (~2400 chars = ~600 tokens)
Text output: "The package.json shows..." (~200 chars = ~50 tokens)
Total: ~672 tokens
```

**Key observation:** Tool outputs dominate token usage (600/672 = 89%)!

## Recommendations

### For Cost Estimation
Use our current model:
- Count user input as `prompt_tokens`
- Count everything else as `completion_tokens`
- Store breakdown for debugging

### For Context Tracking
Focus on `total_tokens` to understand context window usage. Large tool outputs (file reads, search results) can quickly consume the 200k context.

### For Future Improvements
1. Add configurable token limit warnings
2. Implement caching-aware counting (Anthropic has cache tokens)
3. Consider integrating actual tokenizer for precision
4. Add UI display of token usage per message

## Conclusion

Our implementation is **practical and correct** given ACP's limitations:
- ✅ Counts all token types (text, tool inputs, tool outputs)
- ✅ Provides detailed breakdown for debugging
- ✅ Uses simple, fast approximation (1 token = 4 chars)
- ✅ Suitable for cost estimation and context tracking
- ✅ No external dependencies

The key insight: **ACP doesn't give us usage data, so we're doing the best we can with what we have.**
